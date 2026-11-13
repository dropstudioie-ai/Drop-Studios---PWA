import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, CloudOff, Download, Eye, Grid3x3, Magnet, Maximize, Minus, Plus, Redo2, Send, Share2, Undo2 } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Spinner } from '../components/ui';
import { ExportDialog } from './ExportDialog';
import { PreviewOverlay } from './PreviewOverlay';
import { ShareDialog } from './ShareDialog';
import { SendToDropDialog } from '../drop/SendToDropDialog';

export function Toolbar() {
  const design = useEditor((s) => s.design)!;
  const status = useEditor((s) => s.saveStatus);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const zoom = useEditor((s) => s.zoom);
  const showGrid = useEditor((s) => s.showGrid);
  const snap = useEditor((s) => s.snap);
  const api = useEditor.getState;
  const [dialog, setDialog] = useState<null | 'export' | 'preview' | 'share' | 'drop'>(null);
  const [name, setName] = useState(design.name);

  const commitName = () => {
    const n = name.trim() || 'Untitled design';
    setName(n);
    if (n !== design.name) api().update((d) => { d.name = n; });
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line bg-white px-2">
      <Link to="/" className="icon-btn" title="Back to designs" aria-label="Back to designs"><ArrowLeft size={18} /></Link>
      <img src="/favicon.svg" alt="" className="mr-1 h-7 w-7" />
      <input
        aria-label="Design name"
        className="w-40 rounded-md border border-transparent px-2 py-1 text-sm font-semibold hover:border-line focus:border-brand-500 focus:outline-none sm:w-60"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <span className="hidden items-center gap-1 text-xs text-muted md:flex" data-testid="save-status">
        {status === 'saved' && <><Check size={14} className="text-success" />Saved</>}
        {status === 'saving' && <><Spinner className="h-3 w-3" />Saving…</>}
        {status === 'unsaved' && <>Unsaved changes</>}
        {status === 'error' && <span className="flex items-center gap-1 text-danger"><CloudOff size={14} />Couldn’t save</span>}
      </span>

      <div className="mx-2 h-6 w-px bg-line" />
      <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={() => api().undo()}><Undo2 size={18} /></button>
      <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={() => api().redo()}><Redo2 size={18} /></button>

      <div className="mx-2 hidden h-6 w-px bg-line sm:block" />
      <div className="hidden items-center sm:flex">
        <button className="icon-btn" title="Zoom out" aria-label="Zoom out" onClick={() => api().setZoom(zoom / 1.2)}><Minus size={16} /></button>
        <button className="w-14 rounded-md py-1 text-center text-xs font-semibold tabular-nums hover:bg-slate-100" title="Fit to screen (Ctrl+0)" onClick={() => api().requestFit()} data-testid="zoom-level">{Math.round(zoom * 100)}%</button>
        <button className="icon-btn" title="Zoom in" aria-label="Zoom in" onClick={() => api().setZoom(zoom * 1.2)}><Plus size={16} /></button>
        <button className="icon-btn" title="Fit to screen" aria-label="Fit to screen" onClick={() => api().requestFit()}><Maximize size={16} /></button>
        <button className={`icon-btn ${showGrid ? 'bg-brand-50 text-brand-700' : ''}`} title="Show grid" aria-pressed={showGrid} aria-label="Show grid" onClick={() => api().toggleGrid()}><Grid3x3 size={16} /></button>
        <button className={`icon-btn ${snap ? 'bg-brand-50 text-brand-700' : ''}`} title="Snap to guides" aria-pressed={snap} aria-label="Snap to guides" onClick={() => api().toggleSnap()}><Magnet size={16} /></button>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button className="btn-ghost btn-sm" onClick={() => setDialog('preview')}><Eye size={16} /><span className="hidden lg:inline">Preview</span></button>
        <button className="btn-ghost btn-sm" onClick={() => setDialog('share')}><Share2 size={16} /><span className="hidden lg:inline">Share</span></button>
        <button className="btn-outline btn-sm" onClick={() => setDialog('drop')} title="Send this design to a Drop event"><Send size={16} /><span className="hidden md:inline">Send to Drop</span></button>
        <button className="btn-primary btn-sm" onClick={() => setDialog('export')}><Download size={16} />Download</button>
      </div>

      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'preview' && <PreviewOverlay onClose={() => setDialog(null)} />}
      {dialog === 'share' && <ShareDialog onClose={() => setDialog(null)} />}
      {dialog === 'drop' && <SendToDropDialog onClose={() => setDialog(null)} />}
    </header>
  );
}
