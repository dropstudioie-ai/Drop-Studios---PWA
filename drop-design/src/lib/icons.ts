import * as lucide from 'lucide';

type IconNode = [string, Record<string, string | number>][];
const all = lucide as unknown as Record<string, IconNode>;

/** Fitness-friendly icons shown first; search covers the full open-source (ISC) Lucide set. */
export const FEATURED_ICONS = ['Music', 'Music2', 'Music4', 'Headphones', 'Mic', 'Disc3', 'Speaker', 'Radio', 'Footprints', 'Sparkles',
  'Star', 'Heart', 'Flame', 'Zap', 'Crown', 'Trophy', 'Medal', 'Award', 'PartyPopper', 'Ticket', 'Video', 'Camera', 'Clapperboard',
  'Smile', 'Users', 'User', 'Calendar', 'Clock', 'Timer', 'MapPin', 'Phone', 'Mail', 'AtSign', 'Share2', 'MessageCircle',
  'Gift', 'Sun', 'Moon', 'Check', 'CircleCheck', 'ArrowRight', 'ChevronRight', 'Megaphone', 'Ghost', 'TreePine', 'Clover', 'Egg', 'Rainbow'];

export const iconNames = () => Object.keys(all).filter((k) => Array.isArray(all[k]) && /^[A-Z]/.test(k));

export function iconSvg(name: string, color: string, strokeWidth: number, size = 256): string {
  const node = all[name] ?? all.Circle;
  const kids = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${kids}</svg>`;
}

export const iconDataUrl = (name: string, color: string, strokeWidth: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name, color, strokeWidth))}`;
