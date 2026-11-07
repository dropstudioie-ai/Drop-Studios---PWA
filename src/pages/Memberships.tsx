import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../auth/AuthProvider';
import { sortPlans } from '../domain/plans';
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

  return (
    <div className="container-page py-8 sm:py-12 xl:max-w-7xl">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-black sm:text-5xl">Choose Your Monthly Membership</h1>
        <p className="mt-3 text-lg text-ink-soft">Find your rhythm. Choose your classes.</p>
      </header>

      <section className="mt-8" aria-label="Membership plans">
        {plans.loading ? <PageSpinner /> : plans.error ? <ErrorNotice error={plans.error} onRetry={plans.reload} /> :
          !plans.data?.length ? <EmptyState title="No memberships available right now">Please check back soon.</EmptyState> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {sortPlans(plans.data).map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  disabledReason={plan.first_time_only && firstTime.data === false ? 'For first-time customers only.' : null}
                  onSelect={(p) => navigate(`/checkout/${p.code}`)}
                />
              ))}
            </div>
          )}
      </section>

      {styles.data && <DropInPrices styles={styles.data} />}

      {settings.data && (
        <section className="card mx-auto mt-10 max-w-3xl p-6" aria-labelledby="good-to-know">
          <h2 id="good-to-know" className="text-lg font-extrabold">Good to know</h2>
          <div className="mt-3"><MembershipTerms settings={settings.data} /></div>
          <p className="mt-4 text-sm text-muted">You can cancel a membership within 14 days of buying it. See the full <Link to="/terms" className="font-semibold text-brand-700 underline">Terms &amp; Conditions</Link>.</p>
        </section>
      )}
    </div>
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
