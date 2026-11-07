// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClassCard } from './ClassCard';
import type { ClassSession } from '../api/types';

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const session = (over: Partial<ClassSession> = {}): ClassSession => ({
  id: 's', template_id: null, title: 'Heels Beginners', style_id: 'h', instructor_id: null,
  starts_at: inDays(2), ends_at: inDays(2.04), availability: 'available', level: null, room: null,
  is_special: false, ticket_price_cents: null, status: 'scheduled', cancel_reason: null,
  style: { id: 'h', name: 'Heels', color: '#DB2777', slug: 'heels' }, ...over,
});

describe('ClassCard', () => {
  it('never shows how many people are booked or how many spots are left', () => {
    const { container } = render(<ClassCard session={session()} booked={false} onOpen={() => {}} />);
    expect(container.textContent).not.toMatch(/spot|left|\d+\s*\/\s*\d+/i);
  });

  it('says "Almost full" and "Fully booked" instead of numbers', () => {
    const { rerender } = render(<ClassCard session={session({ availability: 'almost_full' })} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('Almost full')).toBeInTheDocument();
    rerender(<ClassCard session={session({ availability: 'full' })} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('Fully booked')).toBeInTheDocument();
  });

  it('marks booked and cancelled classes', () => {
    const { rerender } = render(<ClassCard session={session()} booked onOpen={() => {}} />);
    expect(screen.getByText('Booked')).toBeInTheDocument();
    rerender(<ClassCard session={session({ status: 'cancelled' })} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows the ticket price on workshops', () => {
    render(<ClassCard session={session({ is_special: true, ticket_price_cents: 2500 })} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('€25')).toBeInTheDocument();
  });
});
