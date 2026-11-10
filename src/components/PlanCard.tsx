import type { MembershipPlan } from '../domain/plans';
import { classesLabel, creditRule, durationLabel, isMonthly, planBadges, pricePerClass, styleAccessLabel, termLabel } from '../domain/plans';
import { formatPrice } from '../domain/money';
import { CheckIcon, ClockIcon, LayersIcon, TargetIcon } from './icons';

interface Props {
  plan: MembershipPlan;
  onSelect: (plan: MembershipPlan) => void;
  disabledReason?: string | null;
}

/**
 * A membership on the pricing page. Monthly plans lead with "€79 / month" and
 * the classes per month, then the commitment, total and what happens to unused
 * classes, so nothing important is left for the checkout to reveal.
 */
export function PlanCard({ plan, onSelect, disabledReason }: Props) {
  const monthly = isMonthly(plan);
  const isIntro = plan.first_time_only;
  const bestValue = plan.highlight === 'best_value';
  const recommended = plan.highlight === 'recommended';
  const badges = planBadges(plan);
  const dark = bestValue;

  const frame = bestValue
    ? 'bg-ink text-white shadow-xl ring-2 ring-brand-500'
    : recommended
      ? 'bg-white shadow-xl ring-2 ring-brand-600 lg:-translate-y-2'
      : isIntro
        ? 'bg-white ring-2 ring-accent-400'
        : 'bg-white';
  const soft = dark ? 'text-white/75' : 'text-ink-soft';
  const faint = dark ? 'text-white/60' : 'text-muted';

  return (
    <article className={`card relative flex flex-col border-0 p-6 ${frame}`} aria-labelledby={`plan-${plan.code}`}>
      {badges.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span key={b} className={`chip uppercase tracking-wide ${
              isIntro ? 'bg-accent-500 text-ink' : bestValue ? 'bg-brand-500 text-white' : recommended ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}>{b}</span>
          ))}
        </div>
      )}

      <h3 id={`plan-${plan.code}`} className={`font-display text-xl font-black uppercase tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>{plan.name}</h3>
      {plan.short_description && <p className={`mt-1 text-sm ${soft}`}>{plan.short_description}</p>}

      <div className="mt-5">
        <p className="flex items-baseline gap-1">
          <span className={`font-display text-5xl font-black ${dark ? 'text-white' : 'text-ink'}`}>{formatPrice(plan.price_cents, plan.currency)}</span>
          <span className={`text-base font-semibold ${faint}`}>{monthly ? '/ month' : 'one-off'}</span>
        </p>
        <p className={`mt-1 font-display text-lg font-extrabold ${dark ? 'text-brand-200' : isIntro ? 'text-accent-600' : 'text-brand-600'}`}>
          {classesLabel(plan.class_count)}{monthly ? ' every month' : ''}
        </p>
        <p className={`text-sm font-semibold ${faint}`}>{pricePerClass(plan)} per class</p>
      </div>

      {bestValue && plan.credit_rollover && (
        <div className="mt-4 rounded-xl bg-brand-600 p-3 text-sm">
          <p className="font-extrabold uppercase tracking-wide">Credits roll over</p>
          <p className="mt-0.5 text-white/85">Unused classes carry into next month, all through your {plan.commitment_months ?? 3} months.</p>
        </div>
      )}

      <ul className={`mt-5 space-y-2.5 text-sm ${soft}`}>
        <li className="flex gap-2">
          {plan.style_access === 'single'
            ? <TargetIcon className={`mt-0.5 shrink-0 ${dark ? 'text-brand-200' : 'text-accent-600'}`} width={18} height={18} />
            : <LayersIcon className={`mt-0.5 shrink-0 ${dark ? 'text-brand-200' : 'text-brand-600'}`} width={18} height={18} />}
          <span className={`font-semibold ${dark ? 'text-white' : 'text-ink'}`}>{styleAccessLabel(plan.style_access)}</span>
        </li>
        {monthly ? (
          <>
            <li className="flex gap-2">
              <ClockIcon className={`mt-0.5 shrink-0 ${faint}`} width={18} height={18} />
              <span><strong className={dark ? 'text-white' : 'text-ink'}>{termLabel(plan)}</strong></span>
            </li>
            <li className="flex gap-2">
              <CheckIcon className={`mt-0.5 shrink-0 ${dark ? 'text-brand-200' : 'text-success'}`} width={18} height={18} />
              <span>{creditRule(plan)}</span>
            </li>
          </>
        ) : (
          <>
            <li className="flex gap-2">
              <ClockIcon className={`mt-0.5 shrink-0 ${faint}`} width={18} height={18} />
              <span>Valid for {durationLabel(plan.validity_days)} after activation</span>
            </li>
            <li className="flex gap-2">
              <CheckIcon className="mt-0.5 shrink-0 text-success" width={18} height={18} />
              <span>{isIntro ? 'New customers only · ' : ''}No commitment, never renews automatically</span>
            </li>
          </>
        )}
      </ul>

      <div className="mt-auto pt-6">
        <button
          className={`${isIntro ? 'btn-accent' : 'btn-primary'} w-full px-3 uppercase tracking-wide ${bestValue ? 'bg-brand-500 hover:bg-brand-400' : ''}`}
          onClick={() => onSelect(plan)}
          disabled={Boolean(disabledReason)}
          aria-describedby={disabledReason ? `plan-${plan.code}-why` : undefined}
        >
          {disabledReason ? 'Not available' : plan.cta_label ?? `Choose ${classesLabel(plan.class_count)}`}
        </button>
        {disabledReason && <p id={`plan-${plan.code}-why`} className={`mt-2 text-center text-xs ${faint}`}>{disabledReason}</p>}
        {monthly && !disabledReason && <p className={`mt-2 text-center text-xs ${faint}`}>Cancel any time, no penalty</p>}
      </div>
    </article>
  );
}
