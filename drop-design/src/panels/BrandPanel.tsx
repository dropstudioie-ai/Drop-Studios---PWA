import { Link } from 'react-router-dom';
import { useBrand } from '../lib/brand';
import { useAssets } from '../lib/useAssets';
import { useEditor } from '../store/editor';
import { colorsUsed, recolor, walkElements } from '../model/elements';
import { addPayload, dragProps } from './addHelpers';
import { useToast } from '../components/ui';

export function BrandPanel() {
  const { brand } = useBrand();
  const { list } = useAssets();
  const toast = useToast();
  if (!brand) return null;
  const logos = (list ?? []).filter((a) => brand.logos.includes(a.id));
  const palette = [brand.primary, brand.secondary, ...brand.palette].filter((c, i, a) => a.indexOf(c) === i);

  function applyColors() {
    useEditor.getState().update((d) => {
      const used = colorsUsed(d).filter((c) => c !== '#ffffff' && c !== '#000000');
      const map = new Map<string, string>();
      used.slice(0, palette.length).forEach((c, i) => map.set(c, palette[i]));
      recolor(d, map);
    });
    toast('Brand colours applied (undo with Ctrl+Z)');
  }
  function applyFonts() {
    useEditor.getState().update((d) => {
      for (const p of d.pages) {
        const sizes: number[] = [];
        walkElements(p.elements, (e) => { if (e.type === 'text') sizes.push(e.fontSize); });
        const big = sizes.length ? Math.max(...sizes) * 0.45 : 0;
        walkElements(p.elements, (e) => { if (e.type === 'text') e.fontFamily = e.fontSize >= big ? brand!.headingFont : brand!.bodyFont; });
      }
    });
    toast('Brand fonts applied');
  }
  function selectedToColor(c: string) {
    const s = useEditor.getState();
    const patches = s.design!.pages[s.pageIndex].elements.filter((e) => s.selectedIds.includes(e.id)).map((e) => ({
      id: e.id, patch: e.type === 'text' ? { fill: c } : e.type === 'shape' ? { fill: c } : e.type === 'icon' ? { color: c } : {},
    }));
    if (patches.length) s.updateElements(patches); else toast('Select something first, then click a colour', 'info');
  }

  return (
    <div className="space-y-5">
      <section>
        <h3 className="label">Logos</h3>
        {logos.length === 0 ? <p className="text-sm text-muted">No logos yet. <Link to="/brand" className="font-semibold text-ink underline">Add them in the Brand Kit</Link>.</p> : (
          <div className="grid grid-cols-3 gap-2">
            {logos.map((a) => (
              <button key={a.id} className="aspect-square rounded-xl bg-slate-50 p-2 hover:ring-2 hover:ring-brand-500" onClick={() => void addPayload({ kind: 'asset', id: a.id })} {...dragProps({ kind: 'asset', id: a.id })}>
                <img src={a.url} alt={a.name} className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </section>
      <section>
        <h3 className="label">Colours</h3>
        <div className="flex flex-wrap gap-2">
          {palette.map((c) => <button key={c} title={`Apply ${c} to selection`} aria-label={`Colour ${c}`} className="h-9 w-9 rounded-lg border border-black/10" style={{ background: c }} onClick={() => selectedToColor(c)} />)}
        </div>
        <button className="btn-outline btn-sm mt-3 w-full" onClick={applyColors}>Apply brand colours to this design</button>
      </section>
      <section>
        <h3 className="label">Fonts</h3>
        <p className="text-sm"><span style={{ fontFamily: brand.headingFont }} className="text-xl">{brand.headingFont}</span> for headings, <span style={{ fontFamily: brand.bodyFont }}>{brand.bodyFont}</span> for text</p>
        <button className="btn-outline btn-sm mt-3 w-full" onClick={applyFonts}>Apply brand fonts to this design</button>
      </section>
      <Link to="/brand" className="btn-ghost btn-sm w-full">Edit Brand Kit</Link>
    </div>
  );
}
