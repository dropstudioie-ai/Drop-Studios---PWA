import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Links like /admin/rentals#requests jump to that part of the page once it has loaded and
 * highlight it, so the admin sees exactly what is waiting for them. Returns the classes to add.
 */
export function useFocus(id: string, ready: boolean): string {
  const { hash } = useLocation();
  const on = hash === `#${id}`;
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!on || !ready) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    setFlash(true);
    const off = setTimeout(() => setFlash(false), 4000);
    return () => { clearTimeout(t); clearTimeout(off); };
  }, [on, ready, id]);
  return `scroll-mt-24 ${on ? 'focus-target' : ''} ${flash ? 'focus-flash' : ''}`.trim();
}
