import { useState } from 'react';
import { useEditor } from '../store/editor';
import { Modal, Spinner, useToast } from '../components/ui';
import { exportDesign, type ExportFormat } from '../export/export';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const design = useEditor((s) => s.design)!;
  const pageIndex = useEditor((s) => s.pageIndex);
  const toast = useToast();
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState<1 | 2 | 3>(2);
  const [transparent, setTransparent] = useState(false);
  const [which, setWhich] = useState<'current' | 'all'>(design.pages.length > 1 ? 'all' : 'current');
  const [busy, setBusy] = useState(false);
  const pages = which === 'all' ? design.pages.map((_, i) => i) : [pageIndex];
  const px = (n: number) => Math.round(n * quality);

  async function go() {
    setBusy(true);
    try {
      await exportDesign(design, { format, scale: quality, transparent: format === 'png' && transparent, pages });
      toast(format === 'pdf' ? 'PDF downloaded' : `${pages.length > 1 ? `${pages.length} images` : 'Image'} downloaded`);
      onClose();
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Download"
      footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={() => void go()} data-testid="export-go">{busy ? <><Spinner className="h-4 w-4" />Preparing…</> : 'Download'}</button></>}>
      <div className="space-y-5">
        <fieldset>
          <legend className="label">File type</legend>
          <div className="grid grid-cols-3 gap-2">
            {([['png', 'PNG', 'Best for social'], ['jpg', 'JPG', 'Smaller files'], ['pdf', 'PDF', 'Print & email']] as const).map(([v, l, d]) => (
              <button key={v} onClick={() => setFormat(v)} aria-pressed={format === v} className={`rounded-xl border p-3 text-left ${format === v ? 'border-brand-500 bg-brand-50' : 'border-line hover:bg-slate-50'}`}>
                <span className="block font-bold">{l}</span><span className="text-xs text-muted">{d}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">{format === 'pdf' ? 'Print quality' : 'Quality'}</legend>
          <select className="input" value={quality} onChange={(e) => setQuality(Number(e.target.value) as 1 | 2 | 3)} aria-label="Quality">
            <option value={1}>Standard ({px(design.width)} × {px(design.height)} px)</option>
            <option value={2}>High quality ({design.width * 2} × {design.height * 2} px){format === 'pdf' && design.format.startsWith('a4') ? ', 300 dpi print' : ''}</option>
            <option value={3}>Maximum ({design.width * 3} × {design.height * 3} px)</option>
          </select>
        </fieldset>
        {design.pages.length > 1 && (
          <fieldset>
            <legend className="label">Pages</legend>
            <select className="input" value={which} onChange={(e) => setWhich(e.target.value as 'current' | 'all')} aria-label="Pages">
              <option value="all">All {design.pages.length} pages</option>
              <option value="current">Current page only (page {pageIndex + 1})</option>
            </select>
          </fieldset>
        )}
        {format === 'png' && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />Transparent background (removes the page colour)</label>
        )}
        {format === 'pdf' && <p className="text-xs text-muted">PDF pages are high-resolution images of your design, so the layout and fonts look exactly as on screen.</p>}
      </div>
    </Modal>
  );
}
