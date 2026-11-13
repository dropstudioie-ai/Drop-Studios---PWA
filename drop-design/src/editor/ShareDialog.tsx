import { useState } from 'react';
import { Copy, FileDown, Share } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Modal, Spinner, useToast } from '../components/ui';
import { dataUrlToBlob, downloadBlob, renderPage } from '../export/export';
import { exportProjectFile } from '../storage/projectFile';

/** Sharing without accounts: send the image, copy it, or pass the editable project file to a colleague. */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const design = useEditor((s) => s.design)!;
  const pageIndex = useEditor((s) => s.pageIndex);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const png = async () => dataUrlToBlob(await renderPage(design, pageIndex, { pixelRatio: 2, mime: 'image/png' }));
  const canShare = typeof navigator.share === 'function';

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try { await fn(); } catch (e) { if ((e as Error).name !== 'AbortError') toast((e as Error).message, 'error'); } finally { setBusy(null); }
  }

  return (
    <Modal open onClose={onClose} title="Share">
      <div className="space-y-3">
        {canShare && (
          <button className="btn-outline w-full justify-start" disabled={!!busy} onClick={() => void run('share', async () => {
            const file = new File([await png()], `${design.name}.png`, { type: 'image/png' });
            if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error('This device can’t share images directly. Use Download instead.');
            await navigator.share({ files: [file], title: design.name });
          })}>{busy === 'share' ? <Spinner className="h-4 w-4" /> : <Share size={16} />}Share image (WhatsApp, email, Instagram…)</button>
        )}
        <button className="btn-outline w-full justify-start" disabled={!!busy} onClick={() => void run('copy', async () => {
          if (!('ClipboardItem' in window)) throw new Error('Copying images isn’t supported in this browser.');
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })]);
          toast('Image copied: paste it into any app');
        })}>{busy === 'copy' ? <Spinner className="h-4 w-4" /> : <Copy size={16} />}Copy image to clipboard</button>
        <button className="btn-outline w-full justify-start" disabled={!!busy} onClick={() => void run('file', async () => {
          downloadBlob(await exportProjectFile(design), `${design.name}.dropdesign`);
          toast('Project file downloaded');
        })}>{busy === 'file' ? <Spinner className="h-4 w-4" /> : <FileDown size={16} />}Download editable project file</button>
        <p className="text-xs text-muted">A project file keeps every element editable, uploads included. Anyone with Drop Design can open it from Designs → Import. Shared links and live collaboration come with cloud accounts (phase 3).</p>
      </div>
    </Modal>
  );
}
