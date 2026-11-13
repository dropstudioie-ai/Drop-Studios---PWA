import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Group, Layer, Line, Rect, Stage, Transformer } from 'react-konva';
import Konva from 'konva';
import { currentPage, useEditor } from '../store/editor';
import { PageContent, type NodeHandlers } from './render';
import type { DesignElement, TextElement } from '../model/types';
import { bounds, scaleElement } from '../model/elements';
import { dropPayloadToElements, DRAG_MIME } from './dropPayload';
import { importFiles } from '../assets/upload';

const PAD = 60;
type Guide = { axis: 'x' | 'y'; pos: number };

/** Snap a moving box to the page and other elements. Returns the correction and the guide lines to draw. */
export function snapBox(box: { x: number; y: number; width: number; height: number }, others: { x: number; y: number; width: number; height: number }[], W: number, H: number, threshold: number) {
  const xs = [0, W / 2, W, ...others.flatMap((o) => [o.x, o.x + o.width / 2, o.x + o.width])];
  const ys = [0, H / 2, H, ...others.flatMap((o) => [o.y, o.y + o.height / 2, o.y + o.height])];
  const mine = (a: number, size: number) => [a, a + size / 2, a + size];
  let best: { dx: number; gx: number | null } = { dx: 0, gx: null };
  let bestY: { dy: number; gy: number | null } = { dy: 0, gy: null };
  let mx = threshold, my = threshold;
  for (const t of xs) for (const m of mine(box.x, box.width)) { const d = t - m; if (Math.abs(d) < mx) { mx = Math.abs(d); best = { dx: d, gx: t }; } }
  for (const t of ys) for (const m of mine(box.y, box.height)) { const d = t - m; if (Math.abs(d) < my) { my = Math.abs(d); bestY = { dy: d, gy: t }; } }
  const guides: Guide[] = [];
  if (best.gx != null) guides.push({ axis: 'x', pos: best.gx });
  if (bestY.gy != null) guides.push({ axis: 'y', pos: bestY.gy });
  return { dx: best.dx, dy: bestY.dy, guides };
}

export default function Canvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [pan, setPan] = useState({ x: PAD, y: PAD });
  const [guides, setGuides] = useState<Guide[]>([]);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dragStart = useRef<Map<string, { x: number; y: number }>>(new Map());

  const design = useEditor((s) => s.design);
  const pageIndex = useEditor((s) => s.pageIndex);
  const page = useEditor((s) => currentPage(s));
  const zoom = useEditor((s) => s.zoom);
  const selectedIds = useEditor((s) => s.selectedIds);
  const editingTextId = useEditor((s) => s.editingTextId);
  const showGrid = useEditor((s) => s.showGrid);
  const snap = useEditor((s) => s.snap);
  const fitNonce = useEditor((s) => s.fitNonce);
  const api = useEditor.getState;

  const W = design?.width ?? 1080, H = design?.height ?? 1080;
  // Exposed for automated browser tests (screen position of the page).
  useEffect(() => { (window as unknown as { __dropCanvas?: unknown }).__dropCanvas = { pan, zoom }; }, [pan, zoom]);

  // Track the container size.
  useLayoutEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const z = Math.min((size.w - PAD * 2) / W, (size.h - PAD * 2) / H);
    const zz = Math.max(0.05, Math.min(z, 2));
    api().setZoom(zz);
    setPan({ x: (size.w - W * zz) / 2, y: (size.h - H * zz) / 2 });
  }, [size.w, size.h, W, H, api]);

  // Fit on open, on format change and when asked.
  useEffect(() => { fit(); }, [design?.id, W, H, fitNonce, size.w > 0 && size.h > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the page centred when zoom changes from the toolbar.
  const lastZoom = useRef(zoom);
  useEffect(() => {
    if (lastZoom.current === zoom) return;
    const prev = lastZoom.current; lastZoom.current = zoom;
    setPan((p) => {
      const cx = size.w / 2, cy = size.h / 2;
      return { x: cx - ((cx - p.x) / prev) * zoom, y: cy - ((cy - p.y) / prev) * zoom };
    });
  }, [zoom, size.w, size.h]);

  // Attach the transformer to the selected nodes.
  const selectedEls = useMemo(() => page?.elements.filter((e) => selectedIds.includes(e.id)) ?? [], [page, selectedIds]);
  useEffect(() => {
    const tr = trRef.current, st = stageRef.current;
    if (!tr || !st) return;
    const nodes = selectedEls.filter((e) => !e.locked && !e.hidden && e.id !== editingTextId).map((e) => st.findOne(`#${e.id}`)).filter(Boolean) as Konva.Node[];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedEls, editingTextId, page]);

  const toPage = (p: { x: number; y: number }) => ({ x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom });

  const handlers: NodeHandlers = {
    onPointerDown: (e, el) => {
      e.cancelBubble = true;
      const ev = e.evt as MouseEvent;
      const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      if (additive) api().select([el.id], true);
      else if (!api().selectedIds.includes(el.id)) api().select([el.id]);
    },
    onDblClick: (el) => { if (el.type === 'text' && !el.locked) api().setEditingText(el.id); },
    onDragStart: (_e, el) => {
      if (!api().selectedIds.includes(el.id)) api().select([el.id]);
      const st = stageRef.current!;
      dragStart.current = new Map(api().selectedIds.map((id) => {
        const n = st.findOne(`#${id}`);
        return [id, { x: n?.x() ?? 0, y: n?.y() ?? 0 }];
      }));
    },
    onDragMove: (e, el) => {
      const node = e.target;
      const start = dragStart.current.get(el.id); if (!start) return;
      let dx = node.x() - start.x, dy = node.y() - start.y;
      const st = stageRef.current!;
      const ids = [...dragStart.current.keys()];
      if (snap && page) {
        const moving = page.elements.filter((x) => ids.includes(x.id)).map((x) => bounds({ ...x, x: dragStart.current.get(x.id)!.x + dx, y: dragStart.current.get(x.id)!.y + dy }));
        const box = { x: Math.min(...moving.map((m) => m.x)), y: Math.min(...moving.map((m) => m.y)) } as { x: number; y: number; width: number; height: number };
        box.width = Math.max(...moving.map((m) => m.x + m.width)) - box.x; box.height = Math.max(...moving.map((m) => m.y + m.height)) - box.y;
        const others = page.elements.filter((x) => !ids.includes(x.id) && !x.hidden).map(bounds);
        const s = snapBox(box, others, W, H, 6 / zoom);
        dx += s.dx; dy += s.dy;
        setGuides(s.guides);
      }
      for (const id of ids) {
        const n = id === el.id ? node : st.findOne(`#${id}`);
        const p0 = dragStart.current.get(id)!;
        n?.position({ x: p0.x + dx, y: p0.y + dy });
      }
    },
    onDragEnd: () => {
      const st = stageRef.current!;
      const patches = [...dragStart.current.keys()].map((id) => { const n = st.findOne(`#${id}`)!; return { id, patch: { x: n.x(), y: n.y() } }; });
      dragStart.current = new Map();
      setGuides([]);
      api().updateElements(patches);
    },
    onTextMeasured: (id, h) => api().syncTextHeight(id, h),
    hideId: editingTextId,
  };

  function onTransformEnd() {
    const tr = trRef.current!;
    const anchor = tr.getActiveAnchor();
    const sideOnly = anchor === 'middle-left' || anchor === 'middle-right';
    const patches: { id: string; patch: Partial<DesignElement> }[] = [];
    for (const node of tr.nodes()) {
      const el = page?.elements.find((x) => x.id === node.id()); if (!el) continue;
      const flipX = el.type === 'image' && el.flipX ? -1 : 1, flipY = el.type === 'image' && el.flipY ? -1 : 1;
      const sx = node.scaleX() * flipX, sy = node.scaleY() * flipY;
      node.scaleX(flipX); node.scaleY(flipY);
      const base = { x: node.x(), y: node.y(), rotation: node.rotation() };
      if (el.type === 'image' && (el.flipX || el.flipY)) {
        // Konva positions flipped images by their offset; recover the top-left in our model.
        Object.assign(base, { x: node.x(), y: node.y() });
      }
      if (el.type === 'text') {
        patches.push({ id: el.id, patch: sideOnly
          ? { ...base, width: Math.max(20, el.width * sx) }
          : { ...base, width: Math.max(20, el.width * sx), fontSize: Math.max(4, (el as TextElement).fontSize * sy) } as Partial<DesignElement> });
      } else if (el.type === 'group') {
        const scaled = scaleElement({ ...el, x: 0, y: 0 }, sx, sy) as Extract<DesignElement, { type: 'group' }>;
        patches.push({ id: el.id, patch: { ...base, width: el.width * sx, height: el.height * sy, children: scaled.children } as Partial<DesignElement> });
      } else {
        patches.push({ id: el.id, patch: { ...base, width: Math.max(2, el.width * sx), height: Math.max(2, el.height * sy) } });
      }
    }
    if (patches.length) api().updateElements(patches);
  }

  // Rubber-band selection and deselect on empty clicks.
  function onStageDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const t = e.target;
    const empty = t === t.getStage() || t.name() === 'page-bg';
    if (!empty) return;
    const ev = e.evt as MouseEvent;
    if (!ev.shiftKey) api().select([]);
    const p = stageRef.current!.getPointerPosition(); if (!p) return;
    const q = toPage(p);
    setBand({ x0: q.x, y0: q.y, x1: q.x, y1: q.y });
  }
  function onStageMove() {
    if (!band) return;
    const p = stageRef.current!.getPointerPosition(); if (!p) return;
    const q = toPage(p);
    setBand({ ...band, x1: q.x, y1: q.y });
  }
  function onStageUp() {
    if (!band || !page) { setBand(null); return; }
    const x = Math.min(band.x0, band.x1), y = Math.min(band.y0, band.y1), w = Math.abs(band.x1 - band.x0), h = Math.abs(band.y1 - band.y0);
    setBand(null);
    if (w < 4 && h < 4) return;
    const hit = page.elements.filter((el) => {
      if (el.locked || el.hidden) return false;
      const b = bounds(el);
      return b.x < x + w && b.x + b.width > x && b.y < y + h && b.y + b.height > y;
    }).map((el) => el.id);
    api().select(hit, true);
  }

  function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const p = stageRef.current!.getPointerPosition() ?? { x: size.w / 2, y: size.h / 2 };
      const old = zoom;
      const next = Math.min(4, Math.max(0.05, old * (e.evt.deltaY > 0 ? 0.9 : 1.1)));
      lastZoom.current = next;
      api().setZoom(next);
      setPan({ x: p.x - ((p.x - pan.x) / old) * next, y: p.y - ((p.y - pan.y) / old) * next });
    } else {
      setPan((pp) => ({ x: pp.x - e.evt.deltaX, y: pp.y - e.evt.deltaY }));
    }
  }

  // Drops from the side panel or from the computer.
  async function onDrop(ev: React.DragEvent) {
    ev.preventDefault();
    const rect = wrapRef.current!.getBoundingClientRect();
    const at = toPage({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
    const raw = ev.dataTransfer.getData(DRAG_MIME);
    if (raw) {
      const els = await dropPayloadToElements(JSON.parse(raw), at, { width: W, height: H });
      if (els.length) api().addElements(els);
      return;
    }
    if (ev.dataTransfer.files.length) {
      const imported = await importFiles([...ev.dataTransfer.files], 'photo');
      const els = (await Promise.all(imported.map((a, i) => dropPayloadToElements({ kind: 'asset', id: a.id }, { x: at.x + i * 30, y: at.y + i * 30 }, { width: W, height: H })))).flat();
      if (els.length) api().addElements(els);
    }
  }

  const textEl = editingTextId ? page?.elements.find((e) => e.id === editingTextId) as TextElement | undefined : undefined;
  const textOnlySelected = selectedEls.length > 0 && selectedEls.every((e) => e.type === 'text');
  const lineSelected = selectedEls.length === 1 && selectedEls[0].type === 'shape' && ['line', 'arrow'].includes((selectedEls[0] as { shape: string }).shape);
  const keepRatio = selectedEls.some((e) => e.type === 'image' || e.type === 'icon' || e.type === 'group' || e.type === 'text') || selectedEls.length > 1;

  if (!design || !page) return null;
  const gridLines: number[] = [];
  if (showGrid) { const step = Math.max(W, H) / 24; for (let v = step; v < Math.max(W, H); v += step) gridLines.push(v); }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-[var(--canvas-bg)]" onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onDrop(e)} data-testid="canvas">
      <Stage ref={stageRef} width={size.w} height={size.h} onMouseDown={onStageDown} onTouchStart={onStageDown} onMouseMove={onStageMove} onMouseUp={onStageUp} onTouchEnd={onStageUp} onWheel={onWheel}>
        <Layer>
          {/* page shadow */}
          <Rect x={pan.x} y={pan.y} width={W * zoom} height={H * zoom} fill="#fff" shadowColor="#0f172a" shadowBlur={24} shadowOpacity={0.12} shadowOffsetY={6} listening={false} />
          <Group x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom} clipX={0} clipY={0} clipWidth={W} clipHeight={H} key={`${design.id}-${pageIndex}`}>
            <PageContent page={page} width={W} height={H} handlers={handlers} />
          </Group>
          <Group x={pan.x} y={pan.y} scaleX={zoom} scaleY={zoom} listening={false}>
            {gridLines.map((v) => <Line key={`gx${v}`} points={[v, 0, v, H]} stroke="#8b5cf6" opacity={0.18} strokeWidth={1 / zoom} />)}
            {gridLines.map((v) => <Line key={`gy${v}`} points={[0, v, W, v]} stroke="#8b5cf6" opacity={0.18} strokeWidth={1 / zoom} />)}
            {guides.map((g, i) => g.axis === 'x'
              ? <Line key={i} points={[g.pos, -2000, g.pos, H + 2000]} stroke="#ec4899" strokeWidth={1.5 / zoom} dash={[6 / zoom, 4 / zoom]} />
              : <Line key={i} points={[-2000, g.pos, W + 2000, g.pos]} stroke="#ec4899" strokeWidth={1.5 / zoom} dash={[6 / zoom, 4 / zoom]} />)}
            {band && <Rect x={Math.min(band.x0, band.x1)} y={Math.min(band.y0, band.y1)} width={Math.abs(band.x1 - band.x0)} height={Math.abs(band.y1 - band.y0)} fill="rgba(99,102,241,0.08)" stroke="#8b5cf6" strokeWidth={1 / zoom} />}
            {selectedEls.filter((e) => e.locked).map((e) => { const b = bounds(e); return <Rect key={e.id} {...b} stroke="#f59e0b" strokeWidth={1.5 / zoom} dash={[4 / zoom, 4 / zoom]} />; })}
          </Group>
          <Transformer
            ref={trRef}
            rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
            rotationSnapTolerance={4}
            keepRatio={keepRatio}
            enabledAnchors={lineSelected ? ['middle-left', 'middle-right'] : textOnlySelected
              ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
              : ['top-left', 'top-center', 'top-right', 'middle-right', 'middle-left', 'bottom-left', 'bottom-center', 'bottom-right']}
            anchorSize={10} anchorCornerRadius={5} anchorStroke="#8b5cf6" borderStroke="#8b5cf6" anchorFill="#fff" rotateAnchorOffset={28}
            boundBoxFunc={(o, n) => (Math.abs(n.width) < 8 || Math.abs(n.height) < 4 ? o : n)}
            onTransformEnd={onTransformEnd}
          />
        </Layer>
      </Stage>
      {textEl && stageRef.current && <TextEditor el={textEl} stage={stageRef.current} zoom={zoom} />}
    </div>
  );
}

function TextEditor({ el, stage, zoom }: { el: TextElement; stage: Konva.Stage; zoom: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(el.text);
  const node = stage.findOne(`#${el.id}`);
  const pos = node?.getAbsolutePosition() ?? { x: 0, y: 0 };
  useEffect(() => { const t = ref.current; if (t) { t.focus(); t.select(); } }, []);
  useEffect(() => { const t = ref.current; if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; } }, [value]);
  const done = () => {
    const api = useEditor.getState();
    if (value !== el.text) api.updateElement(el.id, { text: value } as Partial<DesignElement>);
    api.setEditingText(null);
  };
  return (
    <textarea
      ref={ref}
      data-testid="text-editor"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); done(); }
      }}
      spellCheck
      style={{
        position: 'absolute', left: pos.x, top: pos.y, width: el.width * zoom, minHeight: el.fontSize * el.lineHeight * zoom,
        transform: `rotate(${el.rotation}deg)`, transformOrigin: 'top left',
        fontFamily: el.fontFamily, fontSize: el.fontSize * zoom, fontWeight: el.fontWeight, fontStyle: el.italic ? 'italic' : 'normal',
        lineHeight: el.lineHeight, letterSpacing: el.letterSpacing * zoom, color: el.fill, textAlign: el.align, textTransform: el.uppercase ? 'uppercase' : 'none',
        background: 'transparent', border: 'none', outline: '2px solid #8b5cf6', outlineOffset: 2, padding: 0, margin: 0, resize: 'none', overflow: 'hidden',
      }}
    />
  );
}
