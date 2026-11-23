import { jsPDF } from 'npm:jspdf@2.5.2';
import { buildInvoicePdf, invoiceFileName, type RentalInvoice } from '../_shared/invoicePdf.ts';
import type { Claimed } from './render.ts';

/** The studio hire invoice as a Resend attachment, for "Studio booked" emails that carry one. */
export async function invoiceAttachment(n: Pick<Claimed, 'kind' | 'payload'>) {
  const inv = (n.payload as { invoice?: RentalInvoice | null }).invoice;
  if (n.kind !== 'rental_confirmed' || !inv || !Array.isArray(inv.lines)) return null;
  // deno-lint-ignore no-explicit-any
  const doc = buildInvoicePdf(jsPDF as any, inv);
  const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return [{ filename: invoiceFileName(inv), content: btoa(bin) }];
}
