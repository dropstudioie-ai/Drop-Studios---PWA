import { useMemo } from 'react';

/** Falling emoji confetti, drawn in CSS (no library). */
export function Celebration({ emojis, count = 40 }: { emojis: string[]; count?: number }) {
  const bits = useMemo(() => Array.from({ length: count }, (_, i) => ({
    e: emojis[i % emojis.length], left: Math.random() * 100, delay: Math.random() * 2.5, dur: 3 + Math.random() * 3, size: 20 + Math.random() * 22,
  })), [emojis, count]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{'@keyframes drop-fall{0%{transform:translateY(-10vh) rotate(0)}100%{transform:translateY(110vh) rotate(540deg)}}'}</style>
      {bits.map((b, i) => (
        <span key={i} style={{ position: 'absolute', top: 0, left: `${b.left}%`, fontSize: b.size, animation: `drop-fall ${b.dur}s linear ${b.delay}s 2 both` }}>{b.e}</span>
      ))}
    </div>
  );
}
