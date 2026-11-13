// Small helpers for writing templates compactly. Every template is plain data:
// once opened, each piece is an independent, editable element.
import type { Design, DesignElement, Fill, Page, ShapeElement, TextElement } from '../model/types';
import { formatById } from '../model/types';
import { makeIcon, makeImage, makeShape, makeText, uid } from '../model/elements';
import { lib } from '../assets/library';

export type TemplateCategory = 'Fitness and Gym' | 'Corporate Wellness' | 'Social Media' | 'Business and Presentations';

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  format: string;
  tags: string[];
  pages: () => Page[];
}

export const t = (text: string, x: number, y: number, width: number, fontSize: number, o: Partial<TextElement> = {}) =>
  makeText({ text, x, y, width, fontSize, height: fontSize * 1.2, ...o });

export const r = (x: number, y: number, width: number, height: number, fill: Fill, o: Partial<ShapeElement> = {}) =>
  makeShape({ shape: 'rect', x, y, width, height, fill, strokeWidth: 0, ...o });

export const sh = (shape: ShapeElement['shape'], x: number, y: number, width: number, height: number, fill: Fill, o: Partial<ShapeElement> = {}) =>
  makeShape({ shape, x, y, width, height, fill, strokeWidth: 0, ...o });

export const ic = (icon: string, x: number, y: number, size: number, color: string, strokeWidth = 2) =>
  makeIcon({ icon, x, y, width: size, height: size, color, strokeWidth, name: icon });

/** Crop (as fractions) so an image covers a w×h frame, centred on a focus point. */
export function coverCrop(iw: number, ih: number, w: number, h: number, fx = 0.5, fy = 0.5) {
  const s = Math.max(w / iw, h / ih);
  const cw = w / s / iw, ch = h / s / ih;
  return { x: Math.min(1 - cw, Math.max(0, fx - cw / 2)), y: Math.min(1 - ch, Math.max(0, fy - ch / 2)), width: cw, height: ch };
}

export function im(match: string, x: number, y: number, width: number, height: number, o: { fx?: number; fy?: number; radius?: number; opacity?: number; grayscale?: boolean } = {}) {
  const L = lib(match);
  return makeImage({
    src: L.src, name: L.name, x, y, width, height, crop: coverCrop(L.width, L.height, width, height, o.fx, o.fy),
    cornerRadius: o.radius ?? 0, opacity: o.opacity ?? 1, grayscale: o.grayscale,
  });
}

export const page = (fill: Fill, elements: DesignElement[], image?: { src: string; opacity: number }): Page =>
  ({ id: uid(), background: { fill, image: image ?? null }, elements });

export const grad = (colors: string[], angle = 135): Fill => ({ type: 'linear', colors, angle });

/** Make a fresh, editable design from a template. */
export function designFromTemplate(tp: Template, name?: string): Design {
  const f = formatById(tp.format)!;
  const now = Date.now();
  return { id: uid(), name: name ?? tp.name, width: f.width, height: f.height, format: f.id, pages: tp.pages(), folderId: null, createdAt: now, updatedAt: now };
}
