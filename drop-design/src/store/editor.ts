import { create } from 'zustand';
import type { Design, DesignElement, Page } from '../model/types';
import { bounds, cloneElement, clonePage, groupElements, newPage, ungroupElement, unionBounds } from '../model/elements';

const HISTORY_LIMIT = 100;

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';
type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

interface EditorState {
  design: Design | null;
  pageIndex: number;
  selectedIds: string[];
  editingTextId: string | null;
  zoom: number;
  showGrid: boolean;
  snap: boolean;
  past: Design[];
  future: Design[];
  /** Coalesces rapid changes (slider drags, typing) into one undo step. */
  mergeKey: string | null;
  mergeAt: number;
  clipboard: DesignElement[];
  saveStatus: SaveStatus;
  /** Bumped to ask the canvas to zoom-to-fit. */
  fitNonce: number;
  requestFit: () => void;

  load: (d: Design) => void;
  close: () => void;
  /** Apply a change to the design as one undoable step. */
  update: (recipe: (d: Design) => void, mergeKey?: string) => void;
  undo: () => void;
  redo: () => void;
  setZoom: (z: number) => void;
  setPage: (i: number) => void;
  select: (ids: string[], additive?: boolean) => void;
  setEditingText: (id: string | null) => void;
  setSaveStatus: (s: SaveStatus) => void;
  toggleGrid: () => void;
  toggleSnap: () => void;

  addElements: (els: DesignElement[], select?: boolean) => void;
  updateElement: (id: string, patch: Partial<DesignElement>, mergeKey?: string) => void;
  updateElements: (patches: { id: string; patch: Partial<DesignElement> }[], mergeKey?: string) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  reorder: (dir: 'forward' | 'backward' | 'front' | 'back') => void;
  moveLayer: (id: string, toIndex: number) => void;
  group: () => void;
  ungroup: () => void;
  toggleLock: () => void;
  align: (a: Align) => void;
  distribute: (axis: 'h' | 'v') => void;
  nudge: (dx: number, dy: number) => void;
  /** Keep a text box's stored height in step with its rendered text (not an undo step). */
  syncTextHeight: (id: string, height: number) => void;

  addPage: () => void;
  duplicatePage: () => void;
  deletePage: () => void;
  movePage: (from: number, to: number) => void;
  resize: (width: number, height: number, format: string, scaleContent: boolean) => void;
}

export const currentPage = (s: Pick<EditorState, 'design' | 'pageIndex'>): Page | null => s.design?.pages[s.pageIndex] ?? null;
export const selectedElements = (s: EditorState): DesignElement[] => {
  const p = currentPage(s);
  return p ? p.elements.filter((e) => s.selectedIds.includes(e.id)) : [];
};

export const useEditor = create<EditorState>((set, get) => {
  function commit(recipe: (d: Design) => void, mergeKey?: string) {
    const { design, past, mergeKey: lastKey, mergeAt } = get();
    if (!design) return;
    const next = structuredClone(design);
    recipe(next);
    next.updatedAt = Date.now();
    const merge = mergeKey && mergeKey === lastKey && Date.now() - mergeAt < 1500;
    set({
      design: next,
      past: merge ? past : [...past, design].slice(-HISTORY_LIMIT),
      future: [],
      mergeKey: mergeKey ?? null,
      mergeAt: Date.now(),
      saveStatus: 'unsaved',
    });
  }
  const page = (d: Design) => d.pages[get().pageIndex];
  const sel = () => get().selectedIds;

  return {
    design: null, pageIndex: 0, selectedIds: [], editingTextId: null, zoom: 0.5, showGrid: false, snap: true,
    past: [], future: [], mergeKey: null, mergeAt: 0, clipboard: [], saveStatus: 'saved', fitNonce: 0,
    requestFit: () => set((st) => ({ fitNonce: st.fitNonce + 1 })),

    load: (d) => set({ design: d, pageIndex: 0, selectedIds: [], editingTextId: null, past: [], future: [], saveStatus: 'saved' }),
    close: () => set({ design: null, selectedIds: [], past: [], future: [] }),
    update: commit,
    undo: () => {
      const { past, design, future } = get();
      if (!past.length || !design) return;
      const prev = past[past.length - 1];
      set({ design: prev, past: past.slice(0, -1), future: [design, ...future], mergeKey: null, saveStatus: 'unsaved',
        pageIndex: Math.min(get().pageIndex, prev.pages.length - 1), editingTextId: null,
        selectedIds: get().selectedIds.filter((id) => prev.pages.some((p) => p.elements.some((e) => e.id === id))) });
    },
    redo: () => {
      const { past, design, future } = get();
      if (!future.length || !design) return;
      const next = future[0];
      set({ design: next, past: [...past, design], future: future.slice(1), mergeKey: null, saveStatus: 'unsaved',
        pageIndex: Math.min(get().pageIndex, next.pages.length - 1), editingTextId: null });
    },
    setZoom: (z) => set({ zoom: Math.min(4, Math.max(0.05, z)) }),
    setPage: (i) => set({ pageIndex: i, selectedIds: [], editingTextId: null }),
    select: (ids, additive) => set((s) => ({
      selectedIds: additive ? [...new Set(s.selectedIds.filter((x) => !ids.includes(x)).concat(ids.filter((x) => !s.selectedIds.includes(x))))] : ids,
      editingTextId: null,
    })),
    setEditingText: (id) => set({ editingTextId: id, selectedIds: id ? [id] : get().selectedIds }),
    setSaveStatus: (s) => set({ saveStatus: s }),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    toggleSnap: () => set((s) => ({ snap: !s.snap })),

    addElements: (els, select = true) => {
      commit((d) => { page(d).elements.push(...els); });
      if (select) set({ selectedIds: els.map((e) => e.id) });
    },
    updateElement: (id, patch, mergeKey) => commit((d) => {
      const els = page(d).elements;
      const i = els.findIndex((e) => e.id === id);
      if (i >= 0) els[i] = { ...els[i], ...patch } as DesignElement;
    }, mergeKey),
    updateElements: (patches, mergeKey) => commit((d) => {
      const els = page(d).elements;
      for (const { id, patch } of patches) {
        const i = els.findIndex((e) => e.id === id);
        if (i >= 0) els[i] = { ...els[i], ...patch } as DesignElement;
      }
    }, mergeKey),
    deleteSelected: () => {
      const ids = sel();
      if (!ids.length) return;
      commit((d) => { const p = page(d); p.elements = p.elements.filter((e) => !ids.includes(e.id) || e.locked); });
      set({ selectedIds: [] });
    },
    duplicateSelected: () => {
      const d = get().design; if (!d) return;
      const src = page(d).elements.filter((e) => sel().includes(e.id));
      if (!src.length) return;
      const copies = src.map((e) => ({ ...cloneElement(e), x: e.x + 30, y: e.y + 30, locked: false }));
      get().addElements(copies);
    },
    copy: () => {
      const d = get().design; if (!d) return;
      set({ clipboard: page(d).elements.filter((e) => sel().includes(e.id)).map((e) => structuredClone(e)) });
    },
    cut: () => { get().copy(); get().deleteSelected(); },
    paste: () => {
      const { clipboard } = get();
      if (!clipboard.length) return;
      const copies = clipboard.map((e) => ({ ...cloneElement(e), x: e.x + 30, y: e.y + 30 }));
      set({ clipboard: copies.map((e) => structuredClone(e)) }); // next paste offsets again
      get().addElements(copies);
    },
    reorder: (dir) => commit((d) => {
      const p = page(d);
      const ids = sel();
      const picked = p.elements.filter((e) => ids.includes(e.id));
      const rest = p.elements.filter((e) => !ids.includes(e.id));
      if (!picked.length) return;
      if (dir === 'front') p.elements = [...rest, ...picked];
      else if (dir === 'back') p.elements = [...picked, ...rest];
      else {
        const arr = [...p.elements];
        const order = dir === 'forward' ? [...arr.keys()].reverse() : [...arr.keys()];
        for (const i of order) {
          if (!ids.includes(arr[i].id)) continue;
          const j = dir === 'forward' ? i + 1 : i - 1;
          if (j < 0 || j >= arr.length || ids.includes(arr[j].id)) continue;
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        p.elements = arr;
      }
    }),
    moveLayer: (id, toIndex) => commit((d) => {
      const p = page(d);
      const from = p.elements.findIndex((e) => e.id === id);
      if (from < 0) return;
      const [el] = p.elements.splice(from, 1);
      p.elements.splice(Math.max(0, Math.min(p.elements.length, toIndex)), 0, el);
    }),
    group: () => {
      const d = get().design; if (!d) return;
      const ids = sel();
      const picked = page(d).elements.filter((e) => ids.includes(e.id) && !e.locked);
      if (picked.length < 2) return;
      const g = groupElements(picked);
      commit((dd) => {
        const p = page(dd);
        const at = p.elements.findIndex((e) => e.id === picked[picked.length - 1].id);
        p.elements = p.elements.filter((e) => !picked.some((x) => x.id === e.id));
        p.elements.splice(Math.min(at - picked.length + 1, p.elements.length), 0, g);
      });
      set({ selectedIds: [g.id] });
    },
    ungroup: () => {
      const d = get().design; if (!d) return;
      const groups = page(d).elements.filter((e) => sel().includes(e.id) && e.type === 'group');
      if (!groups.length) return;
      const newIds: string[] = [];
      commit((dd) => {
        const p = page(dd);
        for (const g of groups) {
          const i = p.elements.findIndex((e) => e.id === g.id);
          const kids = ungroupElement(g as Extract<DesignElement, { type: 'group' }>);
          newIds.push(...kids.map((k) => k.id));
          p.elements.splice(i, 1, ...kids);
        }
      });
      set({ selectedIds: newIds });
    },
    toggleLock: () => {
      const d = get().design; if (!d) return;
      const picked = page(d).elements.filter((e) => sel().includes(e.id));
      const lock = !picked.every((e) => e.locked);
      get().updateElements(picked.map((e) => ({ id: e.id, patch: { locked: lock } })));
    },
    align: (a) => {
      const d = get().design; if (!d) return;
      const picked = page(d).elements.filter((e) => sel().includes(e.id) && !e.locked);
      if (!picked.length) return;
      // One element aligns to the page; several align to each other.
      const box = picked.length === 1 ? { x: 0, y: 0, width: d.width, height: d.height } : unionBounds(picked);
      get().updateElements(picked.map((e) => {
        const b = bounds(e);
        const dx = a === 'left' ? box.x - b.x : a === 'right' ? box.x + box.width - (b.x + b.width) : a === 'hcenter' ? box.x + box.width / 2 - (b.x + b.width / 2) : 0;
        const dy = a === 'top' ? box.y - b.y : a === 'bottom' ? box.y + box.height - (b.y + b.height) : a === 'vcenter' ? box.y + box.height / 2 - (b.y + b.height / 2) : 0;
        return { id: e.id, patch: { x: e.x + dx, y: e.y + dy } };
      }));
    },
    distribute: (axis) => {
      const d = get().design; if (!d) return;
      const picked = page(d).elements.filter((e) => sel().includes(e.id) && !e.locked);
      if (picked.length < 3) return;
      const withB = picked.map((e) => ({ e, b: bounds(e) })).sort((p, q) => (axis === 'h' ? p.b.x - q.b.x : p.b.y - q.b.y));
      const first = withB[0].b, last = withB[withB.length - 1].b;
      const span = axis === 'h' ? last.x + last.width - first.x : last.y + last.height - first.y;
      const total = withB.reduce((n, w) => n + (axis === 'h' ? w.b.width : w.b.height), 0);
      const gap = (span - total) / (withB.length - 1);
      let cursor = axis === 'h' ? first.x : first.y;
      get().updateElements(withB.map(({ e, b }) => {
        const delta = cursor - (axis === 'h' ? b.x : b.y);
        cursor += (axis === 'h' ? b.width : b.height) + gap;
        return { id: e.id, patch: axis === 'h' ? { x: e.x + delta } : { y: e.y + delta } };
      }));
    },
    nudge: (dx, dy) => {
      const d = get().design; if (!d) return;
      const picked = page(d).elements.filter((e) => sel().includes(e.id) && !e.locked);
      if (picked.length) get().updateElements(picked.map((e) => ({ id: e.id, patch: { x: e.x + dx, y: e.y + dy } })), 'nudge');
    },

    syncTextHeight: (id, height) => {
      const d = get().design; if (!d) return;
      const p = d.pages[get().pageIndex];
      const i = p.elements.findIndex((e) => e.id === id);
      if (i < 0 || Math.abs(p.elements[i].height - height) < 0.5) return;
      const next = { ...d, pages: d.pages.map((pg, pi) => pi !== get().pageIndex ? pg : { ...pg, elements: pg.elements.map((e) => e.id === id ? { ...e, height } : e) }) };
      set({ design: next });
    },

    addPage: () => { commit((d) => { d.pages.splice(get().pageIndex + 1, 0, newPage(typeof page(d).background.fill === 'string' ? page(d).background.fill as string : '#ffffff')); }); set({ pageIndex: get().pageIndex + 1, selectedIds: [] }); },
    duplicatePage: () => { commit((d) => { d.pages.splice(get().pageIndex + 1, 0, clonePage(page(d))); }); set({ pageIndex: get().pageIndex + 1, selectedIds: [] }); },
    deletePage: () => {
      const d = get().design; if (!d || d.pages.length < 2) return;
      const i = get().pageIndex;
      commit((dd) => { dd.pages.splice(i, 1); });
      set({ pageIndex: Math.max(0, i - 1), selectedIds: [] });
    },
    movePage: (from, to) => {
      commit((d) => { const [p] = d.pages.splice(from, 1); d.pages.splice(to, 0, p); });
      set({ pageIndex: to });
    },
    resize: (width, height, format, scaleContent) => commit((d) => {
      const sx = width / d.width, sy = height / d.height;
      if (scaleContent) {
        const s = Math.min(sx, sy);
        const ox = (width - d.width * s) / 2, oy = (height - d.height * s) / 2;
        for (const p of d.pages) {
          p.elements = p.elements.map((e) => {
            const out = structuredClone(e);
            out.x = e.x * s + ox; out.y = e.y * s + oy; out.width = e.width * s; out.height = e.height * s;
            if (out.type === 'text') out.fontSize *= s;
            if (out.type === 'group') {
              const scaleKids = (k: DesignElement): DesignElement => {
                const c = { ...k, x: k.x * s, y: k.y * s, width: k.width * s, height: k.height * s } as DesignElement;
                if (c.type === 'text') c.fontSize *= s;
                if (c.type === 'group') c.children = c.children.map(scaleKids);
                return c;
              };
              out.children = out.children.map(scaleKids);
            }
            return out;
          });
        }
      }
      d.width = width; d.height = height; d.format = format;
    }),
  };
});
