import { useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { feedback, average } from '../../lib/feedback';
import { FeedbackList, FeedbackSummary } from '../Feedback';
import { ErrorNotice, PageSpinner } from '../../components/ui';

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
