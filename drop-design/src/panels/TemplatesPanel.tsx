import { useNavigate } from 'react-router-dom';
import { TemplateGallery } from './TemplateGallery';
import { designFromTemplate, type Template } from '../templates/kit';
import { useEditor } from '../store/editor';
import { useConfirm, useToast } from '../components/ui';
import { fitPage } from '../model/elements';
import { formatById } from '../model/types';
import { projects } from '../storage/db';

export function TemplatesPanel() {
  const confirm = useConfirm();
  const toast = useToast();
  const nav = useNavigate();
  async function pick(tp: Template) {
    const s = useEditor.getState();
    const d = s.design!;
    const f = formatById(tp.format)!;
    const sameSize = f.width === d.width && f.height === d.height;
    const page = d.pages[s.pageIndex];
    if (!sameSize) {
      const ok = await confirm({ title: 'Different size', body: `“${tp.name}” is made for ${f.label} (${f.width}×${f.height}). Open it as a new design? (Choose Cancel to keep working here.)`, ok: 'Open as new design' });
      if (!ok) return;
      const nd = designFromTemplate(tp);
      await projects.save(nd);
      nav(`/design/${nd.id}`);
      return;
    }
    if (page.elements.length > 0) {
      const ok = await confirm({ title: 'Use this template?', body: 'Its pages replace the current page. You can undo this.', ok: 'Use template' });
      if (!ok) return;
    }
    const tpl = designFromTemplate(tp);
    s.update((dd) => {
      const pages = tpl.pages.map((p) => fitPage(p, f.width, f.height, dd.width, dd.height));
      dd.pages.splice(s.pageIndex, 1, ...pages);
    });
    s.select([]);
    toast('Template applied: everything is editable');
  }
  return <TemplateGallery onPick={(t) => void pick(t)} />;
}
