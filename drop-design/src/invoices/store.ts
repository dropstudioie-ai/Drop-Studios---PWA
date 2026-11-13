import { db, settings } from '../storage/db';
import type { BankAccount, BusinessProfile, Client, Invoice } from './types';
import { uid } from '../model/elements';

export const DEFAULT_BUSINESS: BusinessProfile = {
  id: 'me', name: 'Drop Studios Limited', address: '13 Sackville Place\nDublin 1\nIreland', email: '', phone: '',
  vatNumber: '', companyNumber: '', invoicePrefix: 'DS', nextNumber: 1, defaultDueDays: 14, defaultVatRate: 23,
  footer: 'Thank you for your business.',
};

export const business = {
  get: async (): Promise<BusinessProfile> => (await (await db()).get('business', 'me')) ?? DEFAULT_BUSINESS,
  save: async (b: BusinessProfile) => { await (await db()).put('business', b); },
};
export const clients = {
  list: async () => (await (await db()).getAll('clients')).sort((a, b) => a.name.localeCompare(b.name)),
  save: async (c: Client) => { await (await db()).put('clients', c); },
  remove: async (id: string) => { await (await db()).delete('clients', id); },
  create: (p: Omit<Client, 'id' | 'createdAt'>): Client => ({ ...p, id: uid(), createdAt: Date.now() }),
};
export const banks = {
  list: async () => await (await db()).getAll('bankAccounts'),
  save: async (b: BankAccount) => {
    const d = await db();
    if (b.isDefault) for (const o of await d.getAll('bankAccounts')) if (o.id !== b.id && o.isDefault) await d.put('bankAccounts', { ...o, isDefault: false });
    await d.put('bankAccounts', b);
  },
  remove: async (id: string) => { await (await db()).delete('bankAccounts', id); },
};
export const invoices = {
  list: async () => (await (await db()).getAll('invoices')).sort((a, b) => (b.issueDate.localeCompare(a.issueDate)) || b.createdAt - a.createdAt),
  get: async (id: string) => (await db()).get('invoices', id),
  save: async (i: Invoice) => { await (await db()).put('invoices', { ...i, updatedAt: Date.now() }); },
  remove: async (id: string) => { await (await db()).delete('invoices', id); },
};

export const formatNumber = (prefix: string, year: number, n: number) => `${prefix}-${year}-${String(n).padStart(3, '0')}`;

/** Give an invoice its permanent number when it's approved (numbers are sequential and never reused). */
export async function approveInvoice(inv: Invoice): Promise<Invoice> {
  const b = await business.get();
  const year = Number(inv.issueDate.slice(0, 4));
  const all = await invoices.list();
  let n = b.nextNumber;
  const used = new Set(all.map((x) => x.number));
  while (used.has(formatNumber(b.invoicePrefix, year, n))) n++;
  const out: Invoice = { ...inv, number: inv.number || formatNumber(b.invoicePrefix, year, n), status: 'approved' };
  if (!inv.number) await business.save({ ...b, nextNumber: n + 1 });
  await invoices.save(out);
  return out;
}

export const googleClientId = {
  get: () => settings.get<string>('googleClientId', ''),
  set: (v: string) => settings.set('googleClientId', v.trim()),
};
