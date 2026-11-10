import { useState } from 'react';
import { formatPrice } from '../domain/money';
import { messageFor } from '../domain/messages';
import { formatKey } from '../domain/time';
import { subscriptionDates, type Subscription } from '../domain/subscription';
import { manageSubscription } from '../lib/payments';
import { Notice, Sheet, Spinner, useToast } from './ui';

const day = (d: string) => formatKey(d, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

/** A monthly membership: where it is in the 3-month cycle, next payment, cancelling. */
export function SubscriptionCard({ sub, onChanged }: { sub: Subscription; onChanged: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = subscriptionDates(sub);
  const p = sub.plan_snapshot;
  const price = formatPrice(p.price_cents, p.currency);
  const cancelling = sub.status === 'cancel_scheduled';

  async function run(action: 'cancel' | 'undo_cancel') {
    setBusy(true);
    try {
      const r = await manageSubscription(action, sub.id);
      toast(action === 'cancel'
        ? `Cancelled. Your membership ends on ${day(r.ends_on ?? d.cycleEnds)} and won’t renew.`
        : 'Great, your membership will keep renewing.');
      setConfirming(false);
      onChanged();
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e as Error).message;
      toast(messageFor(code, 'Something went wrong. Please try again.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card overflow-hidden" aria-labelledby={`sub-${sub.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 bg-ink p-5 text-white">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-white/60">Monthly membership</p>
          <h2 id={`sub-${sub.id}`} className="font-display text-2xl font-black uppercase tracking-tight">{p.plan_name}</h2>
          <p className="text-white/75">{price} / month · {p.class_count} classes a month{p.credit_rollover ? ' · classes roll over' : ''}</p>
        </div>
        <span className={`chip ${sub.status === 'active' ? 'bg-success text-white' : sub.status === 'past_due' ? 'bg-danger text-white' : sub.status === 'cancel_scheduled' ? 'bg-accent-500 text-ink' : 'bg-white/20 text-white'}`}>
          {sub.status === 'active' ? 'Active' : sub.status === 'past_due' ? 'Payment due' : sub.status === 'cancel_scheduled' ? 'Ending' : 'Ended'}
        </span>
      </div>

      <div className="space-y-3 p-5">
        {sub.status === 'past_due' && (
          <Notice tone="warn"><strong>Your last payment didn’t go through.</strong> Pay the invoice Square emailed you and this month’s classes are added straight away.</Notice>
        )}
        {sub.status !== 'ended' && (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted">This period</dt><dd className="font-semibold">Month {d.monthInCycle} of {d.commit}</dd></div>
            {(!cancelling || d.nextBilling < (sub.cancel_effective_on ?? '')) && (
              <div><dt className="text-muted">Next payment</dt><dd className="font-semibold">{price} on {day(d.nextBilling)}</dd></div>
            )}
            <div>
              <dt className="text-muted">{cancelling ? 'Ends on' : 'Renews for 3 more months on'}</dt>
              <dd className="font-semibold">{day(cancelling ? sub.cancel_effective_on ?? d.cycleEnds : d.cycleEnds)}</dd>
            </div>
          </dl>
        )}

        {sub.status !== 'ended' && !cancelling && (
          <button className="btn-ghost btn-sm text-danger" onClick={() => setConfirming(true)}>Cancel membership</button>
        )}
        {cancelling && !sub.provider_cancel_sent_at && (
          <button className="btn-outline btn-sm" disabled={busy} onClick={() => void run('undo_cancel')}>{busy && <Spinner />}Keep my membership</button>
        )}
      </div>

      {confirming && (
        <Sheet open onClose={() => setConfirming(false)} title="Cancel your membership?">
          <div className="space-y-4">
            <p className="text-ink-soft">
              Your membership has a {d.commit}-month minimum. If you cancel now, it <strong>won’t renew</strong>, and you keep dancing until the
              end of your current {d.commit}-month period:
            </p>
            <ul className="space-y-1 rounded-xl bg-canvas p-4 text-sm">
              <li>Ends on <strong>{day(d.cycleEnds)}</strong></li>
              <li>{d.paymentsLeftInCycle === 0 ? 'No more payments' : `${d.paymentsLeftInCycle} more monthly ${d.paymentsLeftInCycle === 1 ? 'payment' : 'payments'} of ${price}`}</li>
              <li>You get your classes each month until then</li>
            </ul>
            <p className="text-xs text-muted">Just bought it? You can cancel a purchase within 14 days for a refund. Contact the studio.</p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setConfirming(false)}>Keep membership</button>
              <button className="btn-danger flex-1" disabled={busy} onClick={() => void run('cancel')}>{busy && <Spinner />}Yes, cancel</button>
            </div>
          </div>
        </Sheet>
      )}
    </section>
  );
}
