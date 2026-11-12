import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../auth/AuthProvider';
import { classesLabel, durationLabel, isMonthly, pricePerClass, sortPlans, styleAccessLabel, type MembershipPlan } from '../domain/plans';
import { PlanCard } from '../components/PlanCard';
import { MembershipTerms } from '../components/Terms';
import { isLive } from '../domain/subscription';
import { EmptyState, ErrorNotice, PageSpinner } from '../components/ui';
import type { DanceStyle } from '../api/types';
import { formatPrice } from '../domain/money';
import { StudioPhoto } from '../components/StudioPhoto';

export default function Memberships() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const plans = useAsync(() => api.plans(), []);
  const settings = useAsync(() => api.settings(), []);
  const styles = useAsync(() => api.styles(), []);
  const firstTime = useAsync(async () => (session ? api.isFirstTimeCustomer() : true), [session?.user.id]);
  // A member with a monthly membership can only move up (upgrade).
  const current = useAsync(async () => (session ? (await api.mySubscriptions(session.user.id)).find(isLive) ?? null : null), [session?.user.id]);
  const live = current.data ?? null;

  const all = plans.data ? sortPlans(plans.data) : [];
  const intro = all.filter((p) => p.first_time_only);
  const memberships = all.filter((p) => !p.first_time_only);
  const monthly = memberships.filter(isMonthly);
  const select = (p: MembershipPlan) => navigate(`/checkout/${p.code}`);

  return (
    <div className="container-page py-8 sm:py-12 xl:max-w-7xl">
      <StudioPhoto index={5} className="mb-8 aspect-[16/7] sm:aspect-[16/5] lg:aspect-[16/4]" />
      <header className="mx-auto max-w-3xl text-center">
        <h1 className="font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
          Find your rhythm.<br /><span className="text-brand-600">Choose your Drop membership.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">Discover new styles, meet amazing people and make movement part of your routine.</p>
      </header>

      {plans.loading ? <PageSpinner /> : plans.error ? <ErrorNotice error={plans.error} onRetry={plans.reload} /> :
        !all.length ? <div className="mt-8"><EmptyState title="No memberships available right now">Please check back soon.</EmptyState></div> : (
          <>
            {!live && intro.map((p) => (
              <IntroOffer key={p.id} plan={p} disabled={firstTime.data === false} onSelect={select} />
            ))}

            {live && (
              <div className="mx-auto mt-8 max-w-3xl rounded-2xl bg-brand-50 p-4 text-center text-brand-900">
                You’re on <strong>{live.plan_snapshot.plan_name}</strong>. Used this month’s classes? <strong>Upgrade</strong> to a bigger plan below:
                your current membership stops and the new one starts today.
              </div>
            )}

            <section className="mt-10" aria-labelledby="memberships-h">
              <h2 id="memberships-h" className="text-center font-display text-2xl font-black uppercase tracking-tight">Memberships</h2>
              {monthly.length > 0 && (
                <p className="mx-auto mt-1 max-w-2xl text-center text-ink-soft">
                  A {monthly[0].commitment_months ?? 3}-month membership, paid monthly: your classes renew every month for {monthly[0].commitment_months ?? 3} months, then it stops.
                  Cancel any time with no penalty, in the app, by email or at reception.
                </p>
              )}
              <div className="mt-8 grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {memberships.map((plan) => (
                  <PlanCard key={plan.id} plan={plan} onSelect={select}
                    disabledReason={live && isMonthly(plan) && plan.price_cents <= live.plan_snapshot.price_cents
                      ? (plan.name === live.plan_snapshot.plan_name ? 'Your current membership.' : 'Not an upgrade on your current membership.')
                      : null} />
                ))}
              </div>
            </section>

          </>
        )}

      {styles.data && <DropInPrices styles={styles.data} />}

      {settings.data && (
        <section className="card mx-auto mt-10 max-w-3xl p-6" aria-labelledby="good-to-know">
          <h2 id="good-to-know" className="text-lg font-extrabold">Good to know</h2>
          <div className="mt-3"><MembershipTerms settings={settings.data} monthly={monthly.length > 0} /></div>
          <p className="mt-4 text-sm text-muted">You can cancel a purchase within 14 days of buying it. See the full <Link to="/terms" className="font-semibold text-brand-700 underline">Terms &amp; Conditions</Link>.</p>
        </section>
      )}
    </div>
  );
}

/** The Intro Offer: a wide orange strip above the memberships. */
function IntroOffer({ plan, disabled, onSelect }: { plan: MembershipPlan; disabled: boolean; onSelect: (p: MembershipPlan) => void }) {
  return (
    <section className="mt-10 overflow-hidden rounded-3xl bg-accent-50 ring-2 ring-accent-400" aria-labelledby={`plan-${plan.code}`}>
      <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <span className="chip bg-accent-500 uppercase tracking-wide text-ink">{plan.display_label ?? 'Intro offer'}</span>
          <h2 id={`plan-${plan.code}`} className="mt-3 font-display text-2xl font-black uppercase tracking-tight sm:text-3xl">{plan.name}</h2>
          {plan.short_description && <p className="mt-2 max-w-xl text-ink-soft">{plan.short_description}</p>}
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm font-semibold text-ink">
            <li>{classesLabel(plan.class_count)}</li>
            <li>{styleAccessLabel(plan.style_access)}</li>
            <li>Valid {durationLabel(plan.validity_days)} after activation</li>
            <li>One-off payment · never renews</li>
          </ul>
        </div>
        <div className="md:text-right">
          <p className="font-display text-5xl font-black">{formatPrice(plan.price_cents, plan.currency)}</p>
          <p className="text-sm text-muted">one-off · {pricePerClass(plan)} per class</p>
          <button className="btn-accent mt-4 w-full uppercase tracking-wide md:w-auto" disabled={disabled} onClick={() => onSelect(plan)}>
            {disabled ? 'For first-time customers only' : plan.cta_label ?? 'Get the intro offer'}
          </button>
        </div>
      </div>
    </section>
  );
}

/** "Drop In": single-class prices, grouped by price from the styles' data. */
export function DropInPrices({ styles }: { styles: DanceStyle[] }) {
  const groups = new Map<number, string[]>();
  for (const s of styles) {
    if (s.drop_in_price_cents == null) continue;
    groups.set(s.drop_in_price_cents, [...(groups.get(s.drop_in_price_cents) ?? []), s.name]);
  }
  if (groups.size === 0) return null;
  return (
    <section className="card mx-auto mt-8 max-w-3xl p-6" aria-labelledby="drop-in-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="drop-in-h" className="text-lg font-extrabold">Drop In</h2>
        <p className="text-sm text-muted">Book a single class, no membership needed.</p>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {[...groups.entries()].sort((a, b) => a[0] - b[0]).map(([price, names]) => (
          <li key={price} className="flex items-center justify-between gap-4 py-3">
            <span className="text-ink-soft">{names.join(', ')}</span>
            <span className="shrink-0 font-display text-2xl font-black text-ink">{formatPrice(price)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">Pick any class in the <Link to="/timetable" className="font-semibold text-brand-700 underline">timetable</Link> and choose “Book Drop In”.</p>
    </section>
  );
}
