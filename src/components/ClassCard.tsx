import type { ClassSession } from '../api/types';
import { spotsLeft } from '../domain/booking';
import { fmt } from '../domain/time';
import { CheckIcon } from './icons';

export function ClassCard({ session, booked, onOpen, compact = false }: {
  session: ClassSession;
  booked: boolean;
  onOpen: () => void;
  compact?: boolean;
}) {
  const past = new Date(session.starts_at) <= new Date();
  const cancelled = session.status === 'cancelled';
  const left = spotsLeft(session);
  const color = session.style?.color ?? '#2f5bff';

  let status: { text: string; cls: string } | null = null;
  if (cancelled) status = { text: 'Cancelled', cls: 'bg-red-50 text-danger' };
  else if (booked) status = { text: 'Booked', cls: 'bg-green-50 text-success' };
  else if (past) status = null;
  else if (session.is_special) status = { text: 'Special event', cls: 'bg-accent-50 text-accent-600' };
  else if (left === 0) status = { text: 'Full', cls: 'bg-canvas text-muted' };
  else if (left <= 3) status = { text: `${left} left`, cls: 'bg-accent-50 text-ink' };

  return (
    <button
      onClick={onOpen}
      className={`group relative w-full overflow-hidden rounded-xl border bg-white text-left transition hover:-translate-y-0.5 hover:shadow-md ${
        booked ? 'border-success' : 'border-line'} ${past || cancelled ? 'opacity-55' : ''} ${compact ? 'p-3 pl-4' : 'p-4 pl-5'}`}
      aria-label={`${session.title}, ${fmt.dayMonth(session.starts_at)} at ${fmt.time(session.starts_at)}${booked ? ', booked' : ''}`}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className={`whitespace-nowrap font-display font-extrabold ${compact ? 'text-sm' : 'text-base'} ${cancelled ? 'line-through' : ''}`}>
          {fmt.time(session.starts_at)}<span className="font-semibold text-muted">–{fmt.time(session.ends_at)}</span>
        </p>
        {status && (
          <span className={`chip shrink-0 ${status.cls}`}>
            {booked && <CheckIcon width={12} height={12} />}{status.text}
          </span>
        )}
      </div>
      <p className={`mt-1 font-bold leading-tight ${compact ? 'text-sm' : ''}`}>{session.title}</p>
      <p className="mt-0.5 text-xs text-muted">
        {session.style?.name}{session.instructor ? ` · ${session.instructor.full_name}` : ''}{session.level ? ` · ${session.level}` : ''}
      </p>
    </button>
  );
}
