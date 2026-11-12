import type { ClassSession } from '../api/types';
import { formatPrice } from '../domain/money';
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
  const full = !cancelled && !past && session.availability === 'full';
  const color = session.style?.color ?? '#2f5bff';

  let status: { text: string; cls: string } | null = null;
  if (cancelled) status = { text: 'Cancelled', cls: 'bg-red-50 text-danger' };
  else if (booked) status = { text: 'Booked', cls: 'bg-success text-white' };
  else if (past) status = null;
  else if (full) status = { text: 'Fully booked', cls: 'bg-ink/10 text-ink-soft' };
  else if (session.is_special) status = { text: session.ticket_price_cents != null ? formatPrice(session.ticket_price_cents) : 'Event', cls: 'bg-accent-500 text-ink' };
  else if (session.availability === 'almost_full') status = { text: 'Almost full', cls: 'bg-accent-100 text-ink' };

  const surface = booked ? 'border-success/60 bg-green-50/60' : full ? 'border-line bg-canvas' : 'border-line bg-white';

  return (
    <button
      onClick={onOpen}
      className={`group relative w-full overflow-hidden rounded-xl border text-left transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${surface} ${
        past || cancelled ? 'opacity-55' : ''} ${compact ? 'p-3 pl-4' : 'p-4 pl-5'}`}
      aria-label={`${session.title}, ${fmt.dayMonth(session.starts_at)} at ${fmt.time(session.starts_at)}${booked ? ', booked' : full ? ', full' : ''}`}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: color }} aria-hidden="true" />
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <p className={`whitespace-nowrap font-display font-extrabold ${compact ? 'text-sm' : 'text-lg'} ${cancelled ? 'line-through' : ''}`}>
          {fmt.time(session.starts_at)}<span className="font-semibold text-muted">–{fmt.time(session.ends_at)}</span>
        </p>
        {status && (
          <span className={`chip shrink-0 ${status.cls}`}>
            {booked && <CheckIcon width={12} height={12} />}{status.text}
          </span>
        )}
      </div>
      <p className={`mt-1 font-bold leading-tight ${compact ? 'text-sm' : 'text-base'}`}>{session.title}</p>
      {session.event && session.event.kind === 'special_class' && (
        <p className={`mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-accent-100 px-2 py-0.5 font-bold text-ink ${compact ? 'text-[11px]' : 'text-xs'}`}>
          <span aria-hidden="true">{session.event.emoji ?? '✨'}</span><span className="truncate">{session.event.title}</span>
        </p>
      )}
      <p className="mt-0.5 text-xs text-muted">
        <span className="font-semibold" style={{ color }}>{session.style?.name}</span>
        {session.instructor ? ` · ${session.instructor.full_name}` : ''}{session.level && !compact ? ` · ${session.level}` : ''}
      </p>
    </button>
  );
}
