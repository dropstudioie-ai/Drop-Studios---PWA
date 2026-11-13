import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import type { BrandKit, TextStyle } from '../model/types';
import { useBrand } from '../lib/brand';
import { useAssets, notifyAssets } from '../lib/useAssets';
import { ACCEPT_ATTR, importFiles } from '../assets/upload';
import { FONTS } from '../lib/fonts';
import { ColorField, Spinner, useToast } from '../components/ui';
import { uid } from '../model/elements';

export default function BrandPage() {
  const { brand, save } = useBrand();
  const { list } = useAssets();
  const toast = useToast();
  const [b, setB] = useState<BrandKit | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (brand && !b) setB(brand); }, [brand, b]);
  if (!b) return <div className="p-10"><Spinner /></div>;
  const logos = (list ?? []).filter((a) => b.logos.includes(a.id));
  const set = (patch: Partial<BrandKit>) => setB({ ...b, ...patch });
  const setStyle = (id: string, patch: Partial<TextStyle>) => set({ textStyles: b.textStyles.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-black">Brand Kit</h1><p className="text-muted">Logos, colours and fonts you can apply to any design in one click.</p></div>
        <button className="btn-primary" disabled={busy} onClick={async () => { setBusy(true); await save(b); setBusy(false); toast('Brand Kit saved'); }}>Save Brand Kit</button>
      </div>

      <section className="card mt-6 p-5">
        <h2 className="font-bold">Logos</h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {logos.map((a) => (
            <div key={a.id} className="group relative h-28 w-28 rounded-xl border border-line bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2">
              <img src={a.url} alt={a.name} className="h-full w-full object-contain" />
              <button aria-label="Remove logo" className="absolute right-1 top-1 hidden rounded bg-white p-1 text-danger shadow group-hover:block" onClick={() => set({ logos: b.logos.filter((x) => x !== a.id) })}><Trash2 size={14} /></button>
            </div>
          ))}
          <input ref={input} type="file" accept={ACCEPT_ATTR} hidden multiple onChange={async (e) => {
            if (!e.target.files?.length) return;
            try { const added = await importFiles([...e.target.files], 'logo'); notifyAssets(); const next = { ...b, logos: [...b.logos, ...added.map((a) => a.id)] }; setB(next); await save(next); toast('Logo added'); }
            catch (err) { toast((err as Error).message, 'error'); }
            e.target.value = '';
          }} />
          <button className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-sm font-semibold text-muted hover:bg-slate-50" onClick={() => input.current?.click()}><Upload size={18} />Upload logo</button>
        </div>
        <p className="mt-2 text-xs text-muted">PNG or SVG with a transparent background works best.</p>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-bold">Colours</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <ColorField label="Primary" value={b.primary} onChange={(c) => set({ primary: c })} />
          <ColorField label="Secondary" value={b.secondary} onChange={(c) => set({ secondary: c })} />
        </div>
        <p className="label mt-5">Supporting palette</p>
        <div className="flex flex-wrap items-end gap-3">
          {b.palette.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <input type="color" value={c} aria-label={`Palette colour ${i + 1}`} onChange={(e) => set({ palette: b.palette.map((x, j) => (j === i ? e.target.value : x)) })} className="h-12 w-12 cursor-pointer rounded-xl border border-line p-1" />
              <button className="text-[11px] text-muted hover:text-danger" onClick={() => set({ palette: b.palette.filter((_, j) => j !== i) })}>remove</button>
            </div>
          ))}
          <button className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-dashed border-line" aria-label="Add colour" onClick={() => set({ palette: [...b.palette, '#888888'] })}><Plus size={16} /></button>
        </div>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-bold">Fonts</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {(['headingFont', 'bodyFont'] as const).map((k) => (
            <label key={k}><span className="label">{k === 'headingFont' ? 'Headings' : 'Body text'}</span>
              <select className="input" value={b[k]} onChange={(e) => set({ [k]: e.target.value })} style={{ fontFamily: b[k] }}>{FONTS.map((f) => <option key={f} style={{ fontFamily: f }}>{f}</option>)}</select>
              <p className="mt-2 text-2xl" style={{ fontFamily: b[k] }}>Move. Sweat. Repeat.</p>
            </label>
          ))}
        </div>
      </section>

      <section className="card mt-6 p-5">
        <div className="flex items-center justify-between"><h2 className="font-bold">Text styles</h2>
          <button className="btn-outline btn-sm" onClick={() => set({ textStyles: [...b.textStyles, { id: uid(), name: 'New style', fontFamily: b.bodyFont, fontSize: 40, fontWeight: 700, fill: b.primary, letterSpacing: 0 }] })}><Plus size={14} />Add style</button></div>
        <div className="mt-3 space-y-3">
          {b.textStyles.map((s) => (
            <div key={s.id} className="grid items-end gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_80px_90px_110px_auto]">
              <label><span className="label">Name</span><input className="input" value={s.name} onChange={(e) => setStyle(s.id, { name: e.target.value })} /></label>
              <label><span className="label">Font</span><select className="input" value={s.fontFamily} onChange={(e) => setStyle(s.id, { fontFamily: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></label>
              <label><span className="label">Size</span><input className="input" type="number" value={s.fontSize} onChange={(e) => setStyle(s.id, { fontSize: Number(e.target.value) })} /></label>
              <label><span className="label">Weight</span><select className="input" value={s.fontWeight} onChange={(e) => setStyle(s.id, { fontWeight: Number(e.target.value) })}>{[400, 500, 600, 700, 800, 900].map((w) => <option key={w}>{w}</option>)}</select></label>
              <label><span className="label">Colour</span><input type="color" className="h-10 w-full rounded-lg border border-line p-1" value={s.fill} onChange={(e) => setStyle(s.id, { fill: e.target.value })} /></label>
              <button className="icon-btn text-danger" aria-label={`Delete ${s.name}`} onClick={() => set({ textStyles: b.textStyles.filter((x) => x.id !== s.id) })}><Trash2 size={16} /></button>
              <p className="sm:col-span-6" style={{ fontFamily: s.fontFamily, fontWeight: s.fontWeight, color: s.fill, fontSize: Math.min(40, s.fontSize / 2.5), textTransform: s.uppercase ? 'uppercase' : 'none' }}>{s.name}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
