import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { useEditor } from '../store/editor';

export function PageStrip() {
  const pages = useEditor((s) => s.design?.pages ?? []);
  const pageIndex = useEditor((s) => s.pageIndex);
  const api = useEditor.getState;
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-line bg-white px-3 text-sm">
      <span className="font-semibold text-muted">Pages</span>
      <div className="flex items-center gap-1 overflow-x-auto">
        {pages.map((p, i) => (
          <button key={p.id} onClick={() => api().setPage(i)} aria-current={i === pageIndex}
            className={`h-8 min-w-8 rounded-md px-2 text-xs font-bold ${i === pageIndex ? 'bg-brand-600 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}>{i + 1}</button>
        ))}
      </div>
      <button className="icon-btn" title="Add page" aria-label="Add page" onClick={() => api().addPage()}><Plus size={16} /></button>
      <button className="icon-btn" title="Duplicate page" aria-label="Duplicate page" onClick={() => api().duplicatePage()}><Copy size={16} /></button>
      <button className="icon-btn" title="Move page left" aria-label="Move page left" disabled={pageIndex === 0} onClick={() => api().movePage(pageIndex, pageIndex - 1)}><ChevronLeft size={16} /></button>
      <button className="icon-btn" title="Move page right" aria-label="Move page right" disabled={pageIndex >= pages.length - 1} onClick={() => api().movePage(pageIndex, pageIndex + 1)}><ChevronRight size={16} /></button>
      <button className="icon-btn" title="Delete page" aria-label="Delete page" disabled={pages.length < 2} onClick={() => api().deletePage()}><Trash2 size={16} /></button>
    </div>
  );
}
