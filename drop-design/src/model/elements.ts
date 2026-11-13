import { nanoid } from 'nanoid';
import type { Design, DesignElement, GroupElement, Page, ShapeElement, TextElement, IconElement, ImageElement } from './types';

export const uid = () => nanoid(10);

/** Deep copy with fresh ids (for duplicate / paste / templates). */
export function cloneElement<T extends DesignElement>(el: T): T {
  const copy = structuredClone(el);
  const reid = (e: DesignElement) => {
    e.id = uid();
    if (e.type === 'group') e.children.forEach(reid);
  };
  reid(copy);
  return copy;
}

export function clonePage(p: Page): Page {
  return { ...structuredClone(p), id: uid(), elements: p.elements.map(cloneElement) };
}

export function newPage(fill = '#ffffff'): Page {
  return { id: uid(), background: { fill, image: null }, elements: [] };
}

export function newDesign(name: string, width: number, height: number, format = 'custom'): Design {
  const now = Date.now();
  return { id: uid(), name, width, height, format, pages: [newPage()], folderId: null, createdAt: now, updatedAt: now };
}

const base = { rotation: 0, opacity: 1 };

export function makeText(p: Partial<TextElement> & { text: string }): TextElement {
  return {
    ...base, id: uid(), type: 'text', x: 0, y: 0, width: 600, height: 80,
    fontFamily: 'Inter', fontSize: 48, fontWeight: 700, fill: '#111827', align: 'left', lineHeight: 1.15, letterSpacing: 0,
    ...p,
  };
}

export function makeShape(p: Partial<ShapeElement> & { shape: ShapeElement['shape'] }): ShapeElement {
  return {
    ...base, id: uid(), type: 'shape', x: 0, y: 0, width: 300, height: 300, fill: '#22d3a6', stroke: '#111827', strokeWidth: 0, cornerRadius: 0,
    ...p,
  };
}

export function makeIcon(p: Partial<IconElement> & { icon: string }): IconElement {
  return { ...base, id: uid(), type: 'icon', x: 0, y: 0, width: 160, height: 160, color: '#111827', strokeWidth: 2, ...p };
}

export function makeImage(p: Partial<ImageElement> & { src: string }): ImageElement {
  return { ...base, id: uid(), type: 'image', x: 0, y: 0, width: 600, height: 400, ...p };
}

/** Axis-aligned bounds of an element, taking rotation into account. */
export function bounds(el: Pick<DesignElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>) {
  const r = (el.rotation * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const pts = [[0, 0], [el.width, 0], [el.width, el.height], [0, el.height]].map(([px, py]) => [el.x + px * cos - py * sin, el.y + px * sin + py * cos]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function unionBounds(els: DesignElement[]) {
  const b = els.map(bounds);
  const x = Math.min(...b.map((v) => v.x)), y = Math.min(...b.map((v) => v.y));
  return { x, y, width: Math.max(...b.map((v) => v.x + v.width)) - x, height: Math.max(...b.map((v) => v.y + v.height)) - y };
}

/** Group top-level elements into one group (children keep their look, relative to the group). */
export function groupElements(els: DesignElement[]): GroupElement {
  const b = unionBounds(els);
  return {
    ...base, id: uid(), type: 'group', name: 'Group', x: b.x, y: b.y, width: b.width, height: b.height,
    children: els.map((e) => ({ ...structuredClone(e), x: e.x - b.x, y: e.y - b.y })),
  };
}

/** Undo a group: children go back to page coordinates, applying the group's rotation, scale and opacity. */
export function ungroupElement(g: GroupElement): DesignElement[] {
  const r = (g.rotation * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  return g.children.map((c) => ({
    ...structuredClone(c),
    x: g.x + c.x * cos - c.y * sin,
    y: g.y + c.x * sin + c.y * cos,
    rotation: (c.rotation + g.rotation) % 360,
    opacity: c.opacity * g.opacity,
  }));
}

/** Scale an element's content (used when a group or text is resized). */
export function scaleElement(el: DesignElement, sx: number, sy: number): DesignElement {
  const out = { ...el, x: el.x * sx, y: el.y * sy, width: el.width * sx, height: el.height * sy } as DesignElement;
  if (out.type === 'text') out.fontSize = Math.max(4, out.fontSize * Math.min(sx, sy));
  if (out.type === 'group') out.children = out.children.map((c) => scaleElement(c, sx, sy));
  if (out.type === 'shape' && out.cornerRadius) out.cornerRadius *= Math.min(sx, sy);
  return out;
}

/** Every colour used in a design, most used first (for "apply brand colours"). */
export function colorsUsed(d: Design): string[] {
  const n = new Map<string, number>();
  const add = (c: unknown) => { if (typeof c === 'string' && c.startsWith('#')) n.set(c.toLowerCase(), (n.get(c.toLowerCase()) ?? 0) + 1); };
  const walk = (e: DesignElement) => {
    if (e.type === 'text') add(e.fill);
    if (e.type === 'shape') { if (typeof e.fill === 'string') add(e.fill); else e.fill.colors.forEach(add); if (e.strokeWidth) add(e.stroke); }
    if (e.type === 'icon') add(e.color);
    if (e.type === 'group') e.children.forEach(walk);
  };
  d.pages.forEach((p) => { if (typeof p.background.fill === 'string') add(p.background.fill); else p.background.fill.colors.forEach(add); p.elements.forEach(walk); });
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/** Replace colours throughout a design (map keys lower-case). */
export function recolor(d: Design, map: Map<string, string>) {
  const m = (c: string) => map.get(c.toLowerCase()) ?? c;
  const walk = (e: DesignElement) => {
    if (e.type === 'text') e.fill = m(e.fill);
    if (e.type === 'shape') { e.fill = typeof e.fill === 'string' ? m(e.fill) : { ...e.fill, colors: e.fill.colors.map(m) }; e.stroke = m(e.stroke); }
    if (e.type === 'icon') e.color = m(e.color);
    if (e.type === 'group') e.children.forEach(walk);
  };
  d.pages.forEach((p) => {
    p.background.fill = typeof p.background.fill === 'string' ? m(p.background.fill) : { ...p.background.fill, colors: p.background.fill.colors.map(m) };
    p.elements.forEach(walk);
  });
}

export function walkElements(els: DesignElement[], fn: (e: DesignElement) => void) {
  for (const e of els) { fn(e); if (e.type === 'group') walkElements(e.children, fn); }
}

/** Scale a page's content from one canvas size to another (keeps proportions, centred). */
export function fitPage(p: Page, fromW: number, fromH: number, toW: number, toH: number): Page {
  if (fromW === toW && fromH === toH) return p;
  const s = Math.min(toW / fromW, toH / fromH);
  const ox = (toW - fromW * s) / 2, oy = (toH - fromH * s) / 2;
  return { ...p, elements: p.elements.map((e) => { const out = scaleElement(e, s, s); out.x += ox; out.y += oy; return out; }) };
}
