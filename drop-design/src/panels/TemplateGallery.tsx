import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../templates/templates';
import { designFromTemplate, type Template } from '../templates/kit';
import { renderPage } from '../export/export';
import { formatById } from '../model/types';

const thumbs = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

/** Thumbnails are rendered from the template itself, one at a time, and cached. */
export function useTemplateThumb(tp: Template) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let p = thumbs.get(tp.id);
    if (!p) {
      const d = designFromTemplate(tp);
      p = queue.then(() => renderPage(d, 0, { pixelRatio: 420 / Math.max(d.width, d.height), mime: 'image/jpeg', quality: 0.82 }));
      queue = p.catch(() => null);
      thumbs.set(tp.id, p);
    }
    p.then((s) => live && setSrc(s)).catch(() => {});
    return () => { live = false; };
  }, [tp]);
  return src;
}

function Thumb({ tp, onPick }: { tp: Template; onPick: (t: Template) => void }) {
  const src = useTemplateThumb(tp);
  const f = formatById(tp.format)!;
  return (
    <button onClick={() => onPick(tp)} className="group block w-full text-left" data-testid={`template-${tp.id}`}>
      <span className="block overflow-hidden rounded-xl border border-line bg-slate-100 transition group-hover:shadow-lg group-hover:ring-2 group-hover:ring-brand-500" style={{ aspectRatio: `${f.width} / ${f.height}` }}>
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="block h-full w-full animate-pulse bg-slate-200" />}
      </span>
      <span className="mt-1 block truncate text-xs font-semibold">{tp.name}</span>
      <span className="block text-[11px] text-muted">{f.label}</span>
    </button>
  );
}

export function TemplateGallery({ onPick, columns = 2 }: { onPick: (t: Template) => void; columns?: number }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('All');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return TEMPLATES.filter((t) => (cat === 'All' || t.category === cat) && (!s || t.name.toLowerCase().includes(s) || t.tags.some((x) => x.includes(s)) || t.category.toLowerCase().includes(s)));
  }, [q, cat]);
  return (
    <div>
      <label className="relative block">
        <Search size={16} className="absolute left-3 top-2.5 text-muted" />
        <input className="input pl-9" placeholder="Search templates" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates" />
      </label>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {['All', ...TEMPLATE_CATEGORIES].map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`chip ${cat === c ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-soft hover:bg-slate-200'}`}>{c}</button>
        ))}
      </div>
      <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {list.map((t) => <Thumb key={t.id} tp={t} onPick={onPick} />)}
      </div>
      {list.length === 0 && <p className="mt-6 text-center text-sm text-muted">No templates match “{q}”.</p>}
    </div>
  );
}
