import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { useEditor } from '../store/editor';
import { eventStart, listEvents, publishArtwork, type DropEvent } from './api';
import { dataUrlToBlob, renderPage } from '../export/export';
import { Modal, Spinner, useToast } from '../components/ui';

/** Approval step: see exactly what will be published, then upload it to the event in Drop. */
export function SendToDropDialog({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useAuth();
  const design = useEditor((s) => s.design)!;
  const pageIndex = useEditor((s) => s.pageIndex);
  const toast = useToast();
  const [events, setEvents] = useState<DropEvent[] | null>(null);
  const [eventId, setEventId] = useState<string>(design.dropEventId ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { listEvents(isAdmin).then((l) => { setEvents(l); if (!eventId && l[0]) setEventId(l[0].id); }).catch((e) => setError((e as Error).message)); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    // Publish at least 1080px wide for sharp results on phones.
    const ratio = Math.max(1, 1080 / design.width);
    renderPage(design, pageIndex, { pixelRatio: ratio, mime: 'image/png' }).then((u) => live && setPreview(u)).catch((e) => setError((e as Error).message));
    return () => { live = false; };
  }, [design, pageIndex]);

  async function approve() {
    if (!preview || !eventId) return;
    setBusy(true);
    try {
      await publishArtwork(eventId, dataUrlToBlob(preview));
      useEditor.getState().update((d) => { d.dropEventId = eventId; });
      setDone(true);
      toast('Published to the Drop app');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  const ev = events?.find((e) => e.id === eventId);
  return (
    <Modal open onClose={onClose} title="Send to Drop" wide
      footer={done ? <button className="btn-primary" onClick={onClose}>Done</button> : <><button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !preview || !eventId} onClick={() => void approve()} data-testid="approve-publish">{busy ? <><Spinner className="h-4 w-4" />Publishing…</> : 'Approve & publish to Drop'}</button></>}>
      {done ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 size={48} className="text-success" />
          <p className="text-lg font-bold">Live in the Drop app</p>
          <p className="text-sm text-muted">Members now see this artwork on “{ev?.title}” when they open the class.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[1fr_280px]">
          <div className="flex items-center justify-center rounded-xl bg-slate-100 p-4">
            {preview ? <img src={preview} alt="What will be published" className="max-h-[55vh] rounded shadow-lg" /> : <Spinner />}
          </div>
          <div className="space-y-3">
            <label className="block"><span className="label">Event</span>
              {events === null ? <Spinner /> : events.length === 0 ? <p className="text-sm text-muted">No events found. Create one in the Drop app first.</p> : (
                <select className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  {events.map((e) => <option key={e.id} value={e.id}>{e.title} · {eventStart(e) ? new Date(eventStart(e)!).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }) : ''}</option>)}
                </select>
              )}
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <p className="text-sm text-muted">This is exactly what members will see{design.pages.length > 1 ? ` (page ${pageIndex + 1})` : ''}. It replaces any earlier artwork on the event.</p>
          </div>
        </div>
      )}
    </Modal>
  );
}
