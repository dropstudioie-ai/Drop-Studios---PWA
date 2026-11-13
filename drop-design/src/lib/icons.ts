import * as lucide from 'lucide';

type IconNode = [string, Record<string, string | number>][];
const all = lucide as unknown as Record<string, IconNode>;

/** Fitness-friendly icons shown first; search covers the full open-source (ISC) Lucide set. */
export const FEATURED_ICONS = ['Dumbbell', 'HeartPulse', 'Bike', 'Timer', 'Flame', 'Trophy', 'Medal', 'Zap', 'Activity', 'Footprints',
  'Heart', 'Apple', 'Salad', 'Droplets', 'Sun', 'Moon', 'Smile', 'Users', 'User', 'Calendar', 'Clock', 'MapPin', 'Phone', 'Mail',
  'Instagram', 'Facebook', 'Linkedin', 'Star', 'Sparkles', 'Music', 'Headphones', 'Target', 'TrendingUp', 'Award', 'Crown', 'Gift',
  'Check', 'CircleCheck', 'ArrowRight', 'ChevronRight', 'Leaf', 'Brain', 'Coffee', 'Briefcase', 'Building2', 'Megaphone', 'PartyPopper', 'Ticket'];

export const iconNames = () => Object.keys(all).filter((k) => Array.isArray(all[k]) && /^[A-Z]/.test(k));

export function iconSvg(name: string, color: string, strokeWidth: number, size = 256): string {
  const node = all[name] ?? all.Circle;
  const kids = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${kids}</svg>`;
}

export const iconDataUrl = (name: string, color: string, strokeWidth: number) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name, color, strokeWidth))}`;
