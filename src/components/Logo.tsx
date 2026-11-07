import { useId } from 'react';
import { CUTS, LETTERS, LOGO_VIEWBOX, PLAY } from '../brand/logoData';

const ORANGE = '#FF7A00';

/**
 * The Drop wordmark: DROP in the studio's stencil letters, with an orange
 * play button inside the D. The stencil cuts are transparent, so it sits on
 * any background.
 */
export function Logo({ light = false, height = 24, className = '' }: { light?: boolean; height?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox={LOGO_VIEWBOX} height={height} className={`block ${className}`} role="img" aria-label="Drop Studios">
      <defs>
        <mask id={`cut${id}`} maskUnits="userSpaceOnUse" x="40" y="135" width="300" height="80">
          <rect x="40" y="135" width="300" height="80" fill="#fff" />
          {CUTS.map((c) => <rect key={c.x} x={c.x} y={c.y} width={c.w} height={c.h} fill="#000" />)}
        </mask>
      </defs>
      <g fill={light ? '#FFFFFF' : '#0B0B0D'} mask={`url(#cut${id})`}>
        {LETTERS.map((g) => <path key={g.x} transform={`translate(${g.x} ${g.y})`} d={g.d} />)}
      </g>
      <path d={PLAY} fill={ORANGE} stroke={ORANGE} strokeWidth={2.4} strokeLinejoin="round" />
    </svg>
  );
}
