import { describe, expect, it, beforeEach } from 'vitest';
import { useEditor } from './editor';
import { makeShape, makeText, newDesign } from '../model/elements';

const s = () => useEditor.getState();

describe('editor store', () => {
  beforeEach(() => s().load(newDesign('Test', 1080, 1080, 'ig-square')));

  it('adds, updates, undoes and redoes', () => {
    const t = makeText({ text: 'Hello', x: 10, y: 10 });
    s().addElements([t]);
    s().updateElement(t.id, { x: 100 });
    expect(s().design!.pages[0].elements[0].x).toBe(100);
    s().undo();
    expect(s().design!.pages[0].elements[0].x).toBe(10);
    s().undo();
    expect(s().design!.pages[0].elements).toHaveLength(0);
    s().redo(); s().redo();
    expect(s().design!.pages[0].elements[0].x).toBe(100);
  });

  it('merges rapid slider changes into one undo step', () => {
    const t = makeText({ text: 'A' });
    s().addElements([t]);
    for (let i = 1; i <= 5; i++) s().updateElement(t.id, { opacity: 1 - i / 10 }, 'opacity');
    expect(s().past).toHaveLength(2);
    s().undo();
    expect(s().design!.pages[0].elements[0].opacity).toBe(1);
  });

  it('duplicates, copies, pastes and deletes (locked elements survive delete)', () => {
    const a = makeShape({ shape: 'rect', x: 0, y: 0 });
    const b = makeShape({ shape: 'rect', x: 500, y: 0, locked: true });
    s().addElements([a, b]);
    s().select([a.id]);
    s().duplicateSelected();
    expect(s().design!.pages[0].elements).toHaveLength(3);
    s().copy(); s().paste();
    expect(s().design!.pages[0].elements).toHaveLength(4);
    s().select([b.id]); s().deleteSelected();
    expect(s().design!.pages[0].elements.some((e) => e.id === b.id)).toBe(true);
  });

  it('groups and ungroups keeping positions', () => {
    const a = makeShape({ shape: 'rect', x: 100, y: 100, width: 100, height: 100 });
    const b = makeShape({ shape: 'ellipse', x: 300, y: 200, width: 50, height: 50 });
    s().addElements([a, b]);
    s().group();
    const g = s().design!.pages[0].elements[0];
    expect(g.type).toBe('group');
    expect([g.x, g.y, g.width, g.height]).toEqual([100, 100, 250, 150]);
    s().ungroup();
    const els = s().design!.pages[0].elements;
    expect(els.map((e) => [Math.round(e.x), Math.round(e.y)])).toEqual([[100, 100], [300, 200]]);
  });

  it('aligns one element to the page and distributes three evenly', () => {
    const a = makeShape({ shape: 'rect', x: 0, y: 0, width: 100, height: 100 });
    s().addElements([a]);
    s().align('hcenter');
    expect(s().design!.pages[0].elements[0].x).toBe(490);
    const b = makeShape({ shape: 'rect', x: 0, y: 0, width: 100, height: 100 });
    const c = makeShape({ shape: 'rect', x: 50, y: 0, width: 100, height: 100 });
    const d = makeShape({ shape: 'rect', x: 900, y: 0, width: 100, height: 100 });
    s().addElements([b, c, d]);
    s().distribute('h');
    const xs = s().design!.pages[0].elements.slice(1).map((e) => e.x).sort((p, q) => p - q);
    expect(xs).toEqual([0, 450, 900]);
  });

  it('reorders layers and manages pages', () => {
    const a = makeShape({ shape: 'rect' }), b = makeShape({ shape: 'rect' });
    s().addElements([a, b]);
    s().select([a.id]); s().reorder('front');
    expect(s().design!.pages[0].elements.at(-1)!.id).toBe(a.id);
    s().duplicatePage();
    expect(s().design!.pages).toHaveLength(2);
    expect(s().pageIndex).toBe(1);
    s().deletePage();
    expect(s().design!.pages).toHaveLength(1);
  });
});
