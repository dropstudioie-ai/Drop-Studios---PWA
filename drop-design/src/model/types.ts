// The design document model. Everything stays as independent, editable elements;
// nothing is flattened into an image until export.

export type Fill = string | Gradient;
export interface Gradient {
  type: 'linear' | 'radial';
  colors: string[]; // 2+ stops, evenly spaced
  angle: number; // degrees, linear only
}

export interface Shadow { color: string; blur: number; offsetX: number; offsetY: number; opacity: number }

interface ElementBase {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked?: boolean;
  hidden?: boolean;
  shadow?: Shadow | null;
}

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number; // 100–900
  italic?: boolean;
  underline?: boolean;
  uppercase?: boolean;
  fill: string;
  align: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  letterSpacing: number;
  stroke?: { color: string; width: number } | null;
}

export interface ImageCrop { x: number; y: number; width: number; height: number } // 0–1 fractions of the source

export interface ImageElement extends ElementBase {
  type: 'image';
  /** 'asset:<id>' for uploads (IndexedDB), a path for library images, or a data URL. */
  src: string;
  crop?: ImageCrop | null;
  cornerRadius?: number;
  stroke?: string;
  strokeWidth?: number;
  flipX?: boolean;
  flipY?: boolean;
  brightness?: number; // -1..1
  contrast?: number; // -100..100
  grayscale?: boolean;
  blur?: number; // px
}

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'star' | 'hexagon' | 'line' | 'arrow' | 'blob';

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: ShapeKind;
  fill: Fill;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  dash?: boolean;
}

export interface IconElement extends ElementBase {
  type: 'icon';
  icon: string; // lucide icon name
  color: string;
  strokeWidth: number;
}

export interface GroupElement extends ElementBase {
  type: 'group';
  children: DesignElement[]; // positioned relative to the group
}

export type DesignElement = TextElement | ImageElement | ShapeElement | IconElement | GroupElement;
export type ElementType = DesignElement['type'];

export interface PageBackground {
  fill: Fill;
  image?: { src: string; opacity: number } | null;
}

export interface Page {
  id: string;
  background: PageBackground;
  elements: DesignElement[];
}

export interface Design {
  id: string;
  name: string;
  width: number;
  height: number;
  format: string; // preset id or 'custom'
  pages: Page[];
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  thumbnail?: string;
  /** Set when the design was made for a Drop Studios event. */
  dropEventId?: string | null;
}

export interface Folder { id: string; name: string; createdAt: number }

export interface Asset {
  id: string;
  name: string;
  type: string; // mime
  kind: 'photo' | 'logo' | 'background';
  width: number;
  height: number;
  size: number;
  blob: Blob;
  tags: string[];
  createdAt: number;
}

export interface TextStyle { id: string; name: string; fontFamily: string; fontSize: number; fontWeight: number; fill: string; letterSpacing: number; uppercase?: boolean }

export interface BrandKit {
  id: 'brand';
  name: string;
  logos: string[]; // asset ids
  primary: string;
  secondary: string;
  palette: string[];
  headingFont: string;
  bodyFont: string;
  textStyles: TextStyle[];
}

export interface FormatPreset { id: string; label: string; width: number; height: number; group: string; print?: boolean }

export const FORMATS: FormatPreset[] = [
  { id: 'ig-square', label: 'Instagram post (square)', width: 1080, height: 1080, group: 'Social' },
  { id: 'ig-portrait', label: 'Instagram post (portrait)', width: 1080, height: 1350, group: 'Social' },
  { id: 'ig-story', label: 'Instagram / Facebook story', width: 1080, height: 1920, group: 'Social' },
  { id: 'fb-landscape', label: 'Facebook post (landscape)', width: 1200, height: 630, group: 'Social' },
  { id: 'linkedin', label: 'LinkedIn post', width: 1200, height: 627, group: 'Social' },
  { id: 'a4-portrait', label: 'A4 portrait (poster, flyer)', width: 1240, height: 1754, group: 'Print', print: true },
  { id: 'a4-landscape', label: 'A4 landscape', width: 1754, height: 1240, group: 'Print', print: true },
  { id: 'presentation', label: 'Presentation 16:9', width: 1920, height: 1080, group: 'Business' },
  { id: 'banner', label: 'Newsletter / web banner', width: 1600, height: 500, group: 'Business' },
];

export const formatById = (id: string) => FORMATS.find((f) => f.id === id);
