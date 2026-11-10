import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../auth/AuthProvider';
import { classesLabel, commitmentTotalCents, durationLabel, isMonthly, pricePerClass, sortPlans, styleAccessLabel, type MembershipPlan } from '../domain/plans';
import { PlanCard } from '../components/PlanCard';
import { MembershipTerms } from '../components/Terms';
import { EmptyState, ErrorNotice, PageSpinner } from '../components/ui';
import type { DanceStyle } from '../api/types';
import { formatPrice } from '../domain/money';

export default function Memberships() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const plans = useAsync(() => api.plans(), []);
  const settings = useAsync(() => api.settings(), []);
  const styles = useAsync(() => api.styles(), []);
  const firstTime = useAsync(async () => (session ? api.isFirstTimeCustomer() : true), [session?.user.id]);

  const all = plans.data ? sortPlans(plans.data) : [];
  const intro = all.filter((p) => p.first_time_only);
  const memberships = all.filter((p) => !p.first_time_only);
  const monthly = memberships.filter(isMonthly);
  const select = (p: MembershipPlan) => navigate(`/checkout/${p.code}`);

  return (
    <div className="container-page py-8 sm:py-12 xl:max-w-7xl">
      <header className="mx-auto max-w-3xl text-center">
        <h1 className="font-display text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">
          Find your rhythm.<br /><span className="text-brand-600">Choose your Drop membership.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-ink-soft">Discover new styles, meet amazing people and make movement part of your routine.</p>
      </header>

      {plans.loading ? <PageSpinner /> : plans.error ? <ErrorNotice error={plans.error} onRetry={plans.reload} /> :
        !all.length ? <div className="mt-8"><EmptyState title="No memberships available right now">Please check back soon.</EmptyState></div> : (
          <>
            {intro.map((p) => (
              <IntroOffer key={p.id} plan={p} disabled={firstTime.data === false} onSelect={select} />
            ))}

            <section className="mt-10" aria-labelledby="memberships-h">
              <h2 id="memberships-h" className="text-center font-display text-2xl font-black uppercase tracking-tight">Memberships</h2>
              {monthly.length > 0 && (
                <p className="mt-1 text-center text-ink-soft">Billed monthly · {monthly[0].commitment_months}-month minimum · renews every {monthly[0].commitment_months} months unless cancelled</p>
              )}
              <div className="mt-8 grid items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {memberships.map((plan) => <PlanCard key={plan.id} plan={plan} onSelect={select} />)}
              </div>
            </section>

            {monthly.length > 0 && <CommitmentTable plans={monthly} />}
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

/** "What you commit to": monthly price and the initial 3-month total. */
function CommitmentTable({ plans }: { plans: MembershipPlan[] }) {
  const months = plans[0].commitment_months ?? 3;
  return (
    <section className="card mx-auto mt-10 max-w-3xl overflow-hidden" aria-labelledby="commitment-h">
      <div className="p-6 pb-3">
        <h2 id="commitment-h" className="text-lg font-extrabold">Your first {months} months at a glance</h2>
        <p className="mt-1 text-sm text-muted">Every membership starts with a {months}-month minimum, billed monthly. It then renews for another {months} months unless you cancel.</p>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
          <tr><th className="px-6 py-2.5">Membership</th><th className="px-3 py-2.5 text-right">Monthly price</th><th className="hidden px-3 py-2.5 text-right sm:table-cell">Classes / month</th><th className="px-6 py-2.5 text-right">Initial {months}-month total</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {plans.map((p) => (
            <tr key={p.id}>
              <td className="px-6 py-3 font-semibold">{p.name}{p.credit_rollover && <span className="chip ml-2 bg-brand-50 text-brand-700">Rollover</span>}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatPrice(p.price_cents, p.currency)}</td>
              <td className="hidden px-3 py-3 text-right tabular-nums sm:table-cell">{p.class_count}</td>
              <td className="px-6 py-3 text-right font-bold tabular-nums">{formatPrice(commitmentTotalCents(p), p.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
