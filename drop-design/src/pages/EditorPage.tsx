import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { projects } from '../storage/db';
import { useEditor } from '../store/editor';
import { thumbnail } from '../export/export';
import { Spinner, useToast } from '../components/ui';
import { Toolbar } from '../editor/Toolbar';
import { LeftSidebar } from '../panels/LeftSidebar';
import { RightPanel } from '../panels/RightPanel';
import { PageStrip } from '../editor/PageStrip';
import { importFiles } from '../assets/upload';
import { notifyAssets } from '../lib/useAssets';
import { dropPayloadToElements } from '../editor/dropPayload';
import { startTypingInto } from '../editor/Canvas';

const Canvas = lazy(() => import('../editor/Canvas'));

/** Saves automatically shortly after each change; refreshes the thumbnail less often. */
function useAutosave() {
  const design = useEditor((s) => s.design);
  const status = useEditor((s) => s.saveStatus);
  const thumbTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!design || status !== 'unsaved') return;
    const h = window.setTimeout(async () => {
      const api = useEditor.getState();
      api.setSaveStatus('saving');
      try {
        const current = api.design!;
        const prev = await projects.get(current.id);
        await projects.save({ ...current, thumbnail: prev?.thumbnail ?? current.thumbnail });
        if (useEditor.getState().design === current) useEditor.getState().setSaveStatus('saved');
        if (thumbTimer.current) window.clearTimeout(thumbTimer.current);
        thumbTimer.current = window.setTimeout(async () => {
          const d = useEditor.getState().design;
          if (!d) return;
          try { const th = await thumbnail(d); const stored = await projects.get(d.id); if (stored) await projects.save({ ...stored, thumbnail: th }); } catch { /* thumbnail is optional */ }
        }, 2500);
      } catch (e) {
        console.error(e);
        useEditor.getState().setSaveStatus('error');
      }
    }, 700);
    return () => window.clearTimeout(h);
  }, [design, status]);
  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (useEditor.getState().saveStatus !== 'saved') { e.preventDefault(); } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);
}

function usePasteImages(toast: (t: string, tone?: 'ok' | 'error' | 'info') => void) {
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) { useEditor.getState().paste(); return; } // copied elements
      e.preventDefault();
      try {
        const added = await importFiles(files, 'photo');
        notifyAssets();
        const s = useEditor.getState();
        if (!s.design) return;
        const els = (await Promise.all(added.map((a) => dropPayloadToElements({ kind: 'asset', id: a.id }, null, { width: s.design!.width, height: s.design!.height })))).flat();
        if (els.length) s.addElements(els);
      } catch (err) { toast((err as Error).message, 'error'); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [toast]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
      else if (mod && k === 'y') { e.preventDefault(); s.redo(); }
      else if (mod && k === 'c') { s.copy(); }
      else if (mod && k === 'x') { s.cut(); }
      else if (mod && k === 'v') { /* handled on the paste event so images from other apps work too */ }
      else if (mod && k === 'd') { e.preventDefault(); s.duplicateSelected(); }
      else if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) s.ungroup(); else s.group(); }
      else if (mod && k === 'a') { e.preventDefault(); const p = s.design?.pages[s.pageIndex]; if (p) s.select(p.elements.filter((x) => !x.locked && !x.hidden).map((x) => x.id)); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); s.setZoom(s.zoom * 1.2); }
      else if (mod && k === '-') { e.preventDefault(); s.setZoom(s.zoom / 1.2); }
      else if (mod && k === '0') { e.preventDefault(); s.requestFit(); }
      else if (k === 'delete' || k === 'backspace') { if (s.selectedIds.length) { e.preventDefault(); s.deleteSelected(); } }
      else if (k === 'escape') s.select([]);
      else if (k.startsWith('arrow') && s.selectedIds.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        s.nudge(k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0, k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0);
      } else if (s.selectedIds.length === 1 && !mod && !e.altKey && (k === 'enter' || e.key.length === 1)) {
        // With one text selected: Enter edits it, and typing a letter starts replacing its words.
        const el = s.design?.pages[s.pageIndex].elements.find((x) => x.id === s.selectedIds[0]);
        if (el?.type === 'text' && !el.locked) {
          e.preventDefault();
          if (k === 'enter') s.setEditingText(el.id); else startTypingInto(el.id, e.key);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

(window as unknown as { __dropEditor?: unknown }).__dropEditor = useEditor;

export default function EditorPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const design = useEditor((s) => s.design);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    projects.get(id).then((d) => {
      if (!live) return;
      if (!d) { setMissing(true); return; }
      useEditor.getState().load(d);
    }).catch((e) => toast((e as Error).message, 'error'));
    return () => { live = false; useEditor.getState().close(); };
  }, [id, toast]);

  useAutosave();
  useShortcuts();
  usePasteImages(toast);

  if (missing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="font-semibold">This design isn’t saved in this browser.</p>
        <button className="btn-primary" onClick={() => nav('/')}>Back to designs</button>
      </div>
    );
  }
  if (!design || design.id !== id) return <div className="flex h-full items-center justify-center"><Spinner className="h-7 w-7" /></div>;

  return (
    <div className="flex h-full flex-col bg-app">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <LeftSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1"><Suspense fallback={null}><Canvas /></Suspense></div>
          <PageStrip />
        </div>
        <RightPanel />
      </div>
    </div>
  );
}
