import type { Asset, Design } from '../model/types';
import { uid, walkElements } from '../model/elements';
import { assets, projects } from './db';

interface ProjectFile { app: 'drop-design'; version: 1; design: Design; assets: (Omit<Asset, 'blob'> & { data: string })[] }

const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

function assetIds(d: Design): string[] {
  const ids = new Set<string>();
  const add = (s?: string) => { if (s?.startsWith('asset:')) ids.add(s.slice(6)); };
  for (const p of d.pages) { add(p.background.image?.src); walkElements(p.elements, (e) => { if (e.type === 'image') add(e.src); }); }
  return [...ids];
}

/** One self-contained file: the design plus any uploaded images it uses. */
export async function exportProjectFile(d: Design): Promise<Blob> {
  const list: ProjectFile['assets'] = [];
  for (const id of assetIds(d)) {
    const a = await assets.get(id);
    if (a) { const { blob, ...meta } = a; list.push({ ...meta, data: await toDataUrl(blob) }); }
  }
  const file: ProjectFile = { app: 'drop-design', version: 1, design: { ...d, thumbnail: undefined }, assets: list };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export async function importProjectFile(f: File): Promise<Design> {
  let data: ProjectFile;
  try { data = JSON.parse(await f.text()); } catch { throw new Error('That file isn’t a Drop Design project.'); }
  if (data.app !== 'drop-design' || !data.design?.pages) throw new Error('That file isn’t a Drop Design project.');
  for (const a of data.assets ?? []) {
    if (await assets.get(a.id)) continue;
    const blob = await (await fetch(a.data)).blob();
    const { data: _d, ...meta } = a; void _d;
    await assets.save({ ...meta, blob });
  }
  const d: Design = { ...data.design, id: uid(), name: `${data.design.name} (imported)`, folderId: null, updatedAt: Date.now() };
  await projects.save(d);
  return d;
}
