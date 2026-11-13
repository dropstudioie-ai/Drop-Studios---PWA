import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEditor } from '../store/editor';
import { renderPage } from '../export/export';
import { Spinner } from '../components/ui';

export function PreviewOverlay({ onClose }: { onClose: () => void }) {
  const design = useEditor((s) => s.design)!;
  const [i, setI] = useState(useEditor.getState().pageIndex);
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    let live = true; setImg(null);
    renderPage(design, i, { pixelRatio: Math.min(2, 1600 / Math.max(design.width, design.height)), mime: 'image/png' }).then((u) => live && setImg(u));
    return () => { live = false; };
  }, [design, i]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((v) => Math.min(design.pages.length - 1, v + 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [design.pages.length, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-6" role="dialog" aria-label="Preview">
      <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={onClose} aria-label="Close preview"><X /></button>
      {img ? <img src={img} alt={`Page ${i + 1}`} className="max-h-full max-w-full rounded shadow-2xl" /> : <Spinner className="h-8 w-8 text-white" />}
      {design.pages.length > 1 && (
        <div className="absolute bottom-5 flex items-center gap-3 text-white">
          <button className="rounded-full bg-white/10 p-2 disabled:opacity-30" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous page"><ChevronLeft /></button>
          <span className="text-sm">Page {i + 1} of {design.pages.length}</span>
          <button className="rounded-full bg-white/10 p-2 disabled:opacity-30" disabled={i === design.pages.length - 1} onClick={() => setI(i + 1)} aria-label="Next page"><ChevronRight /></button>
        </div>
      )}
    </div>
  );
}
