import { useMemo, useRef, useState } from 'react';
import { Search, Trash2, Upload } from 'lucide-react';
import type { Asset } from '../model/types';
import { ACCEPT_ATTR, importFiles } from '../assets/upload';
import { assets } from '../storage/db';
import { notifyAssets, useAssets } from '../lib/useAssets';
import { useConfirm, useToast, Spinner } from '../components/ui';
import { addPayload, dragProps } from './addHelpers';
import { useEditor } from '../store/editor';

const KINDS: { id: Asset['kind'] | 'all'; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'photo', label: 'Photos' }, { id: 'logo', label: 'Logos' }, { id: 'background', label: 'Backgrounds' }];

export function UploadsPanel({ onPickBackground }: { onPickBackground?: boolean }) {
  const { list } = useAssets();
  const toast = useToast();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<Asset['kind']>('photo');
  const [filter, setFilter] = useState<Asset['kind'] | 'all'>('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const shown = useMemo(() => (list ?? []).filter((a) => (filter === 'all' || a.kind === filter) && (!q || a.name.toLowerCase().includes(q.toLowerCase()))), [list, filter, q]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try { const added = await importFiles([...files], kind); notifyAssets(); toast(`${added.length} image${added.length > 1 ? 's' : ''} uploaded`); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  function use(a: Asset) {
    if (a.kind === 'background' || onPickBackground) {
      useEditor.getState().update((d) => { d.pages[useEditor.getState().pageIndex].background.image = { src: `asset:${a.id}`, opacity: 1 }; });
    } else void addPayload({ kind: 'asset', id: a.id });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-line p-3">
        <label className="label" htmlFor="upload-kind">Upload as</label>
        <select id="upload-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Asset['kind'])}>
          <option value="photo">Photo</option><option value="logo">Logo</option><option value="background">Background</option>
        </select>
        <input ref={input} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={(e) => void upload(e.target.files)} data-testid="upload-input" />
        <button className="btn-primary mt-2 w-full" disabled={busy} onClick={() => input.current?.click()}>{busy ? <Spinner className="h-4 w-4" /> : <Upload size={16} />}Upload images</button>
        <p className="mt-2 text-xs text-muted">JPG, PNG, SVG or WebP, up to 25 MB. You can also drag files straight onto the page.</p>
      </div>
      <label className="relative block"><Search size={16} className="absolute left-3 top-2.5 text-muted" /><input className="input pl-9" placeholder="Search uploads" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search uploads" /></label>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => <button key={k.id} onClick={() => setFilter(k.id)} className={`chip ${filter === k.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-soft'}`}>{k.label}</button>)}
      </div>
      {list === null ? <Spinner /> : shown.length === 0 ? <p className="text-sm text-muted">No uploads yet.</p> : (
        <div className="grid grid-cols-2 gap-2" data-testid="uploads-grid">
          {shown.map((a) => (
            <div key={a.id} className="group relative">
              <button onClick={() => use(a)} {...dragProps({ kind: 'asset', id: a.id })} title={`${a.name} · ${a.width}×${a.height}`}
                className="block aspect-square w-full overflow-hidden rounded-xl bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px]">
                <img src={a.url} alt={a.name} className="h-full w-full object-contain" />
              </button>
              <span className="chip absolute left-1 top-1 bg-black/60 text-[10px] text-white">{a.kind}</span>
              <button aria-label={`Delete ${a.name}`} className="absolute right-1 top-1 hidden rounded-md bg-white/90 p-1 text-danger shadow group-hover:block"
                onClick={async () => { if (await confirm({ title: 'Delete upload?', body: `“${a.name}” will be removed from this browser. Designs using it will show an empty frame.`, ok: 'Delete', danger: true })) { await assets.remove(a.id); notifyAssets(); } }}>
                <Trash2 size={14} />
              </button>
              <p className="mt-0.5 truncate text-[11px] text-muted">{a.name}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
