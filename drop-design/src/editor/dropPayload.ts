import type { DesignElement } from '../model/types';
import { cloneElement, makeIcon, makeImage } from '../model/elements';
import { assets } from '../storage/db';

export const DRAG_MIME = 'application/x-drop-design';

export type DropPayload =
  | { kind: 'element'; element: DesignElement }
  | { kind: 'icon'; icon: string; color?: string }
  | { kind: 'library'; src: string; width: number; height: number; name?: string }
  | { kind: 'asset'; id: string };

/** Turn something dragged (or clicked) in the side panel into elements placed on the page. */
export async function dropPayloadToElements(p: DropPayload, at: { x: number; y: number } | null, page: { width: number; height: number }): Promise<DesignElement[]> {
  let el: DesignElement | null = null;
  if (p.kind === 'element') el = cloneElement(p.element);
  if (p.kind === 'icon') { const s = Math.round(Math.min(page.width, page.height) * 0.15); el = makeIcon({ icon: p.icon, width: s, height: s, color: p.color ?? '#111827', name: p.icon }); }
  if (p.kind === 'library' || p.kind === 'asset') {
    let w = 0, h = 0, src = '', name = 'Image';
    if (p.kind === 'library') { w = p.width; h = p.height; src = p.src; name = p.name ?? name; }
    else {
      const a = await assets.get(p.id);
      if (!a) return [];
      w = a.width; h = a.height; src = `asset:${a.id}`; name = a.name;
    }
    // Fit into 60% of the page (backgrounds fill it).
    const s = Math.min((page.width * 0.6) / w, (page.height * 0.6) / h, 1.5);
    el = makeImage({ src, width: Math.round(w * s), height: Math.round(h * s), name });
  }
  if (!el) return [];
  const cx = at ? at.x : page.width / 2, cy = at ? at.y : page.height / 2;
  el.x = Math.round(cx - el.width / 2);
  el.y = Math.round(cy - el.height / 2);
  return [el];
}
