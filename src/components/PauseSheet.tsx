import { manageSubscription } from '../lib/payments';
import { useState } from 'react';
import { api } from '../api';
import type { Membership, PauseAllowance } from '../api/types';
import { AppError } from '../lib/supabase';
import { validatePause } from '../domain/membership';
import { addDaysToKey, daysInclusive, formatKey, localDateKey } from '../domain/time';
import { ErrorNotice, Field, Notice, Sheet, Spinner } from './ui';

export function PauseSheet({ membership, allowance, onClose, onDone, adminOverride = false }: {
  membership: Membership;
  allowance: PauseAllowance | null;
  onClose: () => void;
  onDone: () => void;
  adminOverride?: boolean;
}) {
  const today = localDateKey(new Date());
  const minDays = allowance?.min_days ?? 7;
  // After a pause ends, members wait 10 days before the next one can start (admins aren't limited).
  const lastEnd = (membership.pauses ?? []).filter((p) => !p.is_cancelled && p.starts_on <= today).map((p) => p.ends_on).sort().pop();
  const earliest = !adminOverride && lastEnd && addDaysToKey(lastEnd, 11) > today ? addDaysToKey(lastEnd, 11) : today;
  const [start, setStart] = useState(earliest);
  const [end, setEnd] = useState(addDaysToKey(earliest, minDays - 1));
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expiresOnKey = membership.expires_at ? localDateKey(new Date(membership.expires_at)) : today;
  const days = start && end && end >= start ? daysInclusive(start, end) : 0;
  const clientError = start < earliest ? `You can pause again from ${formatKey(earliest, { weekday: 'short', day: 'numeric', month: 'short' })} (10 days after your last pause ended).` : override ? null : validatePause(start, end, {
    todayKey: today, expiresOnKey, minDays, remainingAllowance: allowance?.remaining_days ?? 90,
  });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.pause(membership.id, start, end, reason || undefined, adminOverride && override);
      // Monthly membership: the next payment moves back too; tell Square.
      if (membership.subscription_id) await manageSubscription('sync_billing', membership.subscription_id).catch(() => {});
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof AppError ? e.message : 'Could not pause the membership.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Pause membership">
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">
          While paused you can’t book classes. Your expiry date moves back by the number of paused days.
        </p>
        {earliest > today && (
          <Notice tone="info">Your last pause ended recently. You can start a new pause from <strong>{formatKey(earliest, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>.</Notice>
        )}
        {allowance && (
          <Notice tone="info">
            You have <strong>{allowance.remaining_days} of {allowance.max_days}</strong> pause days left in {allowance.year}. Minimum pause: {allowance.min_days} days.
          </Notice>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="First paused day"><input className="input" type="date" min={earliest} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Last paused day"><input className="input" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        {days > 0 && <p className="text-sm font-semibold">{days} {days === 1 ? 'day' : 'days'} · back on {formatKey(addDaysToKey(end, 1), { weekday: 'short', day: 'numeric', month: 'short' })}</p>}
        <Field label={adminOverride ? 'Reason (recorded in audit log)' : 'Reason (optional)'}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Holiday, injury" />
        </Field>
        {adminOverride && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Override minimum length and yearly limit
          </label>
        )}
        {clientError && <p className="text-sm text-danger">{clientError}</p>}
        {error && <ErrorNotice error={error} />}
        <button className="btn-primary w-full" disabled={busy || Boolean(clientError) || (adminOverride && !reason.trim())} onClick={submit}>
          {busy && <Spinner />}Pause {days > 0 ? `for ${days} days` : ''}
        </button>
      </div>
    </Sheet>
  );
}
