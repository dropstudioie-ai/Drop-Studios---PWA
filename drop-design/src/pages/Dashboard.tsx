import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Copy, Download, Folder, FolderInput, FolderPlus, MoreHorizontal, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import type { Design, Folder as FolderT } from '../model/types';
import { FORMATS } from '../model/types';
import { cloneElement, newDesign, uid } from '../model/elements';
import { folders as folderStore, projects, requestPersistence } from '../storage/db';
import { exportProjectFile, importProjectFile } from '../storage/projectFile';
import { exportBackup, importBackup } from '../storage/backup';
import { downloadBlob } from '../export/export';
import { designFromTemplate } from '../templates/kit';
import { TemplateGallery } from '../panels/TemplateGallery';
import { EmptyState, Modal, useConfirm, useToast } from '../components/ui';
import { useAuth } from '../auth/AuthProvider';

function NewDesignDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (w: number, h: number, f: string) => void }) {
  const [w, setW] = useState(1080), [h, setH] = useState(1080);
  return (
    <Modal open onClose={onClose} title="Create a design" wide>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {FORMATS.map((f) => (
          <button key={f.id} onClick={() => onCreate(f.width, f.height, f.id)} className="flex items-center gap-3 rounded-xl border border-line p-3 text-left hover:border-ink hover:bg-slate-50" data-testid={`format-${f.id}`}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center"><span className="block rounded-sm border-2 border-ink" style={{ width: f.width > f.height ? 44 : 44 * f.width / f.height, height: f.height >= f.width ? 44 : 44 * f.height / f.width }} /></span>
            <span><span className="block text-sm font-bold">{f.label}</span><span className="text-xs text-muted">{f.width} × {f.height} px</span></span>
          </button>
        ))}
      </div>
      <div className="mt-5 rounded-xl bg-slate-50 p-4">
        <p className="font-bold">Custom size</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label><span className="label">Width (px)</span><input className="input w-32" type="number" min={50} max={8000} value={w} onChange={(e) => setW(Number(e.target.value))} /></label>
          <label><span className="label">Height (px)</span><input className="input w-32" type="number" min={50} max={8000} value={h} onChange={(e) => setH(Number(e.target.value))} /></label>
          <button className="btn-primary" disabled={w < 50 || h < 50 || w > 8000 || h > 8000} onClick={() => onCreate(w, h, 'custom')}>Create</button>
        </div>
      </div>
    </Modal>
  );
}

function DesignCard({ d, folders, onChanged }: { d: Design; folders: FolderT[]; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.name);
  const [moving, setMoving] = useState(false);
  const f = FORMATS.find((x) => x.id === d.format);
  async function save(patch: Partial<Design>) { await projects.save({ ...d, ...patch }); onChanged(); }
  return (
    <div className="group relative" data-testid="design-card">
      <Link to={`/design/${d.id}`} className="block">
        <span className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border border-line bg-slate-100 p-3 transition group-hover:shadow-lg">
          {d.thumbnail ? <img src={d.thumbnail} alt="" className="max-h-full max-w-full rounded shadow" /> : <span className="text-xs text-muted">No preview yet</span>}
        </span>
      </Link>
      <div className="mt-1.5 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input autoFocus className="input py-1" value={name} onChange={(e) => setName(e.target.value)} aria-label="New name"
              onBlur={() => { setRenaming(false); if (name.trim() && name !== d.name) void save({ name: name.trim() }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(d.name); setRenaming(false); } }} />
          ) : <p className="truncate text-sm font-semibold">{d.name}</p>}
          <p className="text-xs text-muted">{f?.label ?? `${d.width}×${d.height}`} · {new Date(d.updatedAt).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' })}</p>
        </div>
        <button className="icon-btn h-7 w-7" aria-label={`More options for ${d.name}`} onClick={() => setMenu(!menu)}><MoreHorizontal size={16} /></button>
      </div>
      {menu && (
        <div className="absolute right-0 top-full z-20 w-52 rounded-xl border border-line bg-white p-1 shadow-xl" onMouseLeave={() => setMenu(false)}>
          {[
            [<Pencil size={14} />, 'Rename', () => setRenaming(true)],
            [<Copy size={14} />, 'Duplicate', async () => {
              const copy: Design = { ...structuredClone(d), id: uid(), name: `${d.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now(), pages: d.pages.map((p) => ({ ...p, id: uid(), elements: p.elements.map(cloneElement) })) };
              await projects.save(copy); onChanged(); toast('Duplicated');
            }],
            [<FolderInput size={14} />, 'Move to folder', () => setMoving(true)],
            [<Download size={14} />, 'Download project file', async () => downloadBlob(await exportProjectFile(d), `${d.name}.dropdesign`)],
            [<Trash2 size={14} className="text-danger" />, 'Delete', async () => {
              if (await confirm({ title: 'Delete design?', body: `“${d.name}” will be deleted from this browser. This can’t be undone.`, ok: 'Delete', danger: true })) { await projects.remove(d.id); onChanged(); }
            }],
          ].map(([icon, label, fn]) => (
            <button key={label as string} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setMenu(false); void (fn as () => void)(); }}>{icon as React.ReactNode}{label as string}</button>
          ))}
        </div>
      )}
      {moving && (
        <Modal open onClose={() => setMoving(false)} title="Move to folder">
          <div className="space-y-1">
            <button className="btn-outline w-full justify-start" onClick={() => { setMoving(false); void save({ folderId: null }); }}>No folder</button>
            {folders.map((fo) => <button key={fo.id} className="btn-outline w-full justify-start" onClick={() => { setMoving(false); void save({ folderId: fo.id }); }}><Folder size={16} />{fo.name}</button>)}
            {folders.length === 0 && <p className="text-sm text-muted">Create a folder first (New folder on the left).</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { canInvoice, profile } = useAuth();
  const [list, setList] = useState<Design[] | null>(null);
  const [folderList, setFolders] = useState<FolderT[]>([]);
  const [folder, setFolder] = useState<string>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => { setList(await projects.list()); setFolders(await folderStore.list()); }, []);
  useEffect(() => { void load(); void requestPersistence(); }, [load]);

  async function create(d: Design) { await projects.save(d); nav(`/design/${d.id}`); }
  const shown = useMemo(() => (list ?? []).filter((d) => (folder === 'all' || (folder === 'none' ? !d.folderId : d.folderId === folder)) && (!q || d.name.toLowerCase().includes(q.toLowerCase()))), [list, folder, q]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Hi {profile?.full_name?.split(' ')[0] ?? 'there'}, what are we designing?</h1>
          <p className="text-muted">Posters, social posts, timetables, presentations and Drop event artwork.</p>
        </div>
        <div className="flex gap-2">
          <input ref={importRef} type="file" accept=".dropdesign,application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { const d = await importProjectFile(f); toast('Project imported'); nav(`/design/${d.id}`); } catch (err) { toast((err as Error).message, 'error'); }
            e.target.value = '';
          }} />
          <button className="btn-outline" onClick={() => importRef.current?.click()}><Upload size={16} />Import</button>
          <button className="btn-primary" onClick={() => setCreating(true)} data-testid="create-design"><Plus size={16} />Create a design</button>
        </div>
      </div>

      <div className="mt-6 flex gap-3 overflow-x-auto pb-2">
        {FORMATS.map((f) => (
          <button key={f.id} onClick={() => void create(newDesign('Untitled design', f.width, f.height, f.id))} className="card flex shrink-0 flex-col items-center gap-2 px-4 py-3 hover:border-ink">
            <span className="flex h-12 items-center"><span className="block rounded-sm bg-gradient-to-br from-zinc-800 to-zinc-500" style={{ width: f.width > f.height ? 48 : 48 * f.width / f.height, height: f.height >= f.width ? 48 : 48 * f.height / f.width }} /></span>
            <span className="text-xs font-semibold">{f.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="space-y-1">
          <h2 className="label">Folders</h2>
          {[['all', 'All designs'], ['none', 'Not in a folder']].map(([id, label]) => (
            <button key={id} onClick={() => setFolder(id)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold ${folder === id ? 'bg-zinc-900 text-white' : 'hover:bg-slate-100'}`}><Folder size={16} />{label}</button>
          ))}
          {folderList.map((fo) => (
            <div key={fo.id} className={`group flex items-center rounded-lg ${folder === fo.id ? 'bg-zinc-900 text-white' : 'hover:bg-slate-100'}`}>
              <button onClick={() => setFolder(fo.id)} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm font-semibold"><Folder size={16} /><span className="truncate">{fo.name}</span></button>
              <button className="hidden p-1.5 group-hover:block" aria-label={`Rename ${fo.name}`} onClick={async () => { const n = prompt('Folder name', fo.name); if (n?.trim()) { await folderStore.save({ ...fo, name: n.trim() }); void load(); } }}><Pencil size={13} /></button>
              <button className="hidden p-1.5 group-hover:block" aria-label={`Delete ${fo.name}`} onClick={async () => {
                if (await confirm({ title: 'Delete folder?', body: `The designs in “${fo.name}” are kept (moved out of the folder).`, ok: 'Delete folder', danger: true })) { await folderStore.remove(fo.id); setFolder('all'); void load(); }
              }}><Trash2 size={13} /></button>
            </div>
          ))}
          <button className="btn-ghost btn-sm w-full justify-start" onClick={async () => { const n = prompt('New folder name'); if (n?.trim()) { await folderStore.save({ id: uid(), name: n.trim(), createdAt: Date.now() }); void load(); } }}><FolderPlus size={16} />New folder</button>

          <div className="mt-6 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            <p className="font-bold">Saved in this browser</p>
            <p className="mt-1">Designs and uploads are stored on this device only. Back them up now and then, especially before clearing browser data.</p>
            <div className="mt-2 flex flex-col gap-1">
              <button className="btn-outline btn-sm" onClick={async () => downloadBlob(await exportBackup(canInvoice), `drop-design-backup-${new Date().toISOString().slice(0, 10)}.json`)}>Download backup</button>
              <input ref={restoreRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try { const n = await importBackup(f, canInvoice); toast(`Restored ${n} items`); void load(); } catch (err) { toast((err as Error).message, 'error'); }
                e.target.value = '';
              }} />
              <button className="btn-ghost btn-sm" onClick={() => restoreRef.current?.click()}>Restore a backup</button>
            </div>
          </div>
        </aside>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">{folder === 'all' ? 'Recent designs' : folder === 'none' ? 'Not in a folder' : folderList.find((f) => f.id === folder)?.name}</h2>
            <label className="relative"><Search size={16} className="absolute left-3 top-2.5 text-muted" /><input className="input w-64 pl-9" placeholder="Search your designs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search your designs" /></label>
          </div>
          <div className="mt-4">
            {list === null ? null : shown.length === 0
              ? <EmptyState title={list.length ? 'No designs here' : 'No designs yet'}>Start from a template below or create a blank design.</EmptyState>
              : <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-4">{shown.map((d) => <DesignCard key={d.id} d={d} folders={folderList} onChanged={() => void load()} />)}</div>}
          </div>

          <h2 className="mt-12 text-xl font-bold">Start from a template</h2>
          <p className="mb-4 text-sm text-muted">Every template opens fully editable.</p>
          <TemplateGallery columns={4} onPick={(t) => void create({ ...designFromTemplate(t), folderId: folder !== 'all' && folder !== 'none' ? folder : null })} />
        </section>
      </div>
      {creating && <NewDesignDialog onClose={() => setCreating(false)} onCreate={(w, h, f) => void create({ ...newDesign('Untitled design', w, h, f), folderId: folder !== 'all' && folder !== 'none' ? folder : null })} />}
    </div>
  );
}
