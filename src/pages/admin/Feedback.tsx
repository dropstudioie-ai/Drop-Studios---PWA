import { useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { feedback, average } from '../../lib/feedback';
import { FeedbackList, FeedbackSummary } from '../Feedback';
import { ErrorNotice, PageSpinner } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../api';
import { fmt } from '../../domain/time';

/** Admin: every rating, by instructor, and the ones members agreed to share. */
export default function AdminFeedback() {
  const list = useAsync(() => feedback.staff(365), []);
  const [shareOnly, setShareOnly] = useState(false);
  if (list.loading && !list.data) return <PageSpinner />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  const all = list.data!;
  const by = new Map<string, typeof all>();
  for (const f of all) { const k = f.instructor ?? 'No instructor'; by.set(k, [...(by.get(k) ?? []), f]); }
  const shown = shareOnly ? all.filter((f) => f.share_ok && f.comment && f.rating >= 4) : all;
  return (
    <div className="space-y-6">
      <AppFeedback />
      <FeedbackSummary items={all} />
      {by.size > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {[...by].map(([name, items]) => (
            <div key={name} className="card p-3">
              <p className="font-semibold">{name}</p>
              <p className="text-sm text-muted"><strong className="text-ink">{average(items)}</strong> ★ · {items.length} rating{items.length === 1 ? '' : 's'}</p>
            </div>
          ))}
        </div>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={shareOnly} onChange={(e) => setShareOnly(e.target.checked)} />
        Show only reviews we can use in marketing (4–5 stars, with a comment, member agreed to share)
      </label>
      <FeedbackList items={shown} showInstructor showMember />
    </div>
  );
}

/** What members (mostly those moved from the old app) think of the new app. */
function AppFeedback() {
  const list = useAsync(async () => unwrap(await supabase.from('app_feedback').select('id, rating, comment, created_at, member:profiles(full_name)').order('created_at', { ascending: false }).limit(100)) as unknown as
    { id: number; rating: number; comment: string | null; created_at: string; member: { full_name: string | null } | null }[], []);
  const rows = list.data ?? [];
  if (!rows.length) return null;
  const avg = (rows.reduce((n, r) => n + r.rating, 0) / rows.length).toFixed(1);
  return (
    <section className="rounded-2xl border-2 border-brand-200 bg-brand-50 p-4">
      <p className="font-bold">📱 What members think of the new app · <span className="text-brand-700">{avg} ★</span> from {rows.length}</p>
      <ul className="mt-2 space-y-2">
        {rows.slice(0, 20).map((r) => (
          <li key={r.id} className="rounded-xl bg-white p-3 text-sm">
            <span className="font-semibold">{'⭐'.repeat(r.rating)}</span> <span className="text-muted">· {r.member?.full_name ?? 'Member'} · {fmt.date(r.created_at)}</span>
            {r.comment && <p className="mt-1 text-ink-soft">“{r.comment}”</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
