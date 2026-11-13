import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { feedback, type FeedbackItem, type FeedbackRequest, average } from '../lib/feedback';
import { fmt } from '../domain/time';
import { ErrorNotice, PageSpinner, Spinner, useToast } from '../components/ui';

const WHY: Record<FeedbackRequest['reason'], string> = {
  first_in_style: 'Your first class in this style',
  every_6: 'You’ve done 6 classes in this style',
  event: 'Special event',
};

export function Stars({ value, onChange, size = 'text-4xl' }: { value: number; onChange?: (v: number) => void; size?: string }) {
  return (
    <div className="flex gap-1" role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        onChange
          ? <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
              className={`${size} leading-none transition ${n <= value ? 'text-accent-500' : 'text-line'} hover:scale-110`} onClick={() => onChange(n)}>★</button>
          : <span key={n} className={`${size} leading-none ${n <= value ? 'text-accent-500' : 'text-line'}`} aria-hidden="true">★</span>
      ))}
    </div>
  );
}

/** A member rates a class (from the notification link or the prompt). */
export default function FeedbackPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const reqs = useAsync(() => feedback.mine(), []);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [share, setShare] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (reqs.loading && !reqs.data) return <PageSpinner />;
  const r = reqs.data?.find((x) => x.id === id);
  if (!r) {
    return (
      <div className="container-page max-w-lg py-10 text-center">
        <h1 className="text-2xl font-black">Thanks!</h1>
        <p className="mt-2 text-ink-soft">This feedback has already been sent, or it’s no longer open.</p>
        <Link to="/timetable" className="btn-primary mt-6">Book your next class</Link>
      </div>
    );
  }
  return (
    <div className="container-page max-w-lg py-8">
      <p className="text-sm font-semibold text-accent-600">{WHY[r.reason]}</p>
      <h1 className="text-3xl font-black">How was {r.title}?</h1>
      <p className="mt-1 text-ink-soft">{fmt.dateTime(r.starts_at)}{r.instructor ? ` with ${r.instructor}` : ''}</p>
      <div className="card mt-6 space-y-4 p-5">
        <Stars value={rating} onChange={setRating} />
        <label className="block">
          <span className="label">Anything you’d like to tell us? (optional)</span>
          <textarea className="input min-h-28" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="What did you love? What could be better?" />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>Drop can share my review (with my first name) on its website and social media.</span>
        </label>
        <p className="text-xs text-muted">Your instructor sees your rating and comment, but not your name.</p>
        {error && <ErrorNotice error={error} />}
        <button className="btn-primary w-full" disabled={busy || rating === 0} onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await feedback.submit(r.id, rating, comment, share);
            toast('Thank you! Your feedback helps us improve.');
            navigate('/');
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}>{busy && <Spinner />}Send feedback</button>
      </div>
    </div>
  );
}

/** "How was your class?" cards for members with feedback waiting. */
export function FeedbackPrompt() {
  const reqs = useAsync(() => feedback.mine().catch(() => [] as FeedbackRequest[]), []);
  if (!reqs.data?.length) return null;
  return (
    <section className="card border-2 border-accent-500 p-4" aria-labelledby="fb-h">
      <h2 id="fb-h" className="font-display text-lg font-extrabold">⭐ How was your class?</h2>
      <p className="text-sm text-ink-soft">Takes 10 seconds and helps us make every class better.</p>
      <ul className="mt-3 space-y-2">
        {reqs.data.slice(0, 3).map((r) => (
          <li key={r.id}>
            <Link to={`/feedback/${r.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-canvas p-3 hover:bg-accent-50">
              <span className="min-w-0"><span className="block truncate font-semibold">{r.title}</span><span className="text-xs text-muted">{fmt.dateTime(r.starts_at)}</span></span>
              <span className="shrink-0 text-sm font-bold text-brand-700">Rate →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Feedback list for instructors (their classes, no names) and admins (everything). */
export function FeedbackList({ items, showInstructor, showMember }: { items: FeedbackItem[]; showInstructor?: boolean; showMember?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">No feedback yet. Members are asked after their first class in a style, every 6th class, and after events.</p>;
  return (
    <ul className="space-y-2">
      {items.map((f) => (
        <li key={f.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Stars value={f.rating} size="text-lg" />
            <span className="text-xs text-muted">{fmt.dayMonth(f.starts_at)} · {f.title}{showInstructor && f.instructor ? ` · ${f.instructor}` : ''}</span>
          </div>
          {f.comment && <p className="mt-2 whitespace-pre-line text-sm">“{f.comment}”</p>}
          <p className="mt-1 text-xs text-muted">
            {showMember && f.member ? `${f.member} · ` : ''}{WHY[f.reason as FeedbackRequest['reason']] ?? ''}
            {showMember && f.share_ok ? ' · ✅ OK to share' : ''}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function FeedbackSummary({ items }: { items: FeedbackItem[] }) {
  const avg = average(items);
  return (
    <p className="text-sm text-ink-soft">
      {avg == null ? 'No ratings yet.' : <><strong className="font-display text-2xl text-ink">{avg}</strong> ★ average from {items.length} rating{items.length === 1 ? '' : 's'} (last 90 days)</>}
    </p>
  );
}
