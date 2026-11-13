/** Drop Design logo: the Drop wordmark being painted by a brush, plus "Design". */
export function Logo({ light, compact }: { light?: boolean; compact?: boolean }) {
  if (compact) return <img src="/favicon.svg" alt="Drop Design" className="h-8 w-8" />;
  return (
    <span className="inline-flex items-end gap-2" aria-label="Drop Design">
      <img src={light ? '/drop-design-logo-white.svg' : '/drop-design-logo.svg'} alt="" className="h-8 w-auto" />
      <span className={`pb-0.5 text-lg font-semibold tracking-tight ${light ? 'text-white/80' : 'text-ink'}`}>Design</span>
    </span>
  );
}
