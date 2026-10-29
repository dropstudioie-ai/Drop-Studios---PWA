// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanCard } from './PlanCard';
import type { MembershipPlan } from '../domain/plans';

const plan = (over: Partial<MembershipPlan> = {}): MembershipPlan => ({
  id: 'p', code: 'multi-5', name: '5-Class Multi-Style', display_label: null, short_description: null,
  price_cents: 5500, currency: 'EUR', class_count: 5, validity_days: 28, style_access: 'multi', all_styles: true,
  first_time_only: false, is_active: true, is_most_popular: false, sort_order: 30, ...over,
});

describe('PlanCard', () => {
  it('shows price, classes, access and validity at a glance', () => {
    render(<PlanCard plan={plan()} onSelect={() => {}} />);
    expect(screen.getByText('€55')).toBeInTheDocument();
    expect(screen.getByText('5 classes')).toBeInTheDocument();
    expect(screen.getByText('Multiple dance styles')).toBeInTheDocument();
    expect(screen.getByText('Valid for 4 weeks after activation.')).toBeInTheDocument();
    expect(screen.queryByText(/credit/i)).toBeNull();
  });

  it('shows no badges unless configured', () => {
    render(<PlanCard plan={plan({ price_cents: 9900, class_count: 12 })} onSelect={() => {}} />);
    expect(screen.queryByText('Most Popular')).toBeNull();
    expect(screen.queryByText(/best value/i)).toBeNull();
  });

  it('shows the intro label and admin-enabled popularity badge', () => {
    render(<PlanCard plan={plan({ display_label: 'Intro Offer', is_most_popular: true })} onSelect={() => {}} />);
    expect(screen.getByText('Intro Offer')).toBeInTheDocument();
    expect(screen.getByText('Most Popular')).toBeInTheDocument();
  });

  it('labels the single-style plan clearly', () => {
    render(<PlanCard plan={plan({ code: 'single-4', style_access: 'single', class_count: 4, price_cents: 4900 })} onSelect={() => {}} />);
    expect(screen.getByText('One dance style')).toBeInTheDocument();
    expect(screen.getByText('€49')).toBeInTheDocument();
  });

  it('calls onSelect, or explains why it is unavailable', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<PlanCard plan={plan()} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose 5 classes' }));
    expect(onSelect).toHaveBeenCalledOnce();

    rerender(<PlanCard plan={plan({ first_time_only: true })} onSelect={onSelect} disabledReason="For first-time customers only." />);
    expect(screen.getByRole('button', { name: 'Not available' })).toBeDisabled();
    expect(screen.getByText('For first-time customers only.')).toBeInTheDocument();
  });
});
