import { useState } from 'react';
import { Search } from 'lucide-react';
import { LIBRARY, LIBRARY_CATEGORIES } from '../assets/library';
import { addPayload, dragProps } from './addHelpers';

export function ImagesPanel() {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const list = LIBRARY.filter((l) => (cat === 'all' || l.categories.includes(cat)) && (!q || l.name.toLowerCase().includes(q.toLowerCase()) || l.categories.some((c) => c.includes(q.toLowerCase()))));
  return (
    <div className="space-y-3">
      <label className="relative block"><Search size={16} className="absolute left-3 top-2.5 text-muted" /><input className="input pl-9" placeholder="Search images" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search images" /></label>
      <div className="flex flex-wrap gap-1.5">
        {LIBRARY_CATEGORIES.map((c) => <button key={c} onClick={() => setCat(c)} className={`chip capitalize ${cat === c ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-soft'}`}>{c === 'drop' ? 'Drop Studios' : c}</button>)}
      </div>
      <div className="columns-2 gap-2">
        {list.map((l) => (
          <button key={l.src} title={l.name} className="mb-2 block w-full overflow-hidden rounded-xl hover:ring-2 hover:ring-brand-500"
            onClick={() => void addPayload({ kind: 'library', src: l.src, width: l.width, height: l.height, name: l.name })} {...dragProps({ kind: 'library', src: l.src, width: l.width, height: l.height, name: l.name })}>
            <img src={l.src} alt={l.name} loading="lazy" className="w-full" />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">Photos are Drop Studios’ own; illustrations and backgrounds were made for this app. Add your own under Uploads.</p>
    </div>
  );
}
