import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { completeTestCheckout, paymentsMode, startStripeCheckout } from '../lib/payments';
import { messageFor } from '../domain/messages';
import { formatPrice } from '../domain/money';
import { classesLabel, styleAccessLabel, validityLabel } from '../domain/plans';
import { computeExpiry, lastValidDay } from '../domain/membership';
import { formatKey } from '../domain/time';
import { MembershipTerms } from '../components/Terms';
import { EmptyState, ErrorNotice, Notice, PageSpinner, Spinner } from '../components/ui';

export default function Checkout() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const data = useAsync(async () => {
    const [plan, settings, styles, firstTime] = await Promise.all([
      api.planByCode(code), api.settings(), api.styles(), api.isFirstTimeCustomer(),
    ]);
    const planStyleIds = plan && !plan.all_styles ? await api.planStyles(plan.id) : null;
    return { plan, settings, styles, firstTime, planStyleIds };
  }, [code]);

  const [styleId, setStyleId] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per visit to this page: retries/double-clicks reuse the same payment.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  if (data.loading) return <PageSpinner />;
  if (data.error) return <div className="container-page py-8"><ErrorNotice error={data.error} onRetry={data.reload} /></div>;
  const { plan, settings, styles, firstTime, planStyleIds } = data.data!;
  if (!plan) {
    return (
      <div className="container-page py-8">
        <EmptyState title="This membership isn’t available" action={<Link to="/memberships" className="btn-primary">See memberships</Link>} />
      </div>
    );
  }

  const eligibleStyles = planStyleIds ? styles.filter((s) => planStyleIds.includes(s.id)) : styles;
  const needsStyle = plan.style_access === 'single';
  const introBlocked = plan.first_time_only && !firstTime;
  const expiryPreview = settings.activation_policy === 'on_purchase'
    ? formatKey(lastValidDay(computeExpiry(new Date(), plan.validity_days, 0, settings.timezone), settings.timezone), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const canPay = !busy && agreed && !introBlocked && (!needsStyle || styleId);

  async function pay() {
    setBusy(true);
    setError(null);
    const req = { plan_id: plan!.id, selected_style_id: needsStyle ? styleId : null, idempotency_key: idempotencyKey };
    try {
      if (paymentsMode === 'test') {
        const res = await completeTestCheckout(req);
        navigate(`/checkout/success?payment_id=${res.payment_id}`);
      } else {
        const res = await startStripeCheckout(req);
        if (res.url) window.location.assign(res.url);
        else navigate(`/checkout/success?payment_id=${res.payment_id}`);
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e as Error).message;
      setError(messageFor(code, 'We couldn’t start the payment. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <div className="container-page max-w-2xl py-8">
      <Link to="/memberships" className="text-sm font-semibold text-brand-700">← All memberships</Link>
      <h1 className="mt-3 text-3xl font-black">Checkout</h1>

      {paymentsMode === 'test' && (
        <div className="mt-4"><Notice tone="test">
          <strong>TEST MODE — no real payment will be taken.</strong> Memberships created here are marked TEST and are not real transactions.
        </Notice></div>
      )}

      <section className="card mt-6 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            {plan.display_label && <span className="chip mb-2 bg-accent-500 text-ink">{plan.display_label}</span>}
            <h2 className="text-xl font-extrabold">{plan.name}</h2>
            <p className="mt-1 font-semibold text-brand-700">{classesLabel(plan.class_count)} · {styleAccessLabel(plan.style_access)}</p>
            <p className="mt-1 text-sm text-ink-soft">{validityLabel(plan.validity_days)}</p>
            {expiryPreview && <p className="mt-1 text-sm text-ink-soft">If you buy today, it’s valid until <strong>{expiryPreview}</strong>.</p>}
          </div>
        </div>
      </section>

      {introBlocked && <div className="mt-4"><Notice tone="warn">The Intro Offer is for first-time customers only. <Link className="font-semibold underline" to="/memberships">See other memberships</Link></Notice></div>}

      {needsStyle && (
        <fieldset className="card mt-4 p-5">
          <legend className="sr-only">Choose your dance style</legend>
          <h2 className="text-lg font-extrabold">Choose your dance style</h2>
          <p className="mt-1 text-sm text-muted">You can book any class in this style. This can’t be changed after purchase.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {eligibleStyles.map((s) => (
              <label key={s.id} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm font-semibold transition ${
                styleId === s.id ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-line bg-white'}`}>
                <input type="radio" name="style" value={s.id} className="sr-only" checked={styleId === s.id} onChange={() => setStyleId(s.id)} />
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <section className="card mt-4 p-5">
        <h2 className="text-lg font-extrabold">Before you buy</h2>
        <div className="mt-3"><MembershipTerms settings={settings} compact /></div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I understand the expiry and cancellation rules above.</span>
        </label>
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-center justify-between text-lg">
          <span className="font-semibold">Total to pay</span>
          <span className="font-display text-3xl font-black">{formatPrice(plan.price_cents, plan.currency, { forceDecimals: true })}</span>
        </div>
        <p className="mt-1 text-right text-xs text-muted">One-off charge in euro (EUR).</p>
        {error && <div className="mt-4"><ErrorNotice error={error} /></div>}
        <button className={`${paymentsMode === 'test' ? 'btn-accent' : 'btn-primary'} mt-5 w-full text-lg`} disabled={!canPay} onClick={pay}>
          {busy && <Spinner />}
          {paymentsMode === 'test'
            ? 'Complete TEST purchase'
            : `Pay ${formatPrice(plan.price_cents, plan.currency, { forceDecimals: true })} securely`}
        </button>
        {paymentsMode === 'stripe' && <p className="mt-2 text-center text-xs text-muted">You’ll be taken to Stripe to pay. Card details never touch our servers.</p>}
      </section>
    </div>
  );
}
