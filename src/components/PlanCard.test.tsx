// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanCard } from './PlanCard';
import type { MembershipPlan } from '../domain/plans';

const plan = (over: Partial<MembershipPlan> = {}): MembershipPlan => ({
  id: 'p', code: 'multi-5', name: 'Multi-Style', display_label: null, short_description: 'Love variety?',
  price_cents: 5500, currency: 'EUR', class_count: 5, validity_days: 30, style_access: 'multi', all_styles: true,
  first_time_only: false, is_active: true, is_most_popular: false, sort_order: 30,
  billing_interval: 'monthly', commitment_months: 3, credit_rollover: false, highlight: null, cta_label: 'Choose Multi-Style', ...over,
});

const intro = plan({
  code: 'intro-3', name: '3-Class Intro Offer', display_label: 'Intro Offer', price_cents: 3500, class_count: 3, validity_days: 21,
  first_time_only: true, billing_interval: 'one_off', commitment_months: null, cta_label: 'Start your Drop experience',
});

describe('PlanCard', () => {
  it('monthly plan: price per month, classes per month, price per class and how long it runs', () => {
    const { container } = render(<PlanCard plan={plan({ name: 'Committed', price_cents: 7900, class_count: 8 })} onSelect={() => {}} />);
    expect(screen.getByText('€79')).toBeInTheDocument();
    expect(screen.getByText('/ month')).toBeInTheDocument();
    expect(screen.getByText(/8 classes every month/)).toBeInTheDocument();
    expect(screen.getByText('€9.88 per class')).toBeInTheDocument();
    expect(container.textContent).toContain('3 monthly payments, then it stops');
    expect(container.textContent).toContain('Unused classes expire at the end of each billing month. No rollover.');
    expect(container.textContent).toContain('Cancel any time, no penalty');
    expect(container.textContent).not.toMatch(/€237|in total/);
  });

  it('All In highlights credit rollover and Best value', () => {
    const { container } = render(<PlanCard plan={plan({ name: 'All In', price_cents: 9900, class_count: 12, credit_rollover: true, highlight: 'best_value', display_label: 'Best value' })} onSelect={() => {}} />);
    expect(screen.getByText('Best value')).toBeInTheDocument();
    expect(screen.getByText('Credits roll over')).toBeInTheDocument();
    expect(screen.getByText('€8.25 per class')).toBeInTheDocument();
    expect(container.textContent).toContain('all through your 3 months');
  });

  it('the Intro Offer is a one-off that never renews', () => {
    const { container } = render(<PlanCard plan={intro} onSelect={() => {}} />);
    expect(screen.getByText('one-off')).toBeInTheDocument();
    expect(container.textContent).toContain('No commitment, never renews automatically');
    expect(container.textContent).not.toMatch(/month/i);
    expect(screen.getByRole('button', { name: 'Start your Drop experience' })).toBeInTheDocument();
  });

  it('never says Most Popular unless an admin enabled it', () => {
    render(<PlanCard plan={plan({ highlight: 'recommended', display_label: 'Great for your weekly routine' })} onSelect={() => {}} />);
    expect(screen.queryByText('Most Popular')).toBeNull();
    expect(screen.getByText('Great for your weekly routine')).toBeInTheDocument();
  });

  it('labels the single-style plan clearly', () => {
    render(<PlanCard plan={plan({ code: 'single-4', name: 'Single Style', style_access: 'single', class_count: 4, price_cents: 4900 })} onSelect={() => {}} />);
    expect(screen.getByText('One dance style')).toBeInTheDocument();
    expect(screen.getByText('€12.25 per class')).toBeInTheDocument();
  });

  it('calls onSelect, or explains why the plan is unavailable', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<PlanCard plan={plan()} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose Multi-Style' }));
    expect(onSelect).toHaveBeenCalledOnce();
    rerender(<PlanCard plan={intro} onSelect={onSelect} disabledReason="For first-time customers only." />);
    expect(screen.getByRole('button', { name: 'Not available' })).toBeDisabled();
    expect(screen.getByText('For first-time customers only.')).toBeInTheDocument();
  });
});
