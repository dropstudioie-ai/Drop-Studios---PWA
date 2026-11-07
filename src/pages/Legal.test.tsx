// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_RULES, PrivacyContent, TermsContent } from './Legal';
import { DATA_PROCESSORS } from '../config/studio';

const terms = (over = {}) => render(<MemoryRouter><TermsContent rules={{ ...DEFAULT_RULES, ...over }} /></MemoryRouter>);

describe('Terms & Conditions', () => {
  it('states the booking, cancellation and pause rules the system enforces', () => {
    const { container } = terms();
    const text = container.textContent!;
    expect(text).toContain('up to 3 weeks in advance');
    expect(text).toContain('30 minutes before');
    expect(text).toContain('the class is used and not returned');
    expect(text).toContain('up to 3 months (90 days) per calendar year');
    expect(text).toContain('at least 7 days');
    expect(text).toContain('activated when your payment is confirmed');
    expect(text).toContain('14 days');
    expect(text).toContain('Drop In');
    expect(text).toContain('photo of yourself');
  });

  it('follows the studio settings when they change', () => {
    const { container } = terms({ cancellation_cutoff_minutes: 120, late_cancel_restores_class: true, activation_policy: 'on_first_booking' });
    const text = container.textContent!;
    expect(text).toContain('2 hours before');
    expect(text).toContain('the class is still returned');
    expect(text).toContain('activated when you make your first booking');
  });
});

describe('Privacy Policy', () => {
  it('names every data processor and the Irish regulator', () => {
    render(<MemoryRouter><PrivacyContent /></MemoryRouter>);
    for (const p of DATA_PROCESSORS) expect(screen.getByText(p.name)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'dataprotection.ie' })).toHaveAttribute('href', 'https://www.dataprotection.ie');
    expect(screen.getByText('Profile photo:')).toBeInTheDocument();
  });

  it('matches reality: the app loads nothing from Google Fonts or trackers', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css|html)$/.test(f) && !f.endsWith('.test.tsx')) files.push(p);
      }
    };
    walk(join(import.meta.dirname, '..'));
    files.push(join(import.meta.dirname, '../../index.html'));
    const offenders = files.filter((f) => /fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics|facebook\.net/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
