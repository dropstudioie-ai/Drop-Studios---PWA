// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClassCard } from './ClassCard';
import type { ClassSession } from '../api/types';

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const session = (over: Partial<ClassSession> = {}): ClassSession => ({
  id: 's', template_id: null, title: 'Heels Beginners', style_id: 'h', instructor_id: null,
  starts_at: inDays(2), ends_at: inDays(2.04), capacity: 20, booked_count: 5, level: null, room: null,
  is_special: false, ticket_price_cents: null, status: 'scheduled', cancel_reason: null,
  style: { id: 'h', name: 'Heels', color: '#DB2777', slug: 'heels' }, ...over,
});

describe('ClassCard', () => {
  it('shows spots left for an open class', () => {
    render(<ClassCard session={session()} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('15 spots left')).toBeInTheDocument();
  });

  it('marks booked, full, nearly full and cancelled classes', () => {
    const { rerender } = render(<ClassCard session={session()} booked onOpen={() => {}} />);
    expect(screen.getByText('Booked')).toBeInTheDocument();
    rerender(<ClassCard session={session({ booked_count: 20 })} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('Full')).toBeInTheDocument();
    rerender(<ClassCard session={session({ booked_count: 18 })} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('2 left')).toBeInTheDocument();
    rerender(<ClassCard session={session({ status: 'cancelled' })} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows the ticket price on workshops', () => {
    render(<ClassCard session={session({ is_special: true, ticket_price_cents: 2500 })} booked={false} onOpen={() => {}} />);
    expect(screen.getByText('€25')).toBeInTheDocument();
  });
});
