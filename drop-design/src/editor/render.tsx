// Renders a page's elements with Konva. Used by the editor canvas AND by exports/thumbnails,
// so what you see is exactly what you download.
import { useEffect, useMemo, useRef } from 'react';
import { Group, Image as KImage, Rect, Shape, Text } from 'react-konva';
import Konva from 'konva';
import type { DesignElement, Fill, ImageElement, Page, ShapeElement, TextElement } from '../model/types';
import { useImage } from '../lib/images';
import { iconDataUrl } from '../lib/icons';

export interface NodeHandlers {
  draggable?: boolean;
  onPointerDown?: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, el: DesignElement) => void;
  onDblClick?: (el: DesignElement) => void;
  onClick?: (el: DesignElement) => void;
  onDragStart?: (e: Konva.KonvaEventObject<DragEvent>, el: DesignElement) => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>, el: DesignElement) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>, el: DesignElement) => void;
  onTextMeasured?: (id: string, height: number) => void;
  hideId?: string | null; // text being edited in place
}

/** Konva gradient props for a fill inside a w×h box. */
export function fillProps(fill: Fill, w: number, h: number): Record<string, unknown> {
  if (typeof fill === 'string') return { fill };
  const stops = fill.colors.flatMap((c, i) => [fill.colors.length === 1 ? 0 : i / (fill.colors.length - 1), c]);
  if (fill.type === 'radial') {
    return { fillRadialGradientStartPoint: { x: w / 2, y: h / 2 }, fillRadialGradientEndPoint: { x: w / 2, y: h / 2 },
      fillRadialGradientStartRadius: 0, fillRadialGradientEndRadius: Math.max(w, h) / 1.4, fillRadialGradientColorStops: stops };
  }
  const a = ((fill.angle - 90) * Math.PI) / 180;
  const len = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
  const cx = w / 2, cy = h / 2;
  return { fillLinearGradientStartPoint: { x: cx - Math.cos(a) * len, y: cy - Math.sin(a) * len },
    fillLinearGradientEndPoint: { x: cx + Math.cos(a) * len, y: cy + Math.sin(a) * len }, fillLinearGradientColorStops: stops };
}

const shadowProps = (el: DesignElement) => el.shadow ? {
  shadowColor: el.shadow.color, shadowBlur: el.shadow.blur, shadowOffsetX: el.shadow.offsetX, shadowOffsetY: el.shadow.offsetY,
  shadowOpacity: el.shadow.opacity, shadowEnabled: true,
} : {};

function drawShape(ctx: Konva.Context, s: ShapeElement, w: number, h: number) {
  ctx.beginPath();
  switch (s.shape) {
    case 'rect': {
      const r = Math.max(0, Math.min(s.cornerRadius, w / 2, h / 2));
      ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r); ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r);
      break;
    }
    case 'ellipse': ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'triangle': ctx.moveTo(w / 2, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); break;
    case 'hexagon': for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 2; const f = i ? 'lineTo' : 'moveTo'; ctx[f](w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)); } break;
    case 'star': for (let i = 0; i < 10; i++) { const a = (Math.PI / 5) * i - Math.PI / 2; const r = i % 2 ? 0.45 : 1; const f = i ? 'lineTo' : 'moveTo'; ctx[f](w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)); } break;
    case 'blob':
      ctx.moveTo(w * 0.5, 0);
      ctx.bezierCurveTo(w * 0.85, 0, w, h * 0.25, w * 0.95, h * 0.5);
      ctx.bezierCurveTo(w * 0.9, h * 0.8, w * 0.7, h, w * 0.45, h * 0.97);
      ctx.bezierCurveTo(w * 0.15, h * 0.95, 0, h * 0.7, w * 0.04, h * 0.42);
      ctx.bezierCurveTo(w * 0.08, h * 0.12, w * 0.25, 0, w * 0.5, 0);
      break;
    case 'line': ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); return;
    case 'arrow': {
      const head = Math.min(h * 1.2, w * 0.4, 60 + s.strokeWidth * 2);
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.moveTo(w - head, h / 2 - head / 2); ctx.lineTo(w, h / 2); ctx.lineTo(w - head, h / 2 + head / 2);
      return;
    }
  }
  ctx.closePath();
}

function ShapeNode({ el, common }: { el: ShapeElement; common: Record<string, unknown> }) {
  const isLine = el.shape === 'line' || el.shape === 'arrow';
  return (
    <Shape
      {...common}
      {...(isLine ? {} : fillProps(el.fill, el.width, el.height))}
      stroke={isLine ? (typeof el.fill === 'string' ? el.fill : el.fill.colors[0]) : el.stroke}
      strokeWidth={isLine ? Math.max(1, el.strokeWidth || 6) : el.strokeWidth}
      strokeEnabled={isLine || el.strokeWidth > 0}
      lineCap="round" lineJoin="round"
      dash={el.dash ? [el.strokeWidth * 3 || 18, el.strokeWidth * 2 || 12] : undefined}
      hitStrokeWidth={isLine ? 30 : undefined}
      sceneFunc={(ctx, shape) => { drawShape(ctx, el, el.width, el.height); ctx.fillStrokeShape(shape); }}
    />
  );
}

function TextNode({ el, common, onMeasured, hidden }: { el: TextElement; common: Record<string, unknown>; onMeasured?: (id: string, h: number) => void; hidden?: boolean }) {
  const ref = useRef<Konva.Text>(null);
  useEffect(() => {
    const h = ref.current?.height();
    if (onMeasured && h && Math.abs(h - el.height) > 0.5) onMeasured(el.id, h);
  });
  return (
    <Text
      ref={ref}
      {...common}
      height={undefined}
      visible={!el.hidden && !hidden}
      text={el.uppercase ? el.text.toUpperCase() : el.text}
      fontFamily={el.fontFamily}
      fontSize={el.fontSize}
      fontStyle={`${el.italic ? 'italic ' : ''}${el.fontWeight}`}
      textDecoration={el.underline ? 'underline' : ''}
      fill={el.fill}
      align={el.align}
      lineHeight={el.lineHeight}
      letterSpacing={el.letterSpacing}
      wrap="word"
      stroke={el.stroke?.color}
      strokeWidth={el.stroke?.width ?? 0}
      strokeEnabled={Boolean(el.stroke && el.stroke.width > 0)}
      fillAfterStrokeEnabled
    />
  );
}

function ImageNode({ el, common }: { el: ImageElement; common: Record<string, unknown> }) {
  const img = useImage(el.src);
  const ref = useRef<Konva.Image>(null);
  const filtered = Boolean(el.brightness || el.contrast || el.grayscale || el.blur);
  const crop = useMemo(() => {
    if (!img || !el.crop) return undefined;
    const W = img.naturalWidth, H = img.naturalHeight;
    return { x: el.crop.x * W, y: el.crop.y * H, width: el.crop.width * W, height: el.crop.height * H };
  }, [img, el.crop]);
  useEffect(() => {
    const n = ref.current;
    if (!n || !img) return;
    if (filtered) { n.cache({ pixelRatio: 1 }); } else n.clearCache();
    n.getLayer()?.batchDraw();
  }, [img, filtered, el.brightness, el.contrast, el.grayscale, el.blur, el.width, el.height, crop, el.cornerRadius]);
  const filters = [el.brightness ? Konva.Filters.Brighten : null, el.contrast ? Konva.Filters.Contrast : null,
    el.grayscale ? Konva.Filters.Grayscale : null, el.blur ? Konva.Filters.Blur : null].filter(Boolean) as typeof Konva.Filters.Blur[];
  if (!img) {
    return <Rect {...common} fill="#e5e7eb" stroke="#cbd5e1" strokeWidth={2} dash={[12, 8]} />;
  }
  return (
    <KImage
      ref={ref}
      {...common}
      image={img}
      crop={crop}
      cornerRadius={el.cornerRadius ?? 0}
      stroke={el.stroke}
      strokeWidth={el.strokeWidth ?? 0}
      strokeEnabled={Boolean(el.strokeWidth)}
      scaleX={el.flipX ? -1 : 1}
      scaleY={el.flipY ? -1 : 1}
      offsetX={el.flipX ? el.width : 0}
      offsetY={el.flipY ? el.height : 0}
      filters={filters}
      brightness={el.brightness ?? 0}
      contrast={el.contrast ?? 0}
      blurRadius={el.blur ?? 0}
    />
  );
}

function IconNode({ el, common }: { el: Extract<DesignElement, { type: 'icon' }>; common: Record<string, unknown> }) {
  const src = useMemo(() => iconDataUrl(el.icon, el.color, el.strokeWidth), [el.icon, el.color, el.strokeWidth]);
  const img = useImage(src);
  return img ? <KImage {...common} image={img} /> : <Rect {...common} fill="transparent" />;
}

export function ElementNode({ el, h, nested }: { el: DesignElement; h?: NodeHandlers; nested?: boolean }) {
  const interactive = Boolean(h) && !nested;
  const common: Record<string, unknown> = {
    id: nested ? undefined : el.id,
    name: nested ? 'child' : 'element',
    x: el.x, y: el.y, width: el.width, height: el.height, rotation: el.rotation, opacity: el.opacity,
    visible: !el.hidden,
    draggable: interactive && h?.draggable !== false && !el.locked,
    listening: !nested,
    ...shadowProps(el),
    ...(interactive ? {
      onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => h!.onPointerDown?.(e, el),
      onTouchStart: (e: Konva.KonvaEventObject<TouchEvent>) => h!.onPointerDown?.(e, el),
      onDblClick: () => h!.onDblClick?.(el),
      onClick: () => h!.onClick?.(el),
      onTap: () => h!.onClick?.(el),
      onDblTap: () => h!.onDblClick?.(el),
      onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => h!.onDragStart?.(e, el),
      onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => h!.onDragMove?.(e, el),
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => h!.onDragEnd?.(e, el),
    } : {}),
  };
  switch (el.type) {
    case 'text': return <TextNode el={el} common={common} onMeasured={nested ? undefined : h?.onTextMeasured} hidden={h?.hideId === el.id} />;
    case 'shape': return <ShapeNode el={el} common={common} />;
    case 'image': return <ImageNode el={el} common={common} />;
    case 'icon': return <IconNode el={el} common={common} />;
    case 'group': {
      const { width: _w, height: _h, ...g } = common;
      void _w; void _h;
      return (
        <Group {...g}>
          {/* Invisible box so the whole group area is clickable and transformable. */}
          <Rect width={el.width} height={el.height} fill="rgba(0,0,0,0)" />
          {el.children.map((c) => <ElementNode key={c.id} el={c} nested />)}
        </Group>
      );
    }
  }
}

export function PageBackground({ page, width, height, transparent }: { page: Page; width: number; height: number; transparent?: boolean }) {
  const img = useImage(page.background.image?.src);
  const cover = useMemo(() => {
    if (!img) return null;
    const s = Math.max(width / img.naturalWidth, height / img.naturalHeight);
    const cw = width / s, ch = height / s;
    return { x: (img.naturalWidth - cw) / 2, y: (img.naturalHeight - ch) / 2, width: cw, height: ch };
  }, [img, width, height]);
  return (
    <>
      {!transparent && <Rect name="page-bg" x={0} y={0} width={width} height={height} {...fillProps(page.background.fill, width, height)} />}
      {transparent && <Rect name="page-bg" x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0)" />}
      {img && cover && <KImage name="page-bg" listening={false} image={img} x={0} y={0} width={width} height={height} crop={cover} opacity={page.background.image?.opacity ?? 1} />}
    </>
  );
}

export function PageContent({ page, width, height, handlers, transparent }: { page: Page; width: number; height: number; handlers?: NodeHandlers; transparent?: boolean }) {
  return (
    <>
      <PageBackground page={page} width={width} height={height} transparent={transparent} />
      {page.elements.map((el) => <ElementNode key={el.id} el={el} h={handlers} />)}
    </>
  );
}
