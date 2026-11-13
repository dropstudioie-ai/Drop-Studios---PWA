import type { TextElement } from '../model/types';
import { makeText } from '../model/elements';
import { useBrand } from '../lib/brand';
import { useEditor } from '../store/editor';
import { addElement, dragProps } from './addHelpers';

const scaleFor = () => { const d = useEditor.getState().design; return d ? Math.min(d.width, d.height) / 1080 : 1; };

const PRESETS: { label: string; preview: React.CSSProperties; el: Partial<TextElement> & { text: string } }[] = [
  { label: 'Add a heading', preview: { fontFamily: 'Inter', fontWeight: 800, fontSize: 24 }, el: { text: 'Add a heading', fontSize: 96, fontWeight: 800, width: 800 } },
  { label: 'Add a subheading', preview: { fontFamily: 'Inter', fontWeight: 600, fontSize: 18 }, el: { text: 'Add a subheading', fontSize: 56, fontWeight: 600, width: 700 } },
  { label: 'Add body text', preview: { fontFamily: 'Inter', fontWeight: 400, fontSize: 14 }, el: { text: 'Add a little bit of body text', fontSize: 34, fontWeight: 400, width: 640, lineHeight: 1.4 } },
];
const COMBOS: { label: string; preview: React.CSSProperties; el: Partial<TextElement> & { text: string } }[] = [
  { label: 'HIP HOP', preview: { fontFamily: 'Anton', fontSize: 28 }, el: { text: 'HIP HOP', fontFamily: 'Anton', fontWeight: 400, fontSize: 200, width: 900 } },
  { label: 'Dance night', preview: { fontFamily: 'Archivo Black', fontSize: 22, fontStyle: 'italic' }, el: { text: 'DANCE NIGHT', fontFamily: 'Archivo Black', fontWeight: 400, italic: true, fontSize: 120, width: 900 } },
  { label: 'Elegant', preview: { fontFamily: 'Playfair Display', fontSize: 22, fontWeight: 700 }, el: { text: 'First Dance', fontFamily: 'Playfair Display', fontWeight: 700, fontSize: 110, width: 900 } },
  { label: 'Spaced', preview: { fontFamily: 'Inter', fontSize: 13, letterSpacing: 4, fontWeight: 800 }, el: { text: 'NEW CLASS', fontWeight: 800, fontSize: 40, letterSpacing: 12, width: 600 } },
  { label: 'Marker', preview: { fontFamily: 'Permanent Marker', fontSize: 22 }, el: { text: 'Let’s dance!', fontFamily: 'Permanent Marker', fontWeight: 400, fontSize: 120, width: 700, fill: '#ff2d55' } },
  { label: 'Bebas', preview: { fontFamily: 'Bebas Neue', fontSize: 26 }, el: { text: 'HEELS CLASS', fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 130, width: 1000 } },
];

function build(el: Partial<TextElement> & { text: string }) {
  const s = scaleFor();
  return makeText({ ...el, fontSize: (el.fontSize ?? 48) * s, width: (el.width ?? 600) * s, letterSpacing: (el.letterSpacing ?? 0) * s, name: el.text.slice(0, 24) });
}

export function TextPanel() {
  const { brand } = useBrand();
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => void addElement(build(p.el))} {...dragProps({ kind: 'element', element: build(p.el) })}
            className="block w-full rounded-xl border border-line px-4 py-3 text-left hover:bg-slate-50" style={p.preview}>{p.label}</button>
        ))}
      </section>
      {brand && brand.textStyles.length > 0 && (
        <section>
          <h3 className="label">Brand text styles</h3>
          <div className="space-y-2">
            {brand.textStyles.map((st) => {
              const el = { text: st.name, fontFamily: st.fontFamily, fontSize: st.fontSize, fontWeight: st.fontWeight, fill: st.fill, letterSpacing: st.letterSpacing, uppercase: st.uppercase, width: 900 };
              return (
                <button key={st.id} onClick={() => void addElement(build(el))} {...dragProps({ kind: 'element', element: build(el) })}
                  className="block w-full truncate rounded-xl border border-line px-4 py-2 text-left hover:bg-slate-50"
                  style={{ fontFamily: st.fontFamily, fontWeight: st.fontWeight, color: st.fill, fontSize: Math.min(26, Math.max(13, st.fontSize / 5)), textTransform: st.uppercase ? 'uppercase' : 'none' }}>{st.name}</button>
              );
            })}
          </div>
        </section>
      )}
      <section>
        <h3 className="label">Font combinations</h3>
        <div className="grid grid-cols-2 gap-2">
          {COMBOS.map((c) => (
            <button key={c.label} onClick={() => void addElement(build(c.el))} {...dragProps({ kind: 'element', element: build(c.el) })}
              className="flex h-20 items-center justify-center rounded-xl bg-slate-900 px-2 text-center text-white hover:bg-slate-800" style={c.preview}>{c.el.text}</button>
          ))}
        </div>
      </section>
      <p className="text-xs text-muted">Tip: double-click any text on the page to edit it. Drag these onto the page to place them exactly.</p>
    </div>
  );
}
