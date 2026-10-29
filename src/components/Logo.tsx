export function Logo({ light = false, className = '' }: { light?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-black tracking-tight ${className}`}>
      <svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="16" fill="#1F43E6" />
        <path d="M32 12c7 10 14 18 14 27a14 14 0 0 1-28 0c0-9 7-17 14-27z" fill="#FF7A00" />
      </svg>
      <span className={light ? 'text-white' : 'text-ink'}>DROP<span className="text-accent-500"> STUDIOS</span></span>
    </span>
  );
}
