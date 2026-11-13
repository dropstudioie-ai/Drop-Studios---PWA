import { jsPDF } from 'jspdf';
import type { BusinessProfile, Invoice } from './types';
import { eur, invoiceTotals, longDate } from './money';

/** A real text PDF (selectable, small, prints crisply). */
export function invoicePdf(inv: Invoice, me: BusinessProfile, logo?: { data: string; w: number; h: number } | null): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const L = 18, R = 192;
  let y = 20;
  if (logo) { const h = 16, w = Math.min(50, (logo.w / logo.h) * h); doc.addImage(logo.data, 'PNG', L, y - 4, w, h); y += 16; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(me.name || 'Your business', L, y);
  doc.setFontSize(26); doc.text('INVOICE', R, logo ? 22 : 20, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(80);
  const meLines = [...me.address.split('\n'), me.email, me.phone, me.vatNumber ? `VAT no. ${me.vatNumber}` : '', me.companyNumber ? `Company no. ${me.companyNumber}` : ''].filter(Boolean);
  meLines.forEach((l, i) => doc.text(l, L, y + 6 + i * 4.5));
  const meta: [string, string][] = [['Invoice no.', inv.number || 'DRAFT'], ['Date', longDate(inv.issueDate)], ['Due', longDate(inv.dueDate)]];
  meta.forEach(([k, v], i) => { doc.setTextColor(120); doc.text(k, 140, (logo ? 32 : 30) + i * 5.5); doc.setTextColor(20); doc.text(v, R, (logo ? 32 : 30) + i * 5.5, { align: 'right' }); });
  y = Math.max(y + 8 + meLines.length * 4.5, 62);
  doc.setTextColor(120); doc.setFontSize(8.5); doc.text('BILL TO', L, y);
  doc.setTextColor(20); doc.setFontSize(10.5); doc.setFont('helvetica', 'bold'); doc.text(inv.client.name, L, y + 5.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  const cl = [...inv.client.address.split('\n'), inv.client.email, inv.client.vatNumber ? `VAT no. ${inv.client.vatNumber}` : ''].filter(Boolean);
  cl.forEach((l, i) => doc.text(l, L, y + 10.5 + i * 4.5));
  y += 16 + cl.length * 4.5;

  // Lines
  doc.setFillColor(242, 242, 244); doc.rect(L, y, R - L, 8, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Description', L + 2, y + 5.3); doc.text('Qty', 130, y + 5.3, { align: 'right' }); doc.text('Unit price', 160, y + 5.3, { align: 'right' }); doc.text('Amount', R - 2, y + 5.3, { align: 'right' });
  doc.setFont('helvetica', 'normal'); y += 13;
  for (const it of inv.items) {
    const lines = doc.splitTextToSize(it.description, 100) as string[];
    doc.text(lines, L + 2, y);
    doc.text(String(it.quantity), 130, y, { align: 'right' });
    doc.text(eur(it.unitPriceCents), 160, y, { align: 'right' });
    doc.text(eur(Math.round(it.quantity * it.unitPriceCents)), R - 2, y, { align: 'right' });
    y += Math.max(1, lines.length) * 4.5 + 3;
    doc.setDrawColor(230); doc.line(L, y - 2, R, y - 2);
  }
  const tt = invoiceTotals(inv);
  y += 4;
  const row = (k: string, v: string, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 12 : 9.5); doc.text(k, 160, y, { align: 'right' }); doc.text(v, R - 2, y, { align: 'right' }); y += bold ? 8 : 5.5; };
  if (inv.vatMode !== 'none' && inv.vatRate > 0) {
    row('Subtotal (excl. VAT)', eur(tt.net));
    row(`VAT @ ${inv.vatRate}%`, eur(tt.vat));
  } else if (inv.vatMode === 'none') { doc.setFontSize(8.5); doc.setTextColor(120); doc.text(me.vatNumber ? 'VAT not charged' : 'Not registered for VAT', 160, y, { align: 'right' }); doc.setTextColor(20); y += 5.5; }
  row('Total due', eur(tt.gross), true);

  // Payment details
  y += 6;
  doc.setFillColor(248, 248, 250); doc.rect(L, y, R - L, 30, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text('Payment details', L + 4, y + 7);
  doc.setFont('helvetica', 'normal');
  [['Account name', inv.bank.accountName], ['Bank', inv.bank.bankName], ['IBAN', inv.bank.iban], ['BIC', inv.bank.bic]].filter(([, v]) => v).forEach(([k, v], i) => {
    doc.setTextColor(120); doc.text(k, L + 4, y + 13 + i * 4.5); doc.setTextColor(20); doc.text(v, L + 34, y + 13 + i * 4.5);
  });
  doc.setTextColor(120); doc.text(`Please use reference ${inv.number || 'on this invoice'}`, R - 4, y + 13, { align: 'right' });
  y += 38;
  doc.setTextColor(60);
  if (inv.notes) { doc.text(doc.splitTextToSize(inv.notes, R - L) as string[], L, y); y += 10; }
  if (me.footer) { doc.setFontSize(8.5); doc.setTextColor(140); doc.text(me.footer, 105, 285, { align: 'center' }); }
  doc.setProperties({ title: `Invoice ${inv.number}`, creator: 'Drop Design' });
  return doc.output('blob');
}
