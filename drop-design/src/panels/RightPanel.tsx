import { useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalSpaceAround, ArrowDownToLine, ArrowUpToLine, Bold, ChevronDown, ChevronUp, Copy, Eye, EyeOff,
  FlipHorizontal2, FlipVertical2, Group, Image as ImageIcon, Italic, Lock, Shapes, Smile, Trash2, Type, Underline, Ungroup, Unlock,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, CaseUpper, Layers,
} from 'lucide-react';
import type { DesignElement, Fill, ImageElement, ShapeElement, TextElement } from '../model/types';
import { FORMATS } from '../model/types';
import { currentPage, useEditor } from '../store/editor';
import { ColorField, Slider } from '../components/ui';
import { FONTS } from '../lib/fonts';
import { useBrand } from '../lib/brand';
import { loadedImage } from '../lib/images';
import { coverCrop } from '../templates/kit';

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-b border-line px-4 py-4"><h3 className="label mb-3">{title}</h3><div className="space-y-3">{children}</div></section>
);
const Tool = ({ title, onClick, active, children, disabled }: { title: string; onClick: () => void; active?: boolean; children: ReactNode; disabled?: boolean }) => (
  <button title={title} aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick} className={`icon-btn ${active ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-100' : ''}`}>{children}</button>
);
function Num({ label, value, onChange, step = 1, min }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-muted">{label}</span>
      <input type="number" className="input px-2 py-1.5 tabular-nums" value={Math.round(value * 10) / 10} step={step} min={min}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} aria-label={label} />
    </label>
  );
}

export function RightPanel() {
  const [tab, setTab] = useState<'props' | 'layers'>('props');
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-l border-line bg-white md:flex lg:w-72" aria-label="Properties">
      <div className="flex border-b border-line">
        {(['props', 'layers'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2.5 text-sm font-semibold ${tab === t ? 'border-b-2 border-ink text-ink' : 'text-muted'}`}>{t === 'props' ? 'Properties' : 'Layers'}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'props' ? <Properties /> : <LayersList />}</div>
    </aside>
  );
}

function Properties() {
  const page = useEditor((s) => currentPage(s));
  const ids = useEditor((s) => s.selectedIds);
  const sel = page?.elements.filter((e) => ids.includes(e.id)) ?? [];
  if (!sel.length) return <PageProps />;
  const one = sel.length === 1 ? sel[0] : null;
  return (
    <>
      <Arrange sel={sel} />
      {one?.type === 'text' && <TextProps el={one} />}
      {one?.type === 'image' && <ImageProps el={one} />}
      {one?.type === 'shape' && <ShapeProps el={one} />}
      {one?.type === 'icon' && <IconProps el={one} />}
      {one && <Geometry el={one} />}
      <Effects sel={sel} />
    </>
  );
}

function usePatch(id: string) {
  return (patch: Partial<DesignElement>, key?: string) => useEditor.getState().updateElement(id, patch, key ? `${id}:${key}` : undefined);
}

function Arrange({ sel }: { sel: DesignElement[] }) {
  const s = useEditor.getState();
  const locked = sel.every((e) => e.locked);
  const isGroup = sel.length === 1 && sel[0].type === 'group';
  return (
    <Section title={sel.length > 1 ? `${sel.length} elements selected` : 'Arrange'}>
      <div className="flex flex-wrap gap-0.5">
        <Tool title="Bring forward" onClick={() => s.reorder('forward')}><ChevronUp size={16} /></Tool>
        <Tool title="Send backward" onClick={() => s.reorder('backward')}><ChevronDown size={16} /></Tool>
        <Tool title="Bring to front" onClick={() => s.reorder('front')}><ArrowUpToLine size={16} /></Tool>
        <Tool title="Send to back" onClick={() => s.reorder('back')}><ArrowDownToLine size={16} /></Tool>
        <Tool title="Duplicate (Ctrl+D)" onClick={() => s.duplicateSelected()}><Copy size={16} /></Tool>
        <Tool title={locked ? 'Unlock' : 'Lock'} active={locked} onClick={() => s.toggleLock()}>{locked ? <Lock size={16} /> : <Unlock size={16} />}</Tool>
        {sel.length > 1 && <Tool title="Group (Ctrl+G)" onClick={() => s.group()}><Group size={16} /></Tool>}
        {isGroup && <Tool title="Ungroup (Ctrl+Shift+G)" onClick={() => s.ungroup()}><Ungroup size={16} /></Tool>}
        <Tool title="Delete" onClick={() => s.deleteSelected()}><Trash2 size={16} className="text-danger" /></Tool>
      </div>
      <div>
        <p className="mb-1 text-[11px] font-semibold text-muted">{sel.length > 1 ? 'Align to each other' : 'Align to page'}</p>
        <div className="flex flex-wrap gap-0.5">
          <Tool title="Align left" onClick={() => s.align('left')}><AlignStartVertical size={16} /></Tool>
          <Tool title="Align centre" onClick={() => s.align('hcenter')}><AlignCenterVertical size={16} /></Tool>
          <Tool title="Align right" onClick={() => s.align('right')}><AlignEndVertical size={16} /></Tool>
          <Tool title="Align top" onClick={() => s.align('top')}><AlignStartHorizontal size={16} /></Tool>
          <Tool title="Align middle" onClick={() => s.align('vcenter')}><AlignCenterHorizontal size={16} /></Tool>
          <Tool title="Align bottom" onClick={() => s.align('bottom')}><AlignEndHorizontal size={16} /></Tool>
          {sel.length > 2 && <Tool title="Distribute horizontally" onClick={() => s.distribute('h')}><AlignHorizontalSpaceAround size={16} /></Tool>}
          {sel.length > 2 && <Tool title="Distribute vertically" onClick={() => s.distribute('v')}><AlignVerticalSpaceAround size={16} /></Tool>}
        </div>
      </div>
    </Section>
  );
}

function Geometry({ el }: { el: DesignElement }) {
  const patch = usePatch(el.id);
  return (
    <Section title="Position and size">
      <div className="grid grid-cols-2 gap-2">
        <Num label="X" value={el.x} onChange={(v) => patch({ x: v }, 'x')} />
        <Num label="Y" value={el.y} onChange={(v) => patch({ y: v }, 'y')} />
        <Num label="Width" value={el.width} min={1} onChange={(v) => patch(el.type === 'image' || el.type === 'icon' ? { width: v, height: v * (el.height / el.width) } : { width: v }, 'w')} />
        {el.type !== 'text' && <Num label="Height" value={el.height} min={1} onChange={(v) => patch(el.type === 'image' || el.type === 'icon' ? { height: v, width: v * (el.width / el.height) } : { height: v }, 'h')} />}
        <Num label="Rotation°" value={el.rotation} onChange={(v) => patch({ rotation: ((v % 360) + 360) % 360 }, 'rot')} />
      </div>
    </Section>
  );
}

function Effects({ sel }: { sel: DesignElement[] }) {
  const s = useEditor.getState();
  const first = sel[0];
  const all = (patch: Partial<DesignElement>, key: string) => s.updateElements(sel.map((e) => ({ id: e.id, patch })), `fx:${key}`);
  const sh = first.shadow;
  return (
    <Section title="Effects">
      <Slider label="Transparency" value={Math.round((1 - first.opacity) * 100)} min={0} max={100} suffix="%" onChange={(v) => all({ opacity: 1 - v / 100 }, 'op')} />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={!!sh} onChange={(e) => all({ shadow: e.target.checked ? { color: '#000000', blur: 24, offsetX: 0, offsetY: 10, opacity: 0.35 } : null }, 'shadow')} />Drop shadow
      </label>
      {sh && sel.length === 1 && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <ColorField label="Shadow colour" value={sh.color} onChange={(c) => all({ shadow: { ...sh, color: c } }, 'shc')} />
          <Slider label="Blur" value={sh.blur} min={0} max={100} onChange={(v) => all({ shadow: { ...sh, blur: v } }, 'shb')} />
          <Slider label="Offset" value={sh.offsetY} min={-60} max={60} onChange={(v) => all({ shadow: { ...sh, offsetY: v, offsetX: v / 3 } }, 'sho')} />
          <Slider label="Strength" value={Math.round(sh.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => all({ shadow: { ...sh, opacity: v / 100 } }, 'shs')} />
        </div>
      )}
    </Section>
  );
}

function usePalette() {
  const { brand } = useBrand();
  return brand ? [brand.primary, brand.secondary, ...brand.palette].filter((c, i, a) => a.indexOf(c) === i) : [];
}

function TextProps({ el }: { el: TextElement }) {
  const patch = usePatch(el.id);
  const palette = usePalette();
  const fonts = FONTS.includes(el.fontFamily) ? FONTS : [el.fontFamily, ...FONTS];
  return (
    <Section title="Text">
      <select className="input" value={el.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} aria-label="Font" style={{ fontFamily: el.fontFamily }}>
        {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Num label="Size" value={el.fontSize} min={4} onChange={(v) => patch({ fontSize: Math.max(4, v) }, 'fs')} />
        <label className="block"><span className="text-[11px] font-semibold text-muted">Weight</span>
          <select className="input px-2 py-1.5" value={el.fontWeight} onChange={(e) => patch({ fontWeight: Number(e.target.value) })} aria-label="Font weight">
            {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{({ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' } as Record<number, string>)[w]}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-0.5">
        <Tool title="Bold" active={el.fontWeight >= 700} onClick={() => patch({ fontWeight: el.fontWeight >= 700 ? 400 : 700 })}><Bold size={16} /></Tool>
        <Tool title="Italic" active={el.italic} onClick={() => patch({ italic: !el.italic })}><Italic size={16} /></Tool>
        <Tool title="Underline" active={el.underline} onClick={() => patch({ underline: !el.underline })}><Underline size={16} /></Tool>
        <Tool title="Uppercase" active={el.uppercase} onClick={() => patch({ uppercase: !el.uppercase })}><CaseUpper size={16} /></Tool>
        <span className="mx-1 w-px bg-line" />
        <Tool title="Align left" active={el.align === 'left'} onClick={() => patch({ align: 'left' })}><AlignLeft size={16} /></Tool>
        <Tool title="Align centre" active={el.align === 'center'} onClick={() => patch({ align: 'center' })}><AlignCenter size={16} /></Tool>
        <Tool title="Align right" active={el.align === 'right'} onClick={() => patch({ align: 'right' })}><AlignRight size={16} /></Tool>
        <Tool title="Justify" active={el.align === 'justify'} onClick={() => patch({ align: 'justify' })}><AlignJustify size={16} /></Tool>
      </div>
      <ColorField label="Colour" value={el.fill} onChange={(c) => patch({ fill: c }, 'fill')} swatches={palette} />
      <Slider label="Line spacing" value={el.lineHeight} min={0.7} max={2.5} step={0.05} onChange={(v) => patch({ lineHeight: v }, 'lh')} />
      <Slider label="Letter spacing" value={el.letterSpacing} min={-10} max={60} step={0.5} onChange={(v) => patch({ letterSpacing: v }, 'ls')} />
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={!!el.stroke} onChange={(e) => patch({ stroke: e.target.checked ? { color: '#000000', width: Math.max(2, el.fontSize / 30) } : null })} />Outline
      </label>
      {el.stroke && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <ColorField label="Outline colour" value={el.stroke.color} onChange={(c) => patch({ stroke: { ...el.stroke!, color: c } }, 'stc')} />
          <Slider label="Outline thickness" value={el.stroke.width} min={0.5} max={30} step={0.5} onChange={(v) => patch({ stroke: { ...el.stroke!, width: v } }, 'stw')} />
          <button className="btn-ghost btn-sm" onClick={() => patch({ fill: 'rgba(0,0,0,0)' })}>Hollow letters (outline only)</button>
        </div>
      )}
      <p className="text-xs text-muted">Double-click the text on the page (or press Enter) to change the words.</p>
    </Section>
  );
}

function ImageProps({ el }: { el: ImageElement }) {
  const patch = usePatch(el.id);
  const img = loadedImage(el.src);
  const base = coverCrop(img?.naturalWidth ?? el.width, img?.naturalHeight ?? el.height, el.width, el.height);
  const crop = el.crop ?? base;
  const zoom = base.width / crop.width;
  const setZoom = (z: number) => {
    const w = base.width / z, h = base.height / z;
    const cx = crop.x + crop.width / 2, cy = crop.y + crop.height / 2;
    patch({ crop: { width: w, height: h, x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)) } }, 'crop');
  };
  const panX = crop.width < 1 ? crop.x / (1 - crop.width) : 0.5;
  const panY = crop.height < 1 ? crop.y / (1 - crop.height) : 0.5;
  return (
    <Section title="Image">
      <div className="space-y-2 rounded-xl bg-slate-50 p-3">
        <p className="text-xs font-semibold text-muted">Crop</p>
        <Slider label="Zoom" value={Math.round(zoom * 100) / 100} min={1} max={4} step={0.05} onChange={setZoom} suffix="×" />
        <Slider label="Move left / right" value={Math.round(panX * 100)} min={0} max={100} onChange={(v) => patch({ crop: { ...crop, x: (1 - crop.width) * (v / 100) } }, 'cropx')} suffix="%" />
        <Slider label="Move up / down" value={Math.round(panY * 100)} min={0} max={100} onChange={(v) => patch({ crop: { ...crop, y: (1 - crop.height) * (v / 100) } }, 'cropy')} suffix="%" />
        <button className="btn-ghost btn-sm" onClick={() => patch({ crop: base })}>Reset crop</button>
      </div>
      <div className="flex gap-0.5">
        <Tool title="Flip horizontally" active={el.flipX} onClick={() => patch({ flipX: !el.flipX })}><FlipHorizontal2 size={16} /></Tool>
        <Tool title="Flip vertically" active={el.flipY} onClick={() => patch({ flipY: !el.flipY })}><FlipVertical2 size={16} /></Tool>
        <button className="btn-ghost btn-sm ml-auto" onClick={() => {
          const s = useEditor.getState();
          s.update((d) => { const p = d.pages[s.pageIndex]; p.background.image = { src: el.src, opacity: el.opacity }; p.elements = p.elements.filter((e) => e.id !== el.id); });
          s.select([]);
        }}>Set as background</button>
      </div>
      <Slider label="Rounded corners" value={el.cornerRadius ?? 0} min={0} max={Math.round(Math.min(el.width, el.height) / 2)} onChange={(v) => patch({ cornerRadius: v }, 'radius')} />
      <Slider label="Border thickness" value={el.strokeWidth ?? 0} min={0} max={40} onChange={(v) => patch({ strokeWidth: v, stroke: el.stroke ?? '#ffffff' }, 'bw')} />
      {(el.strokeWidth ?? 0) > 0 && <ColorField label="Border colour" value={el.stroke ?? '#ffffff'} onChange={(c) => patch({ stroke: c }, 'bc')} />}
      <Slider label="Brightness" value={Math.round((el.brightness ?? 0) * 100)} min={-60} max={60} onChange={(v) => patch({ brightness: v / 100 }, 'br')} />
      <Slider label="Contrast" value={el.contrast ?? 0} min={-60} max={60} onChange={(v) => patch({ contrast: v }, 'ct')} />
      <Slider label="Blur" value={el.blur ?? 0} min={0} max={30} onChange={(v) => patch({ blur: v }, 'blur')} />
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!!el.grayscale} onChange={(e) => patch({ grayscale: e.target.checked })} />Black and white</label>
    </Section>
  );
}

function ShapeProps({ el }: { el: ShapeElement }) {
  const patch = usePatch(el.id);
  const palette = usePalette();
  const isLine = el.shape === 'line' || el.shape === 'arrow';
  const fill = el.fill;
  const gradient = typeof fill !== 'string';
  return (
    <Section title={isLine ? 'Line' : 'Shape'}>
      {!isLine && (
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-semibold">
          <button className={`flex-1 rounded-md py-1 ${!gradient ? 'bg-white shadow' : ''}`} onClick={() => patch({ fill: gradient ? (fill as { colors: string[] }).colors[0] : fill })}>Solid</button>
          <button className={`flex-1 rounded-md py-1 ${gradient ? 'bg-white shadow' : ''}`} onClick={() => patch({ fill: gradient ? fill : { type: 'linear', colors: [fill as string, '#0b0b0d'], angle: 135 } as Fill })}>Gradient</button>
        </div>
      )}
      {typeof fill === 'string'
        ? <ColorField label={isLine ? 'Colour' : 'Fill colour'} value={fill.startsWith('#') ? fill : '#ffffff'} onChange={(c) => patch({ fill: c }, 'fill')} swatches={palette} />
        : (
          <>
            <div className="grid grid-cols-2 gap-2">{fill.colors.slice(0, 2).map((c, i) => <ColorField key={i} label={`Colour ${i + 1}`} value={c} onChange={(v) => patch({ fill: { ...fill, colors: fill.colors.map((x, j) => (j === i ? v : x)) } }, `g${i}`)} />)}</div>
            <Slider label="Angle" value={fill.angle} min={0} max={360} suffix="°" onChange={(v) => patch({ fill: { ...fill, angle: v } }, 'ga')} />
          </>
        )}
      {!isLine && fill === 'rgba(0,0,0,0)' && <p className="text-xs text-muted">No fill: outline only.</p>}
      {!isLine && <button className="btn-ghost btn-sm" onClick={() => patch({ fill: 'rgba(0,0,0,0)', strokeWidth: el.strokeWidth || 6 })}>Remove fill</button>}
      <Slider label={isLine ? 'Thickness' : 'Border thickness'} value={el.strokeWidth} min={0} max={60} onChange={(v) => patch({ strokeWidth: v }, 'sw')} />
      {!isLine && el.strokeWidth > 0 && <ColorField label="Border colour" value={el.stroke} onChange={(c) => patch({ stroke: c }, 'stroke')} swatches={palette} />}
      {el.shape === 'rect' && <Slider label="Corner radius" value={el.cornerRadius} min={0} max={Math.round(Math.min(el.width, el.height) / 2)} onChange={(v) => patch({ cornerRadius: v }, 'cr')} />}
      <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!!el.dash} onChange={(e) => patch({ dash: e.target.checked })} />Dashed {isLine ? 'line' : 'border'}</label>
    </Section>
  );
}

function IconProps({ el }: { el: Extract<DesignElement, { type: 'icon' }> }) {
  const patch = usePatch(el.id);
  return (
    <Section title="Icon">
      <ColorField label="Colour" value={el.color} onChange={(c) => patch({ color: c }, 'color')} swatches={usePalette()} />
      <Slider label="Line thickness" value={el.strokeWidth} min={0.5} max={4} step={0.25} onChange={(v) => patch({ strokeWidth: v }, 'isw')} />
    </Section>
  );
}

function PageProps() {
  const design = useEditor((s) => s.design)!;
  const [fmt, setFmt] = useState(design.format);
  const [w, setW] = useState(design.width);
  const [h, setH] = useState(design.height);
  const [scale, setScale] = useState(true);
  const preset = FORMATS.find((f) => f.id === fmt);
  const tw = preset ? preset.width : w, th = preset ? preset.height : h;
  return (
    <>
      <Section title="Page">
        <p className="text-sm">{design.width} × {design.height} px · {FORMATS.find((f) => f.id === design.format)?.label ?? 'Custom size'}</p>
        <p className="text-xs text-muted">Click an element to edit it. Shift-click or drag a box to select several.</p>
      </Section>
      <Section title="Resize">
        <select className="input" value={fmt} onChange={(e) => setFmt(e.target.value)} aria-label="Format">
          {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label} ({f.width}×{f.height})</option>)}
          <option value="custom">Custom size</option>
        </select>
        {!preset && <div className="grid grid-cols-2 gap-2"><Num label="Width px" value={w} min={50} onChange={setW} /><Num label="Height px" value={h} min={50} onChange={setH} /></div>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} />Scale content to fit</label>
        <button className="btn-primary btn-sm w-full" disabled={tw < 50 || th < 50 || tw > 8000 || th > 8000 || (tw === design.width && th === design.height)}
          onClick={() => useEditor.getState().resize(tw, th, preset ? preset.id : 'custom', scale)}>Resize design</button>
      </Section>
    </>
  );
}

const TypeIcon = ({ e }: { e: DesignElement }) => e.type === 'text' ? <Type size={14} /> : e.type === 'image' ? <ImageIcon size={14} /> : e.type === 'icon' ? <Smile size={14} /> : e.type === 'group' ? <Layers size={14} /> : <Shapes size={14} />;
const label = (e: DesignElement) => e.type === 'text' ? (e.text.split('\n')[0].slice(0, 28) || 'Text') : e.name ?? (e.type === 'shape' ? e.shape : e.type);

function LayersList() {
  const page = useEditor((s) => currentPage(s));
  const ids = useEditor((s) => s.selectedIds);
  const [drag, setDrag] = useState<string | null>(null);
  if (!page) return null;
  const s = useEditor.getState;
  const top = [...page.elements].reverse();
  if (!top.length) return <p className="p-4 text-sm text-muted">This page is empty.</p>;
  return (
    <ul className="p-2" aria-label="Layers">
      {top.map((e) => (
        <li key={e.id} draggable onDragStart={() => setDrag(e.id)} onDragOver={(ev) => ev.preventDefault()}
          onDrop={() => { if (drag && drag !== e.id) s().moveLayer(drag, page.elements.findIndex((x) => x.id === e.id)); setDrag(null); }}
          className={`group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${ids.includes(e.id) ? 'bg-brand-50 font-semibold' : 'hover:bg-slate-50'}`}
          onClick={(ev) => s().select([e.id], ev.shiftKey || ev.metaKey || ev.ctrlKey)}>
          <span className="text-muted"><TypeIcon e={e} /></span>
          <span className={`min-w-0 flex-1 truncate ${e.hidden ? 'text-muted line-through' : ''}`}>{label(e)}</span>
          <button className="rounded p-1 text-muted hover:bg-white" aria-label={e.hidden ? 'Show' : 'Hide'} title={e.hidden ? 'Show' : 'Hide'} onClick={(ev) => { ev.stopPropagation(); s().updateElement(e.id, { hidden: !e.hidden }); }}>{e.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          <button className={`rounded p-1 hover:bg-white ${e.locked ? 'text-warn' : 'text-muted'}`} aria-label={e.locked ? 'Unlock' : 'Lock'} title={e.locked ? 'Unlock' : 'Lock'} onClick={(ev) => { ev.stopPropagation(); s().updateElement(e.id, { locked: !e.locked }); }}>{e.locked ? <Lock size={14} /> : <Unlock size={14} />}</button>
        </li>
      ))}
      <p className="px-2 pt-2 text-xs text-muted">Top of the list is in front. Drag to reorder.</p>
    </ul>
  );
}
