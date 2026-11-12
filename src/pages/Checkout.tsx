import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { checkout, paymentsMode } from '../lib/payments';
import { messageFor } from '../domain/messages';
import { formatPrice } from '../domain/money';
import type { MembershipPlan } from '../domain/plans';
import { classesLabel, creditRule, isMonthly, ordinalDay, styleAccessLabel, termLabel, validityLabel } from '../domain/plans';
import { STUDIO } from '../config/studio';
import { isLive } from '../domain/subscription';
import { computeExpiry, lastValidDay } from '../domain/membership';
import { formatKey } from '../domain/time';
import { MembershipTerms } from '../components/Terms';
import { EmptyState, ErrorNotice, Notice, PageSpinner, Spinner } from '../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { StudioPhoto } from '../components/StudioPhoto';

export default function Checkout() {
  const { code = '' } = useParams();
  const [search] = useSearchParams();
  const renewing = search.get('renew') === '1';
  const navigate = useNavigate();
  const { profile } = useAuth();
  const data = useAsync(async () => {
    const [plan, settings, styles, firstTime, subscriptions] = await Promise.all([
      api.planByCode(code), api.settings(), api.styles(), api.isFirstTimeCustomer(),
      profile ? api.mySubscriptions(profile.id) : Promise.resolve([]),
    ]);
    const planStyleIds = plan && !plan.all_styles ? await api.planStyles(plan.id) : null;
    return { plan, settings, styles, firstTime, planStyleIds, subscriptions };
  }, [code, profile?.id]);

  // Renewing a single-style plan keeps the same style (it can still be changed here).
  const [styleId, setStyleId] = useState<string | null>(search.get('style'));
  const [agreed, setAgreed] = useState(false);
  const [agreedRecurring, setAgreedRecurring] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Shown when this checkout replaced an unfinished one, before going to Square.
  const [replaced, setReplaced] = useState<{ redirect: string; plans: string[] } | null>(null);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  // One key per visit to this page: retries/double-clicks reuse the same payment.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  if (data.loading) return <PageSpinner />;
  if (data.error) return <div className="container-page py-8"><ErrorNotice error={data.error} onRetry={data.reload} /></div>;
  const { plan, settings, styles, firstTime, planStyleIds, subscriptions } = data.data!;
  const liveSub = subscriptions.find(isLive) ?? null;
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

  const needsPhoto = !profile?.avatar_path;
  const monthly = isMonthly(plan);
  const canPay = !busy && agreed && (!monthly || agreedRecurring) && !introBlocked && !needsPhoto && (!needsStyle || styleId);

  async function pay() {
    setBusy(true);
    setError(null);
    const req = { plan_id: plan!.id, selected_style_id: needsStyle ? styleId : null, idempotency_key: idempotencyKey };
    try {
      const next = await checkout(req);
      if ('redirect' in next && next.superseded?.length) {
        setReplaced({ redirect: next.redirect, plans: next.superseded.map((x) => x.plan_name) });
        setBusy(false);
      } else if ('redirect' in next) window.location.assign(next.redirect);
      else navigate(next.navigate);
    } catch (e) {
      const code = (e as { code?: string }).code ?? (e as Error).message;
      if (code === 'earlier_payment_completed') setAlreadyPaid(true);
      setError(messageFor(code, 'We couldn’t start the payment. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <div className="container-page max-w-2xl py-8">
      <Link to="/memberships" className="text-sm font-semibold text-brand-700">← All memberships</Link>
      <StudioPhoto index={0} className="mt-4 aspect-[16/7]">
        <p className="font-display text-2xl font-black sm:text-3xl">You’re one step away from the floor.</p>
      </StudioPhoto>
      <h1 className="mt-5 text-3xl font-black">Checkout</h1>

      {paymentsMode === 'test' && (
        <div className="mt-4"><Notice tone="test">
          <strong>TEST MODE — no real payment will be taken.</strong> Memberships created here are marked TEST and are not real transactions.
        </Notice></div>
      )}

      {renewing && (
        <div className="mt-4"><Notice tone="info">
          <strong>Renewing early.</strong> You’ve used all the classes on your current membership, so this new one gives you classes again straight away.
        </Notice></div>
      )}

      {monthly ? <MonthlySummary plan={plan} upgradingFrom={liveSub?.plan_snapshot.plan_name ?? null} /> : (
        <section className="card mt-6 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              {plan.display_label && <span className="chip mb-2 bg-accent-500 text-ink">{plan.display_label}</span>}
              <h2 className="text-xl font-extrabold">{plan.name}</h2>
              <p className="mt-1 font-semibold text-brand-700">{classesLabel(plan.class_count)} · {styleAccessLabel(plan.style_access)}</p>
              <p className="mt-1 text-sm text-ink-soft">{validityLabel(plan.validity_days)}</p>
              {expiryPreview && <p className="mt-1 text-sm text-ink-soft">If you buy today, it’s valid until <strong>{expiryPreview}</strong>.</p>}
              <p className="mt-1 text-sm text-ink-soft">One-off payment. No subscription, never renews automatically.</p>
            </div>
          </div>
        </section>
      )}

      {needsPhoto && <div className="mt-4"><Notice tone="warn">{messageFor('profile_photo_required')} <Link className="font-semibold underline" to="/account#photo">Add your photo</Link></Notice></div>}
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
        <div className="mt-3"><MembershipTerms settings={settings} compact monthly={monthly} oneOff={!monthly} /></div>
        {monthly && (
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-brand-50 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={agreedRecurring} onChange={(e) => setAgreedRecurring(e.target.checked)} />
            <span>
              I understand this is a <strong>{plan.commitment_months ?? 3}-month membership paid monthly</strong>: {formatPrice(plan.price_cents, plan.currency)} is
              charged to my card today and then once a month, <strong>{plan.commitment_months ?? 3} payments in total</strong>, after which it stops.
              I can cancel at any time with no penalty, at least 72 hours before a payment.
            </span>
          </label>
        )}
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the <Link to="/terms" target="_blank" className="font-semibold text-brand-700 underline">Terms &amp; Conditions</Link>, understand
            the expiry and cancellation rules above, and ask for my membership to be available straight away.
          </span>
        </label>
      </section>

      <section className="card mt-4 p-5">
        <div className="flex items-center justify-between text-lg">
          <span className="font-semibold">{monthly ? 'To pay today' : 'Total to pay'}</span>
          <span className="font-display text-3xl font-black">{formatPrice(plan.price_cents, plan.currency, { forceDecimals: true })}</span>
        </div>
        <p className="mt-1 text-right text-xs text-muted">
          {monthly
            ? `Then ${formatPrice(plan.price_cents, plan.currency, { forceDecimals: true })} on the ${ordinalDay(new Date())} of every month. Prices in euro (EUR).`
            : 'One-off charge in euro (EUR).'}
        </p>
        {alreadyPaid ? (
          <div className="mt-4 space-y-3">
            <Notice tone="success">{messageFor('earlier_payment_completed')}</Notice>
            <Link to="/account" className="btn-primary w-full">Go to My Membership</Link>
          </div>
        ) : error && <div className="mt-4"><ErrorNotice error={error} /></div>}
        {replaced && (
          <div className="mt-4 space-y-3">
            <Notice tone="info">
              You had an unfinished checkout for <strong>{replaced.plans.join(' and ')}</strong>. Nothing was paid on it, so we’ve
              cancelled it and replaced it with this one. You’ll only be charged once.
            </Notice>
            <a href={replaced.redirect} className="btn-primary w-full text-lg">Continue to payment</a>
          </div>
        )}
        {!replaced && !alreadyPaid && <button className={`${paymentsMode === 'test' ? 'btn-accent' : 'btn-primary'} mt-5 w-full text-lg`} disabled={!canPay} onClick={pay}>
          {busy && <Spinner />}
          {paymentsMode === 'test'
            ? 'Complete TEST purchase'
            : monthly
              ? `Start membership · ${formatPrice(plan.price_cents, plan.currency, { forceDecimals: true })} today`
              : `Pay ${formatPrice(plan.price_cents, plan.currency, { forceDecimals: true })} securely`}
        </button>}
        {paymentsMode === 'live' && <p className="mt-2 text-center text-xs text-muted">You’ll be taken to Square’s secure checkout to pay. Card details never touch our servers.</p>}
      </section>
    </div>
  );
}

/** Everything a monthly member agrees to, before they pay. */
function MonthlySummary({ plan, upgradingFrom }: { plan: MembershipPlan; upgradingFrom: string | null }) {
  const n = plan.commitment_months ?? 3;
  const rows: [string, string][] = [
    ['Monthly price', `${formatPrice(plan.price_cents, plan.currency, { forceDecimals: true })} / month`],
    ['Classes', `${classesLabel(plan.class_count)} every month · ${styleAccessLabel(plan.style_access)}`],
    ['How long', `${termLabel(plan)}. It doesn’t renew automatically after that.`],
    ['Billing', `Monthly, on the ${ordinalDay(new Date())} of each month, to the card you pay with`],
    ['Unused classes', creditRule(plan)],
    ['Cancelling', `Any time, no penalty: in the app, by email (${STUDIO.email}), at reception, or with your bank. Cancel at least 72 hours before a payment to stop it; otherwise that payment is taken and the membership ends after that month.`],
    ['Pausing', 'Pausing your membership moves your next payment back by the paused days.'],
    ['Loyalty reward', `Complete all ${n} months and sign up again to get 3 free classes in your first 7 days.`],
  ];
  return (
    <section className="card mt-6 overflow-hidden" aria-labelledby="summary-h">
      <div className="bg-ink p-5 text-white">
        {plan.display_label && <span className="chip mb-2 bg-brand-500 text-white">{plan.display_label}</span>}
        <h2 id="summary-h" className="font-display text-2xl font-black uppercase tracking-tight">{plan.name}</h2>
        <p className="mt-1 text-white/75">{n}-month membership · paid monthly</p>
      </div>
      {upgradingFrom && (
        <div className="border-b border-line bg-brand-50 px-5 py-3 text-sm text-brand-900">
          <strong>Upgrading from {upgradingFrom}.</strong> Your {upgradingFrom} membership stops today (no more payments for it), and {plan.name} starts now with your first {plan.class_count} classes.
        </div>
      )}
      <dl className="divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[9rem_1fr]">
            <dt className="text-sm font-semibold text-muted">{k}</dt>
            <dd className="text-sm text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
