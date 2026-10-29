import { Link } from 'react-router-dom';
import type { DanceStyle, Membership } from '../api/types';
import { formatPrice } from '../domain/money';
import { isExpiringSoon, lastValidDay, progressLabel, STATE_LABEL } from '../domain/membership';
import { styleAccessLabel } from '../domain/plans';
import { fmt, formatKey, localDateKey } from '../domain/time';
import { Notice, ProgressBar, TestBadge } from './ui';

const STATE_STYLE: Record<string, string> = {
  active: 'bg-green-50 text-success',
  pending_activation: 'bg-brand-50 text-brand-700',
  paused: 'bg-accent-50 text-accent-600',
  expired: 'bg-canvas text-muted',
  used_up: 'bg-canvas text-muted',
  cancelled: 'bg-red-50 text-danger',
};

export function MembershipCard({ m, styles, reminderDays, onPause, onResume, busy }: {
  m: Membership;
  styles: DanceStyle[];
  reminderDays: number;
  onPause?: () => void;
  onResume?: () => void;
  busy?: boolean;
}) {
  const today = localDateKey(new Date());
  const styleNames = (m.purchase?.allowed_style_ids ?? [])
    .map((id) => styles.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  const pauses = (m.pauses ?? []).filter((p) => !p.is_cancelled).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const currentOrNext = pauses.find((p) => p.ends_on >= today);
  const usable = m.state === 'active' || m.state === 'paused' || m.state === 'pending_activation';
  const finished = m.state === 'expired' || m.state === 'used_up' || m.state === 'cancelled';

  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-extrabold">{m.plan_name} {m.is_test && <TestBadge />}</h3>
          <p className="text-sm text-muted">Paid {formatPrice(m.purchase.price_cents, m.purchase.currency, { forceDecimals: true })} · bought {fmt.date(m.purchase.purchased_at)}</p>
        </div>
        <span className={`chip ${STATE_STYLE[m.state]}`}>{STATE_LABEL[m.state]}</span>
      </div>

      <div className="mt-4">
        <ProgressBar value={m.classes_remaining} max={m.classes_total} label={progressLabel(m.classes_remaining, m.classes_total)} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="col-span-2">
          <dt className="text-muted">{styleAccessLabel(m.style_access)}</dt>
          <dd className="font-semibold">{styleNames || '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">Activated</dt>
          <dd className="font-semibold">{m.activated_at ? fmt.date(m.activated_at) : 'On first booking'}</dd>
        </div>
        <div>
          <dt className="text-muted">{m.state === 'expired' ? 'Expired' : 'Valid until'}</dt>
          <dd className="font-semibold">{m.expires_at ? formatKey(lastValidDay(m.expires_at)) : `${m.purchase.validity_days} days after activation`}</dd>
        </div>
      </dl>

      {currentOrNext && (
        <div className="mt-4">
          <Notice tone="warn">
            {currentOrNext.starts_on <= today ? 'Paused' : 'Pause scheduled'}: {formatKey(currentOrNext.starts_on)} – {formatKey(currentOrNext.ends_on)}.
            {' '}Your expiry date already includes this pause.
          </Notice>
        </div>
      )}

      {usable && m.state !== 'paused' && isExpiringSoon(m.expires_at, reminderDays) && m.classes_remaining > 0 && (
        <div className="mt-4"><Notice tone="warn">Expires soon. You have {m.classes_remaining} {m.classes_remaining === 1 ? 'class' : 'classes'} left to use.</Notice></div>
      )}

      {finished && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-soft">
            {m.state === 'used_up' ? 'You’ve used all your classes. Nice work!' : m.state === 'expired' ? 'This membership has expired.' : 'This membership was cancelled by the studio.'}
          </p>
          <Link to="/memberships" className="btn-accent btn-sm">Explore plans</Link>
        </div>
      )}

      {usable && m.activated_at && (onPause || onResume) && (
        <div className="mt-4 flex gap-2">
          {currentOrNext
            ? onResume && <button className="btn-outline btn-sm" disabled={busy} onClick={onResume}>{currentOrNext.starts_on <= today ? 'End pause now' : 'Cancel scheduled pause'}</button>
            : onPause && m.classes_remaining > 0 && <button className="btn-outline btn-sm" disabled={busy} onClick={onPause}>Pause membership</button>}
        </div>
      )}
    </article>
  );
}
