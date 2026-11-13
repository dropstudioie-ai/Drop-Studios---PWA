import type { Fill } from '../model/types';
import { useEditor, currentPage } from '../store/editor';
import { LIBRARY } from '../assets/library';
import { ColorField, Slider } from '../components/ui';
import { useBrand } from '../lib/brand';
import { UploadsPanel } from './UploadsPanel';

const COLORS = ['#ffffff', '#f5f5f4', '#0b0b0d', '#0f172a', '#1f43e6', '#ff7a00', '#14e0a8', '#c6ff00', '#ffd60a', '#ef4444', '#ec4899', '#8b5cf6', '#0f766e', '#fde68a', '#e0f2fe', '#f4efe6'];
const GRADS: Fill[] = [
  { type: 'linear', colors: ['#ff512f', '#dd2476'], angle: 135 }, { type: 'linear', colors: ['#3b0764', '#db2777'], angle: 160 },
  { type: 'linear', colors: ['#0f172a', '#4338ca'], angle: 160 }, { type: 'linear', colors: ['#0f9b8e', '#7af0c6'], angle: 135 },
  { type: 'linear', colors: ['#ff7a00', '#ff2d55'], angle: 160 }, { type: 'linear', colors: ['#ede9fe', '#fce7f3'], angle: 160 },
  { type: 'radial', colors: ['#1f43e6', '#0b0b0d'], angle: 0 }, { type: 'linear', colors: ['#f5efe6', '#e8dcc8'], angle: 180 },
];
const css = (f: Fill) => typeof f === 'string' ? f : f.type === 'radial' ? `radial-gradient(${f.colors.join(',')})` : `linear-gradient(${f.angle}deg, ${f.colors.join(',')})`;

export function BackgroundsPanel() {
  const page = useEditor((s) => currentPage(s))!;
  const api = useEditor.getState;
  const { brand } = useBrand();
  const set = (fn: (p: typeof page) => void, key?: string) => api().update((d) => fn(d.pages[api().pageIndex]), key);
  const fill = page.background.fill;
  return (
    <div className="space-y-5">
      <ColorField label="Background colour" value={typeof fill === 'string' ? fill : fill.colors[0]} onChange={(c) => set((p) => { p.background.fill = c; }, 'bgcolor')} swatches={[...(brand?.palette ?? []), ...COLORS].filter((c, i, a) => a.indexOf(c) === i)} />
      <section>
        <h3 className="label">Gradients</h3>
        <div className="grid grid-cols-4 gap-2">
          {GRADS.map((g, i) => <button key={i} aria-label="Use gradient" className="aspect-square rounded-xl border border-black/5" style={{ background: css(g) }} onClick={() => set((p) => { p.background.fill = g; })} />)}
        </div>
        {typeof fill !== 'string' && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {fill.colors.slice(0, 2).map((c, i) => <ColorField key={i} label={`Colour ${i + 1}`} value={c} onChange={(v) => set((p) => { (p.background.fill as { colors: string[] }).colors[i] = v; }, `g${i}`)} />)}
            </div>
            {fill.type === 'linear' && <Slider label="Angle" value={fill.angle} min={0} max={360} onChange={(v) => set((p) => { (p.background.fill as { angle: number }).angle = v; }, 'gangle')} suffix="°" />}
          </div>
        )}
      </section>
      <section>
        <h3 className="label">Background images</h3>
        {page.background.image && (
          <div className="mb-3 space-y-2 rounded-xl bg-slate-50 p-3">
            <Slider label="Image transparency" value={Math.round((1 - page.background.image.opacity) * 100)} min={0} max={100} onChange={(v) => set((p) => { p.background.image!.opacity = 1 - v / 100; }, 'bgop')} suffix="%" />
            <button className="btn-outline btn-sm w-full" onClick={() => set((p) => { p.background.image = null; })}>Remove background image</button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {LIBRARY.filter((l) => l.categories.includes('backgrounds') || l.categories.includes('drop')).map((l) => (
            <button key={l.src} title={l.name} className="aspect-square overflow-hidden rounded-xl hover:ring-2 hover:ring-brand-500" onClick={() => set((p) => { p.background.image = { src: l.src, opacity: 1 }; })}>
              <img src={l.src} alt={l.name} loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      </section>
      <section>
        <h3 className="label">Your uploads as background</h3>
        <UploadsPanel onPickBackground />
      </section>
    </div>
  );
}
