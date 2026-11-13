import { useState, type ReactNode } from 'react';
import { FolderOpen, ImageIcon, LayoutTemplate, Palette, PartyPopper, Shapes, Type, Upload, Wallpaper, X } from 'lucide-react';
import { TemplatesPanel } from './TemplatesPanel';
import { ElementsPanel } from './ElementsPanel';
import { TextPanel } from './TextPanel';
import { UploadsPanel } from './UploadsPanel';
import { ImagesPanel } from './ImagesPanel';
import { BackgroundsPanel } from './BackgroundsPanel';
import { BrandPanel } from './BrandPanel';
import { ProjectsPanel } from './ProjectsPanel';
import { DropPanel } from '../drop/DropPanel';

const TABS: { id: string; label: string; icon: ReactNode; panel: () => ReactNode }[] = [
  { id: 'templates', label: 'Templates', icon: <LayoutTemplate size={20} />, panel: () => <TemplatesPanel /> },
  { id: 'elements', label: 'Elements', icon: <Shapes size={20} />, panel: () => <ElementsPanel /> },
  { id: 'text', label: 'Text', icon: <Type size={20} />, panel: () => <TextPanel /> },
  { id: 'uploads', label: 'Uploads', icon: <Upload size={20} />, panel: () => <UploadsPanel /> },
  { id: 'images', label: 'Images', icon: <ImageIcon size={20} />, panel: () => <ImagesPanel /> },
  { id: 'backgrounds', label: 'Backgrounds', icon: <Wallpaper size={20} />, panel: () => <BackgroundsPanel /> },
  { id: 'brand', label: 'Brand Kit', icon: <Palette size={20} />, panel: () => <BrandPanel /> },
  { id: 'drop', label: 'Drop', icon: <PartyPopper size={20} />, panel: () => <DropPanel /> },
  { id: 'projects', label: 'Projects', icon: <FolderOpen size={20} />, panel: () => <ProjectsPanel /> },
];

export function LeftSidebar() {
  const [tab, setTab] = useState<string | null>(() => (window.innerWidth >= 1280 ? 'templates' : null));
  const active = TABS.find((t) => t.id === tab);
  return (
    <div className="relative z-20 flex shrink-0 border-r border-line bg-white">
      <nav className="flex w-[72px] flex-col items-stretch gap-0.5 overflow-y-auto border-r border-line py-2" aria-label="Editor panels">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(tab === t.id ? null : t.id)} aria-pressed={tab === t.id}
            className={`mx-1.5 flex flex-col items-center gap-1 rounded-lg py-2 text-[10.5px] font-semibold transition ${tab === t.id ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-slate-100'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </nav>
      {active && (
        <section className="absolute left-[72px] top-0 flex h-full w-[300px] flex-col border-r border-line bg-white shadow-xl xl:static xl:w-[330px] xl:shadow-none" aria-label={active.label}>
          <div className="flex items-center justify-between px-4 pt-3">
            <h2 className="font-bold">{active.label}</h2>
            <button className="icon-btn" aria-label="Close panel" onClick={() => setTab(null)}><X size={16} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">{active.panel()}</div>
        </section>
      )}
    </div>
  );
}
