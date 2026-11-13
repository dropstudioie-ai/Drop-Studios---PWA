import type { DesignElement } from '../model/types';
import { useEditor } from '../store/editor';
import { dropPayloadToElements, DRAG_MIME, type DropPayload } from '../editor/dropPayload';

/** Click-to-add (centred) for anything in the side panels. */
export async function addPayload(p: DropPayload) {
  const s = useEditor.getState();
  if (!s.design) return;
  const els = await dropPayloadToElements(p, null, { width: s.design.width, height: s.design.height });
  if (els.length) s.addElements(els);
}
export const addElement = (element: DesignElement) => addPayload({ kind: 'element', element });

/** Props that make a panel item draggable onto the canvas. */
export const dragProps = (p: DropPayload) => ({
  draggable: true,
  onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(DRAG_MIME, JSON.stringify(p)); e.dataTransfer.effectAllowed = 'copy'; },
});
