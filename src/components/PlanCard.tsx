import type { MembershipPlan } from '../domain/plans';
import { classesLabel, planBadges, pricePerClass, styleAccessLabel, validityLabel } from '../domain/plans';
import { formatPrice } from '../domain/money';
import { ClockIcon, LayersIcon, TargetIcon } from './icons';

interface Props {
  plan: MembershipPlan;
  onSelect: (plan: MembershipPlan) => void;
  disabledReason?: string | null;
}

export function PlanCard({ plan, onSelect, disabledReason }: Props) {
  const badges = planBadges(plan);
  const isIntro = plan.first_time_only;
  return (
    <article
      className={`card relative flex flex-col p-5 ${isIntro ? 'border-accent-400 ring-1 ring-accent-400' : ''}`}
      aria-labelledby={`plan-${plan.code}`}
    >
      {badges.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span key={b} className={`chip ${b === 'Most Popular' ? 'bg-brand-600 text-white' : 'bg-accent-500 text-ink'}`}>{b}</span>
          ))}
        </div>
      )}
      <h3 id={`plan-${plan.code}`} className="text-base font-bold text-ink-soft">{plan.name}</h3>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-display text-4xl font-black text-ink">{formatPrice(plan.price_cents, plan.currency)}</p>
        <p className="whitespace-nowrap font-display text-xl font-extrabold text-brand-600">{classesLabel(plan.class_count)}</p>
      </div>

      <ul className="mt-4 space-y-2 text-sm text-ink-soft">
        <li className="flex items-center gap-2">
          {plan.style_access === 'single'
            ? <TargetIcon className="shrink-0 text-accent-600" width={18} height={18} />
            : <LayersIcon className="shrink-0 text-brand-600" width={18} height={18} />}
          <span className="font-semibold text-ink">{styleAccessLabel(plan.style_access)}</span>
        </li>
        <li className="flex items-center gap-2">
          <ClockIcon className="shrink-0 text-muted" width={18} height={18} />
          <span>{validityLabel(plan.validity_days)}</span>
        </li>
      </ul>
      <p className="mt-2 text-xs text-muted">{pricePerClass(plan)} per class</p>

      <div className="mt-auto pt-5">
        <button
          className={`${isIntro ? 'btn-accent' : 'btn-primary'} w-full whitespace-nowrap px-3`}
          onClick={() => onSelect(plan)}
          disabled={Boolean(disabledReason)}
          aria-describedby={disabledReason ? `plan-${plan.code}-why` : undefined}
        >
          {disabledReason ? 'Not available' : `Choose ${classesLabel(plan.class_count)}`}
        </button>
        {disabledReason && <p id={`plan-${plan.code}-why`} className="mt-2 text-center text-xs text-muted">{disabledReason}</p>}
      </div>
    </article>
  );
}
