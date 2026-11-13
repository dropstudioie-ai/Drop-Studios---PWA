import { describe, expect, it } from 'vitest';
import { addDays, parseEuro, totals } from './money';

const item = (cents: number, quantity = 1) => ({ id: 'x', description: 'Class', quantity, unitPriceCents: cents });

describe('invoice maths', () => {
  it('VAT included: works out VAT from inside the total', () => {
    expect(totals([item(12300)], 'included', 23)).toEqual({ net: 10000, vat: 2300, gross: 12300 });
  });
  it('VAT added on top', () => {
    expect(totals([item(10000), item(2500, 2)], 'added', 23)).toEqual({ net: 15000, vat: 3450, gross: 18450 });
  });
  it('no VAT', () => {
    expect(totals([item(9999)], 'none', 23)).toEqual({ net: 9999, vat: 0, gross: 9999 });
  });
  it('13.5% rounds to the cent', () => {
    expect(totals([item(10000)], 'included', 13.5)).toEqual({ net: 8811, vat: 1189, gross: 10000 });
  });
  it('parses euro amounts people type', () => {
    expect(parseEuro('€1,250.50')).toBe(125050);
    expect(parseEuro('90')).toBe(9000);
    expect(parseEuro('12,5')).toBe(1250);
    expect(parseEuro('abc')).toBeNull();
  });
  it('due dates', () => { expect(addDays('2026-12-25', 14)).toBe('2027-01-08'); });
});
