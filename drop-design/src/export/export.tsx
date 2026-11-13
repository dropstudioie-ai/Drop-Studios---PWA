import { createRoot } from 'react-dom/client';
import { Layer, Stage } from 'react-konva';
import type Konva from 'konva';
import { jsPDF } from 'jspdf';
import type { Design, DesignElement, Page } from '../model/types';
import { walkElements } from '../model/elements';
import { PageContent } from '../editor/render';
import { loadImage } from '../lib/images';
import { iconDataUrl } from '../lib/icons';
import { ensureFonts } from '../lib/fonts';

export type ExportFormat = 'png' | 'jpg' | 'pdf';
export interface ExportOptions {
  format: ExportFormat;
  scale: number; // 1 = design size, 2 = high quality
  transparent?: boolean; // PNG only
  pages: number[]; // page indexes
}

async function prepare(page: Page) {
  const srcs: string[] = [];
  const fonts: { family: string; weight: number; italic?: boolean }[] = [];
  if (page.background.image) srcs.push(page.background.image.src);
  walkElements(page.elements, (e: DesignElement) => {
    if (e.type === 'image') srcs.push(e.src);
    if (e.type === 'icon') srcs.push(iconDataUrl(e.icon, e.color, e.strokeWidth));
    if (e.type === 'text') fonts.push({ family: e.fontFamily, weight: e.fontWeight, italic: e.italic });
  });
  await Promise.all([ensureFonts(fonts), ...srcs.map((s) => loadImage(s).catch(() => null))]);
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Render one page off-screen with the same components as the editor, and return it as an image. */
export async function renderPage(design: Design, pageIndex: number, o: { pixelRatio: number; mime: 'image/png' | 'image/jpeg'; quality?: number; transparent?: boolean }): Promise<string> {
  const page = design.pages[pageIndex];
  await prepare(page);
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  document.body.appendChild(host);
  const root = createRoot(host);
  let stage: Konva.Stage | null = null;
  try {
    await new Promise<void>((resolve) => {
      root.render(
        <Stage width={design.width} height={design.height} ref={(s) => { stage = s; if (s) resolve(); }}>
          <Layer><PageContent page={page} width={design.width} height={design.height} transparent={o.transparent && o.mime === 'image/png'} /></Layer>
        </Stage>,
      );
    });
    await nextFrame(); await nextFrame(); // let image filters cache
    const s = stage as Konva.Stage | null;
    if (!s) throw new Error('Could not render the page.');
    s.draw();
    return s.toDataURL({ pixelRatio: o.pixelRatio, mimeType: o.mime, quality: o.quality ?? 0.95 });
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function thumbnail(design: Design): Promise<string> {
  const ratio = 360 / Math.max(design.width, design.height);
  return renderPage(design, 0, { pixelRatio: ratio, mime: 'image/jpeg', quality: 0.8 });
}

export function dataUrlToBlob(url: string): Blob {
  const [head, body] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'design';

export async function buildPdf(design: Design, pages: number[], scale: number): Promise<Blob> {
  const isA4 = design.format.startsWith('a4');
  const landscape = design.width > design.height;
  const doc = isA4
    ? new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true })
    : new jsPDF({ unit: 'px', format: [design.width, design.height], orientation: landscape ? 'landscape' : 'portrait', hotfixes: ['px_scaling'], compress: true });
  const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
  for (const [n, i] of pages.entries()) {
    if (n > 0) doc.addPage(isA4 ? 'a4' : [design.width, design.height], landscape ? 'landscape' : 'portrait');
    const img = await renderPage(design, i, { pixelRatio: scale, mime: 'image/jpeg', quality: 0.95 });
    doc.addImage(img, 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
  }
  doc.setProperties({ title: design.name, creator: 'Drop Design' });
  return doc.output('blob');
}

/** Export and download. Several PNG/JPG pages download as separate numbered files. */
export async function exportDesign(design: Design, o: ExportOptions) {
  const base = safeName(design.name);
  if (o.format === 'pdf') {
    downloadBlob(await buildPdf(design, o.pages, o.scale), `${base}.pdf`);
    return;
  }
  const mime = o.format === 'png' ? 'image/png' : 'image/jpeg';
  for (const i of o.pages) {
    const url = await renderPage(design, i, { pixelRatio: o.scale, mime, transparent: o.transparent });
    const suffix = o.pages.length > 1 || design.pages.length > 1 ? `-page-${i + 1}` : '';
    downloadBlob(dataUrlToBlob(url), `${base}${suffix}.${o.format}`);
    await new Promise((r) => setTimeout(r, 250)); // browsers block rapid multi-downloads
  }
}
