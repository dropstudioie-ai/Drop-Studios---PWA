export interface BusinessProfile {
  id: 'me';
  name: string;
  address: string;
  email: string;
  phone: string;
  vatNumber: string; // empty = not VAT registered
  companyNumber: string; // CRO number
  invoicePrefix: string;
  nextNumber: number;
  defaultDueDays: number;
  defaultVatRate: number;
  footer: string;
}

export interface Client { id: string; name: string; email: string; address: string; vatNumber?: string; createdAt: number }

export interface BankAccount { id: string; label: string; accountName: string; bankName: string; iban: string; bic: string; isDefault?: boolean }

export interface InvoiceItem { id: string; description: string; quantity: number; unitPriceCents: number }

/** included: prices already contain VAT · added: VAT goes on top · none: no VAT charged. */
export type VatMode = 'included' | 'added' | 'none';
export type InvoiceStatus = 'draft' | 'approved' | 'sent' | 'paid' | 'cancelled';

export interface Invoice {
  id: string;
  number: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string;
  clientId: string;
  client: Client; // snapshot at the time of the invoice
  items: InvoiceItem[];
  vatMode: VatMode;
  vatRate: number; // percent, e.g. 23
  bank: BankAccount; // snapshot
  status: InvoiceStatus;
  notes: string;
  sentAt?: number | null;
  sentTo?: string | null;
  paidAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export const IRISH_VAT_RATES = [23, 13.5, 9, 0];
