import { useState } from 'react';
import { Link } from 'react-router-dom';
import { STUDIO } from '../config/studio';
import { formatPrice } from '../domain/money';
import { messageFor } from '../domain/messages';
import { formatKey } from '../domain/time';
import { CANCEL_NOTICE_HOURS, cancelPreview, endsOn, type Subscription } from '../domain/subscription';
import { manageSubscription } from '../lib/payments';
import { Notice, Sheet, Spinner, useToast } from './ui';

const day = (d: string) => formatKey(d, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

/** A monthly membership: payment X of 3, next payment, cancelling. */
export function SubscriptionCard({ sub, onChanged }: { sub: Subscription; onChanged: () => void }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = sub.plan_snapshot;
  const price = formatPrice(p.price_cents, p.currency);
  const cancelling = sub.status === 'cancel_scheduled';
  const ends = endsOn(sub);
  const preview = cancelPreview(sub);

  async function run(action: 'cancel' | 'undo_cancel') {
    setBusy(true);
    try {
      const r = await manageSubscription(action, sub.id);
      toast(action === 'cancel'
        ? `Cancelled. Your membership ends on ${day(r.ends_on ?? preview.endsOn ?? '')}.`
        : 'Great, your membership continues.');
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
            <div><dt className="text-muted">Payments</dt><dd className="font-semibold">{sub.periods_paid} of {sub.total_periods} paid</dd></div>
            <div>
              <dt className="text-muted">Next payment</dt>
              <dd className="font-semibold">{sub.next_billing_on ? `${price} on ${day(sub.next_billing_on)}` : 'None, all done'}</dd>
            </div>
            {ends && <div><dt className="text-muted">Ends on</dt><dd className="font-semibold">{day(ends)}</dd></div>}
          </dl>
        )}
        {sub.status !== 'ended' && <p className="text-xs text-muted">Pausing your membership moves your next payment back by the paused days.</p>}

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
            <p className="text-ink-soft">You can cancel any time, with no penalty. You keep your classes until the end of the month you’ve paid for.</p>
            <ul className="space-y-1 rounded-xl bg-canvas p-4 text-sm">
              {preview.endsOn && <li>Ends on <strong>{day(preview.endsOn)}</strong></li>}
              <li>{preview.paymentsLeft === 0
                ? 'No more payments'
                : `It’s less than ${CANCEL_NOTICE_HOURS} hours before your next payment, so that payment (${price}) is still taken and you get that month’s classes.`}</li>
            </ul>
            <p className="text-xs text-muted">
              Just joined? You can cancel within 14 days for a refund if you haven’t used any classes. Contact us at {STUDIO.email} or at reception.
            </p>
            <div className="flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setConfirming(false)}>Keep membership</button>
              <button className="btn-danger flex-1" disabled={busy} onClick={() => void run('cancel')}>{busy && <Spinner />}Yes, cancel</button>
            </div>
          </div>
        </Sheet>
      )}
      {sub.status === 'ended' && sub.end_reason === 'completed' && (
        <div className="border-t border-line p-5 text-sm">
          <p className="font-semibold">You completed your {sub.total_periods} months. 🎉</p>
          <p className="text-ink-soft">Sign up again and get 3 free classes to use in your first 7 days.</p>
          <Link to="/memberships" className="btn-primary btn-sm mt-3">Choose a membership</Link>
        </div>
      )}
    </section>
  );
}
