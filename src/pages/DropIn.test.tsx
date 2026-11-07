// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DropInPrices } from './Memberships';
import type { DanceStyle } from '../api/types';

const style = (name: string, cents: number | null, i: number): DanceStyle => ({
  id: `s${i}`, name, slug: name.toLowerCase(), description: null, color: '#000', is_active: true, sort_order: i, drop_in_price_cents: cents,
});

describe('Drop In prices', () => {
  it('groups styles by price from the database', () => {
    const styles = [
      style('FitDance', 1500, 1), style('Commercial', 1500, 2), style('Hip Hop', 1500, 3), style('Heels', 1700, 4),
      style('Jazz Funk', 1700, 5), style('Reggaeton', 1500, 6), style('Choreography', 1700, 7), style('Private', null, 8),
    ];
    render(<MemoryRouter><DropInPrices styles={styles} /></MemoryRouter>);
    expect(screen.getByText('€15')).toBeInTheDocument();
    expect(screen.getByText('€17')).toBeInTheDocument();
    expect(screen.getByText('FitDance, Commercial, Hip Hop, Reggaeton')).toBeInTheDocument();
    expect(screen.getByText('Heels, Jazz Funk, Choreography')).toBeInTheDocument();
    expect(screen.queryByText(/Private/)).toBeNull();
  });

  it('is hidden when no style is sold as a Drop In', () => {
    const { container } = render(<MemoryRouter><DropInPrices styles={[style('Heels', null, 1)]} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
