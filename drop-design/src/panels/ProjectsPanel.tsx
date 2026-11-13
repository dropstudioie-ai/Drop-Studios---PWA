import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Design } from '../model/types';
import { projects } from '../storage/db';
import { useEditor } from '../store/editor';

export function ProjectsPanel() {
  const [list, setList] = useState<Design[] | null>(null);
  const current = useEditor((s) => s.design?.id);
  useEffect(() => { projects.list().then(setList); }, []);
  return (
    <div className="space-y-2">
      <Link to="/" className="btn-outline btn-sm w-full">All designs & folders</Link>
      {list?.slice(0, 30).map((d) => (
        <Link key={d.id} to={`/design/${d.id}`} className={`flex items-center gap-3 rounded-xl p-2 hover:bg-slate-50 ${d.id === current ? 'bg-brand-50' : ''}`}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">{d.thumbnail && <img src={d.thumbnail} alt="" className="max-h-full max-w-full" />}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{d.name}</span><span className="text-xs text-muted">{new Date(d.updatedAt).toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' })}</span></span>
        </Link>
      ))}
    </div>
  );
}
