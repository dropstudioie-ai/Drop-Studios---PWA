import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, ImagePlus, RefreshCw, Sparkles, Wand2, X } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { artworkUrl, eventStart, listEvents, type DropEvent } from './api';
import { generateOptions, pickMood, type Brief, type BriefPhoto } from './generate';
import { renderPage } from '../export/export';
import { projects } from '../storage/db';
import { ACCEPT_ATTR, importFiles } from '../assets/upload';
import { notifyAssets } from '../lib/useAssets';
import { LIBRARY } from '../assets/library';
import { FORMATS, type Design } from '../model/types';
import { EmptyState, Modal, Spinner, useToast } from '../components/ui';
import { DROP } from '../config';

const fmtDate = (iso: string | null) => iso ? new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso)) : '';
const fmtTime = (iso: string | null) => iso ? new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '';
const eur = (c: number | null) => c == null ? '' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(c / 100);

function briefFrom(e: DropEvent | null): Brief {
  const start = e ? eventStart(e) : null;
  return {
    eventId: e?.id ?? null,
    title: e?.title ?? '',
    kicker: e?.kind === 'workshop' ? 'Workshop' : 'Special themed class',
    date: fmtDate(start), time: fmtTime(start),
    instructor: e?.instructor ?? '',
    description: e?.description ?? '',
    dressCode: e?.dress_code ?? '',
    price: e?.kind === 'workshop' && e.price_cents != null ? `${eur(e.price_cents)}${e.member_price_cents != null ? ` · members ${eur(e.member_price_cents)}` : ''}` : '',
    look: e?.theme?.name ?? '',
    photos: [], format: 'ig-portrait',
  };
}

function BriefDialog({ event, onClose }: { event: DropEvent | null; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [b, setB] = useState<Brief>(() => briefFrom(event));
  const [options, setOptions] = useState<{ d: Design; img: string | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Brief>) => setB((x) => ({ ...x, ...p }));
  const mood = pickMood(`${b.title} ${b.look} ${b.description} ${b.dressCode}`);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    try {
      const added = await importFiles([...files], 'photo');
      notifyAssets();
      set({ photos: [...b.photos, ...added.map((a) => ({ src: `asset:${a.id}`, width: a.width, height: a.height }))] });
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  async function generate() {
    if (!b.title.trim()) { toast('Give the event a title first', 'error'); return; }
    setBusy(true);
    const ds = generateOptions(b);
    setOptions(ds.map((d) => ({ d, img: null })));
    for (const [i, d] of ds.entries()) {
      try {
        const img = await renderPage(d, 0, { pixelRatio: 360 / Math.max(d.width, d.height), mime: 'image/jpeg', quality: 0.85 });
        setOptions((o) => o && o.map((x, j) => (j === i ? { ...x, img } : x)));
      } catch (e) { console.error(e); }
    }
    setBusy(false);
  }

  async function choose(d: Design) {
    await projects.save(d);
    nav(`/design/${d.id}`);
  }

  return (
    <Modal open onClose={onClose} title={event ? `Artwork for “${event.title}”` : 'New event artwork'} wide>
      {!options ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block"><span className="label">Title on the poster</span><input className="input" value={b.title} onChange={(e) => set({ title: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">Date</span><input className="input" value={b.date} onChange={(e) => set({ date: e.target.value })} placeholder="Friday 28 November" /></label>
              <label><span className="label">Time</span><input className="input" value={b.time} onChange={(e) => set({ time: e.target.value })} placeholder="18:30" /></label>
            </div>
            <label className="block"><span className="label">Instructor</span><input className="input" value={b.instructor} onChange={(e) => set({ instructor: e.target.value })} /></label>
            <label className="block"><span className="label">Short description</span><textarea className="input min-h-20" value={b.description} onChange={(e) => set({ description: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2">
              <label><span className="label">What to wear</span><input className="input" value={b.dressCode} onChange={(e) => set({ dressCode: e.target.value })} /></label>
              <label><span className="label">Price line</span><input className="input" value={b.price} onChange={(e) => set({ price: e.target.value })} placeholder="optional" /></label>
            </div>
          </div>
          <div className="space-y-3">
            <label className="block"><span className="label">Describe the look you want</span>
              <textarea className="input min-h-24" value={b.look} onChange={(e) => set({ look: e.target.value })} placeholder="e.g. neon colours, 80s party vibe, bold and loud" />
            </label>
            <p className="text-xs text-muted">Style detected: <strong className="text-ink">{mood.name}</strong> <span className="inline-flex gap-1 align-middle">{[mood.bg, mood.bg2, mood.accent].map((c) => <span key={c} className="inline-block h-3 w-3 rounded-full border border-black/10" style={{ background: c }} />)}</span> · headline font {mood.head}</p>
            <div>
              <span className="label">Pictures that must be used</span>
              <div className="flex flex-wrap gap-2">
                {b.photos.map((p, i) => (
                  <div key={i} className="relative h-20 w-20 overflow-hidden rounded-lg bg-slate-100">
                    <PhotoThumb src={p.src} />
                    <button className="absolute right-0.5 top-0.5 rounded bg-white/90 p-0.5" aria-label="Remove photo" onClick={() => set({ photos: b.photos.filter((_, j) => j !== i) })}><X size={12} /></button>
                    {i === 0 && <span className="chip absolute bottom-0.5 left-0.5 bg-black/70 text-[9px] text-white">Main</span>}
                  </div>
                ))}
                <input ref={input} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} data-testid="brief-photos" />
                <button className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed border-line text-xs font-semibold text-muted" onClick={() => input.current?.click()}><ImagePlus size={18} />Upload</button>
                <button className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed border-line text-xs font-semibold text-muted" onClick={() => setLibOpen(true)}><Sparkles size={18} />Studio photos</button>
              </div>
              <p className="mt-1 text-xs text-muted">The first picture is the main one. Add up to 3.</p>
            </div>
            <label className="block"><span className="label">Size</span>
              <select className="input" value={b.format} onChange={(e) => set({ format: e.target.value })}>{FORMATS.filter((f) => f.group !== 'Business').map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
            </label>
            <button className="btn-primary w-full" disabled={busy} onClick={() => void generate()} data-testid="generate"><Wand2 size={16} />Show me design options</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">Pick one to open it in the editor. Change anything you like, then <strong>Send to Drop</strong> to approve it.</p>
            <button className="btn-ghost btn-sm" onClick={() => setOptions(null)}><RefreshCw size={14} />Change the brief</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            {options.map(({ d, img }) => (
              <button key={d.id} className="group text-left" onClick={() => void choose(d)} data-testid="design-option">
                <span className="block overflow-hidden rounded-xl border border-line bg-slate-100 group-hover:ring-2 group-hover:ring-ink" style={{ aspectRatio: `${d.width}/${d.height}` }}>
                  {img ? <img src={img} alt={d.name} className="h-full w-full" /> : <span className="flex h-full items-center justify-center"><Spinner /></span>}
                </span>
                <span className="mt-1 block text-sm font-semibold">{d.name.split(': ').pop()}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {libOpen && (
        <Modal open onClose={() => setLibOpen(false)} title="Choose studio photos" wide>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {LIBRARY.filter((l) => l.categories.includes('drop')).map((l) => (
              <button key={l.src} className="aspect-square overflow-hidden rounded-lg hover:ring-2 hover:ring-ink" onClick={() => { set({ photos: [...b.photos, { src: l.src, width: l.width, height: l.height } as BriefPhoto].slice(0, 3) }); setLibOpen(false); }}>
                <img src={l.src} alt={l.name} className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </Modal>
  );
}

function PhotoThumb({ src }: { src: string }) {
  const [url, setUrl] = useState<string | null>(src.startsWith('asset:') ? null : src);
  useEffect(() => { if (src.startsWith('asset:')) import('../lib/images').then((m) => m.resolveSrc(src)).then(setUrl).catch(() => {}); }, [src]);
  return url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null;
}

export default function DropEvents() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [list, setList] = useState<DropEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<DropEvent | null | undefined>(undefined);
  const load = () => listEvents(isAdmin).then(setList).catch((e) => { setError((e as Error).message); toast((e as Error).message, 'error'); });
  useEffect(() => { void load(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const upcoming = (list ?? []).filter((e) => { const s = eventStart(e); return !s || new Date(s) > new Date(Date.now() - 864e5); });
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black">Drop events</h1>
          <p className="text-muted">Pick a special class or workshop, describe what you want, add the pictures, and choose from ready-made designs. When you approve one, it’s added to the event in the Drop app.</p>
        </div>
        <a className="btn-outline" href={`${DROP.site}/teach/events/new`} target="_blank" rel="noreferrer"><ExternalLink size={16} />Create an event in Drop</a>
      </div>
      <div className="mt-6 space-y-3">
        {list === null && !error && <Spinner />}
        {error && <EmptyState title="Couldn’t load events from Drop">{error}</EmptyState>}
        {list && upcoming.length === 0 && <EmptyState title="No upcoming events">Create one in the Drop app first (Organise an event), then come back here for its artwork.</EmptyState>}
        {upcoming.map((e) => (
          <div key={e.id} className="card flex flex-wrap items-center gap-4 p-4" data-testid="drop-event">
            <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
              {e.artwork_path ? <img src={artworkUrl(e.artwork_path)} alt="" className="h-full w-full object-cover" /> : <span className="text-3xl">{e.theme?.emoji ?? '✨'}</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">{e.kind === 'workshop' ? 'Workshop' : 'Special class'}{e.instructor ? ` · ${e.instructor}` : ''}{e.status === 'pending' ? ' · waiting for approval' : ''}</p>
              <p className="text-lg font-bold">{e.title}</p>
              <p className="text-sm text-muted">{fmtDate(eventStart(e))} {fmtTime(eventStart(e))}</p>
              {e.artwork_path && <p className="text-xs font-semibold text-success">✓ Artwork live in the Drop app</p>}
            </div>
            <button className="btn-primary" onClick={() => setBrief(e)}><Wand2 size={16} />{e.artwork_path ? 'New artwork' : 'Create artwork'}</button>
          </div>
        ))}
      </div>
      {brief !== undefined && <BriefDialog event={brief} onClose={() => setBrief(undefined)} />}
    </div>
  );
}
