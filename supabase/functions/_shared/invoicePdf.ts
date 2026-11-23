// Studio hire invoice as a PDF. Shared by the app (download) and the send-notifications function (email attachment),
// so pass in the jsPDF class from whichever runtime you're in.
// No imports on purpose: this file is used by both the app (Vite) and the Deno function.
export const DROP_LOGO_PNG = 'data:image/png;base64,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';
export const DROP_LOGO_RATIO = 0.2360;

export interface InvoiceLine {
  starts_at: string; ends_at: string; is_party: boolean; status: string; hours: number;
  rent_cents: number; cleaning_cents: number; dj_minutes: number; dj_cents: number; marketing_weeks: number; marketing_cents: number; total_cents: number;
}
export interface RentalInvoice {
  invoice_no: string; paid_at: string; method: string; status: string;
  billed_name: string | null; billed_email: string | null; billed_phone: string | null;
  company: string | null; address: string | null; tax_number: string | null;
  total_cents: number; refund_cents: number; lines: InvoiceLine[];
}
export const STUDIO_LINES = ['Drop Studios', '13 Sackville Place, Dublin 1, D01', 'dropstudioie@gmail.com', 'www.dropstudios.ie'];

const TZ = 'Europe/Dublin';
const eur = (c: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(c / 100);
const day = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const slot = (a: string, b: string) => {
  const d = new Intl.DateTimeFormat('en-IE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(a));
  const t = (x: string) => new Intl.DateTimeFormat('en-IE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(x));
  return `${d}, ${t(a)}–${t(b)}`;
};
const hrs = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;

// deno-lint-ignore no-explicit-any
type PdfCtor = new (o: { unit: string; format: string }) => any;

/** Builds the invoice and returns the jsPDF document (call .save() in the browser or .output('arraybuffer') on the server). */
export function buildInvoicePdf(JsPDF: PdfCtor, inv: RentalInvoice) {
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const ink = [11, 11, 13], soft = [113, 113, 122], orange = [255, 122, 0], green = [15, 138, 75];
  const refunded = inv.status === 'refunded';
  doc.addImage(DROP_LOGO_PNG, 'PNG', 20, 18, 46, 46 * DROP_LOGO_RATIO);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...ink);
  doc.text('INVOICE', 190, 25, { align: 'right' });
  doc.setFontSize(11); doc.setTextColor(...(refunded ? soft : green));
  doc.text(refunded ? 'REFUNDED' : 'PAID', 190, 31, { align: 'right' });
  doc.setDrawColor(...orange); doc.setLineWidth(1.2); doc.line(20, 36, 190, 36);

  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(...soft);
  doc.text(STUDIO_LINES, 20, 46);
  const meta: [string, string][] = [['Invoice no.', inv.invoice_no], ['Invoice date', day(inv.paid_at)], ['Payment method', inv.method]];
  meta.forEach(([k, v], i) => {
    doc.setTextColor(...soft); doc.setFont('helvetica', 'normal'); doc.text(k, 125, 46 + i * 6);
    doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.text(v, 190, 46 + i * 6, { align: 'right' });
  });

  // Billed to: the business when they gave one, then the person.
  let y = 78;
  doc.setFont('helvetica', 'normal'); doc.setTextColor(...soft); doc.text('Billed to', 20, y); y += 6;
  doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(inv.company || inv.billed_name || 'Customer', 20, y); y += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  const who = [
    inv.company && inv.billed_name ? `Attn: ${inv.billed_name}` : null,
    ...(inv.address ? (doc.splitTextToSize(inv.address, 100) as string[]) : []),
    inv.tax_number ? `VAT / company no.: ${inv.tax_number}` : null,
    inv.billed_email, inv.billed_phone,
  ].filter(Boolean) as string[];
  doc.text(who, 20, y); y += who.length * 5 + 8;

  // Lines: one per booked date, with its extras underneath.
  doc.setFillColor(244, 244, 245); doc.rect(20, y, 170, 9, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...ink);
  doc.text('Studio hire', 24, y + 6); doc.text('Hours', 140, y + 6, { align: 'right' }); doc.text('Amount', 186, y + 6, { align: 'right' });
  y += 16;
  const row = (label: string, hours: string, cents: number, sub = false) => {
    if (y > 265) { doc.addPage(); y = 25; }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(sub ? 9.5 : 10.5); doc.setTextColor(...(sub ? soft : ink));
    doc.text(label, sub ? 28 : 24, y); if (hours) doc.text(hours, 140, y, { align: 'right' });
    doc.text(eur(cents), 186, y, { align: 'right' }); y += sub ? 5 : 6;
  };
  for (const l of inv.lines) {
    row(`${l.is_party ? 'Party: ' : ''}${slot(l.starts_at, l.ends_at)}${l.status === 'cancelled' ? ' (cancelled)' : ''}`, hrs(Number(l.hours)), l.rent_cents);
    if (l.cleaning_cents) row('Cleaning fee', '', l.cleaning_cents, true);
    if (l.dj_cents) row(`DJ (${l.dj_minutes / 60} h)`, '', l.dj_cents, true);
    if (l.marketing_cents) row(`Party promotion (${l.marketing_weeks} week${l.marketing_weeks === 1 ? '' : 's'})`, '', l.marketing_cents, true);
    y += 2;
  }
  const linesTotal = inv.lines.reduce((s, l) => s + l.total_cents, 0);
  const discount = linesTotal - inv.total_cents;

  y += 2; doc.setDrawColor(228, 228, 231); doc.setLineWidth(0.3); doc.line(20, y, 190, y); y += 8;
  doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...soft);
  if (discount > 0) { doc.text('Discount', 125, y); doc.text(`-${eur(discount)}`, 186, y, { align: 'right' }); y += 7; }
  doc.setFontSize(12); doc.setTextColor(...ink); doc.setFont('helvetica', 'bold');
  doc.text('Total paid', 125, y); doc.text(eur(inv.total_cents), 186, y, { align: 'right' }); y += 7;
  if (inv.refund_cents > 0) {
    doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...soft);
    doc.text('Refunded', 125, y); doc.text(`-${eur(inv.refund_cents)}`, 186, y, { align: 'right' }); y += 7;
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...soft);
  doc.text(refunded ? 'This payment was refunded to the original payment method.' : 'Thank you for choosing Drop Studios. This invoice was paid in full.', 20, y + 10);
  doc.text('Questions about this invoice? Reply to your booking email or write to dropstudioie@gmail.com.', 20, y + 15);
  return doc;
}

export const invoiceFileName = (inv: RentalInvoice) => `Drop-Studios-invoice-${inv.invoice_no}.pdf`;
