import { useEffect, useState } from 'react';
import { photoUrl } from '../lib/avatar';

export function initials(name: string | null | undefined) {
  return (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

/** Round profile photo, falling back to initials. */
export function Avatar({ path, name, size = 40 }: { path: string | null | undefined; name?: string | null; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    photoUrl(path).then((u) => live && setUrl(u)).catch(() => {});
    return () => { live = false; };
  }, [path]);
  const style = { width: size, height: size };
  return url ? (
    <img src={url} alt={name ? `${name}’s profile photo` : 'Profile photo'} style={style} className="shrink-0 rounded-full object-cover" />
  ) : (
    <span style={{ ...style, fontSize: size * 0.38 }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700" aria-hidden="true">
      {initials(name)}
    </span>
  );
}
