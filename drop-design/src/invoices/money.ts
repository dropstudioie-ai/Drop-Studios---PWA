import type { Invoice, InvoiceItem, VatMode } from './types';

export const eur = (cents: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100);

/** Parse "1,250.50", "€90", "90" → cents. Returns null if it isn't a number. */
export function parseEuro(input: string): number | null {
  const clean = input.replace(/[€\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export interface Totals { net: number; vat: number; gross: number }

/** Line totals are summed first, then VAT is worked out once on the total (rounded to the cent). */
export function totals(items: InvoiceItem[], mode: VatMode, ratePct: number): Totals {
  const sum = items.reduce((n, i) => n + Math.round(i.quantity * i.unitPriceCents), 0);
  const r = ratePct / 100;
  if (mode === 'none' || r === 0) return { net: sum, vat: 0, gross: sum };
  if (mode === 'included') {
    const net = Math.round(sum / (1 + r));
    return { net, vat: sum - net, gross: sum };
  }
  const vat = Math.round(sum * r);
  return { net: sum, vat, gross: sum + vat };
}

export const invoiceTotals = (i: Pick<Invoice, 'items' | 'vatMode' | 'vatRate'>) => totals(i.items, i.vatMode, i.vatRate);

export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso: string, days: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + days); return isoDate(d); };
export const longDate = (iso: string) => new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${iso}T12:00:00`));

export function isOverdue(i: Invoice, today = isoDate(new Date())) {
  return (i.status === 'approved' || i.status === 'sent') && i.dueDate < today;
}
