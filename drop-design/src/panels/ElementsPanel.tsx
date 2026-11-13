import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { ShapeKind } from '../model/types';
import { makeShape } from '../model/elements';
import { FEATURED_ICONS, iconDataUrl, iconNames } from '../lib/icons';
import { LIBRARY } from '../assets/library';
import { addElement, addPayload, dragProps } from './addHelpers';

const SHAPES: { shape: ShapeKind; label: string; w: number; h: number; extra?: Record<string, unknown> }[] = [
  { shape: 'rect', label: 'Square', w: 300, h: 300 },
  { shape: 'rect', label: 'Rounded', w: 300, h: 300, extra: { cornerRadius: 48 } },
  { shape: 'rect', label: 'Pill', w: 420, h: 120, extra: { cornerRadius: 60 } },
  { shape: 'ellipse', label: 'Circle', w: 300, h: 300 },
  { shape: 'triangle', label: 'Triangle', w: 300, h: 260 },
  { shape: 'star', label: 'Star', w: 300, h: 300 },
  { shape: 'hexagon', label: 'Hexagon', w: 300, h: 300 },
  { shape: 'blob', label: 'Blob', w: 340, h: 320 },
  { shape: 'rect', label: 'Outline', w: 300, h: 300, extra: { fill: 'rgba(0,0,0,0)', strokeWidth: 8, stroke: '#0b0b0d' } },
  { shape: 'line', label: 'Line', w: 400, h: 20, extra: { fill: '#0b0b0d', strokeWidth: 8 } },
  { shape: 'line', label: 'Dashed', w: 400, h: 20, extra: { fill: '#0b0b0d', strokeWidth: 8, dash: true } },
  { shape: 'arrow', label: 'Arrow', w: 400, h: 60, extra: { fill: '#0b0b0d', strokeWidth: 10 } },
];

function ShapePreview({ s }: { s: (typeof SHAPES)[number] }) {
  const c = '#3f3f46';
  const common = { fill: s.extra?.fill === 'rgba(0,0,0,0)' ? 'none' : c, stroke: c, strokeWidth: s.extra?.strokeWidth ? 4 : 0 };
  return (
    <svg viewBox="0 0 60 60" className="h-12 w-12" aria-hidden>
      {s.shape === 'rect' && <rect x={s.w > s.h ? 4 : 10} y={s.w > s.h ? 20 : 10} width={s.w > s.h ? 52 : 40} height={s.w > s.h ? 20 : 40} rx={s.extra?.cornerRadius ? 10 : 0} {...common} />}
      {s.shape === 'ellipse' && <circle cx="30" cy="30" r="21" {...common} />}
      {s.shape === 'triangle' && <path d="M30 9 L52 50 H8 Z" {...common} />}
      {s.shape === 'star' && <path d="M30 6 L36 23 L54 23 L40 34 L45 52 L30 41 L15 52 L20 34 L6 23 L24 23 Z" {...common} />}
      {s.shape === 'hexagon' && <path d="M30 6 L51 18 V42 L30 54 L9 42 V18 Z" {...common} />}
      {s.shape === 'blob' && <path d="M30 6 C48 6 56 20 54 32 C52 46 40 54 28 53 C14 52 5 42 7 28 C9 14 18 6 30 6Z" {...common} />}
      {s.shape === 'line' && <line x1="6" y1="30" x2="54" y2="30" stroke={c} strokeWidth="4" strokeDasharray={s.extra?.dash ? '6 4' : undefined} />}
      {s.shape === 'arrow' && <path d="M6 30 H54 M44 20 L54 30 L44 40" stroke={c} strokeWidth="4" fill="none" />}
    </svg>
  );
}

export function ElementsPanel() {
  const [q, setQ] = useState('');
  const icons = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return FEATURED_ICONS;
    return iconNames().filter((n) => n.toLowerCase().includes(s)).slice(0, 120);
  }, [q]);
  const illos = LIBRARY.filter((l) => l.src.includes('/illo-') || l.src.includes('shape-'));
  const make = (s: (typeof SHAPES)[number]) => makeShape({ shape: s.shape, width: s.w, height: s.h, fill: '#14e0a8', strokeWidth: 0, name: s.label, ...s.extra });
  return (
    <div className="space-y-6">
      <section>
        <h3 className="label">Shapes and lines</h3>
        <div className="grid grid-cols-4 gap-2">
          {SHAPES.map((s) => (
            <button key={s.label} title={s.label} aria-label={`Add ${s.label}`} onClick={() => void addElement(make(s))} {...dragProps({ kind: 'element', element: make(s) })}
              className="flex aspect-square items-center justify-center rounded-xl bg-slate-50 hover:bg-slate-100"><ShapePreview s={s} /></button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="label">Icons</h3>
        <label className="relative block">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <input className="input pl-9" placeholder="Search 2,000+ icons (e.g. dumbbell)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search icons" />
        </label>
        <div className="mt-2 grid grid-cols-6 gap-1">
          {icons.map((n) => (
            <button key={n} title={n} aria-label={`Add icon ${n}`} onClick={() => void addPayload({ kind: 'icon', icon: n })} {...dragProps({ kind: 'icon', icon: n })}
              className="flex aspect-square items-center justify-center rounded-lg hover:bg-slate-100">
              <img src={iconDataUrl(n, '#18181b', 2)} alt="" className="h-6 w-6" />
            </button>
          ))}
        </div>
        {icons.length === 0 && <p className="mt-2 text-sm text-muted">No icons found.</p>}
      </section>
      <section>
        <h3 className="label">Illustrations</h3>
        <div className="grid grid-cols-3 gap-2">
          {illos.map((l) => (
            <button key={l.src} title={l.name} onClick={() => void addPayload({ kind: 'library', src: l.src, width: l.width, height: l.height, name: l.name })} {...dragProps({ kind: 'library', src: l.src, width: l.width, height: l.height, name: l.name })}
              className="aspect-square rounded-xl bg-slate-50 p-1 hover:bg-slate-100"><img src={l.src} alt={l.name} className="h-full w-full object-contain" loading="lazy" /></button>
          ))}
        </div>
      </section>
    </div>
  );
}
