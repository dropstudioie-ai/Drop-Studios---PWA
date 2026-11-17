import { supabase } from './supabase';
import { unwrap } from '../api';
import { STUDIO } from '../config/studio';

export interface Receipt {
  id: string; receipt_no: string; paid_at: string; kind: 'membership' | 'ticket' | 'drop_in' | 'gift'; description: string;
  class_date: string | null; month: number | null; of: number | null; classes: number | null;
  amount_cents: number; currency: string; method: string; status: 'succeeded' | 'refunded'; gift_code: string | null;
}

export const myReceipts = async () => unwrap(await supabase.rpc('my_receipts')) as Receipt[];

const TZ = 'Europe/Dublin';
const money = (cents: number, currency: string) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
const day = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const dayTime = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** Drop's logo as a PNG for the PDF (drawn from the SVG in the browser). */
async function logoPng(): Promise<string | null> {
  const img = new Image();
  img.src = '/brand/drop-logo-black.svg';
  await img.decode().catch(() => null);
  if (!img.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = 600; c.height = Math.round(600 * (img.naturalHeight / img.naturalWidth));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

/** Builds and downloads a one-page PDF receipt. */
export async function downloadReceipt(r: Receipt, member: { full_name: string | null; email: string | null }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ink = [11, 11, 13] as const, soft = [113, 113, 122] as const, orange = [255, 122, 0] as const;
  const logo = await logoPng();
  if (logo) doc.addImage(logo, 'PNG', 20, 18, 46, 46 * 0.235);
  else { doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('DROP STUDIOS', 20, 26); }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...ink);
  doc.text(r.status === 'refunded' ? 'RECEIPT (REFUNDED)' : 'RECEIPT', 190, 26, { align: 'right' });
  doc.setDrawColor(...orange); doc.setLineWidth(1.2); doc.line(20, 36, 190, 36);

  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(...soft);
  doc.text(['Drop Studios', STUDIO.address, 'dropstudioie@gmail.com', 'www.dropstudios.ie'], 20, 46);
  const meta: [string, string][] = [['Receipt no.', r.receipt_no], ['Date paid', day(r.paid_at)], ['Payment method', r.method]];
  meta.forEach(([k, v], i) => {
    doc.setTextColor(...soft); doc.text(k, 130, 46 + i * 6);
    doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.text(v, 190, 46 + i * 6, { align: 'right' }); doc.setFont('helvetica', 'normal');
  });

  doc.setTextColor(...soft); doc.text('Billed to', 20, 78);
  doc.setTextColor(...ink); doc.setFont('helvetica', 'bold'); doc.text(member.full_name ?? 'Member', 20, 84);
  doc.setFont('helvetica', 'normal'); if (member.email) doc.text(member.email, 20, 90);

  // The item
  doc.setFillColor(244, 244, 245); doc.rect(20, 100, 170, 9, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Description', 24, 106); doc.text('Amount', 186, 106, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  const desc = doc.splitTextToSize(r.description, 120) as string[];
  doc.text(desc, 24, 118);
  doc.text(money(r.amount_cents, r.currency), 186, 118, { align: 'right' });
  const details = [
    r.month && r.of ? `Monthly payment ${r.month} of ${r.of}` : null,
    r.classes ? `${r.classes >= 900 ? 'Unlimited' : r.classes} classes` : null,
    r.class_date ? `Class: ${dayTime(r.class_date)}` : null,
    r.gift_code ? `Gift card code: ${r.gift_code}` : null,
  ].filter(Boolean) as string[];
  doc.setFontSize(9.5); doc.setTextColor(...soft);
  doc.text(details, 24, 118 + desc.length * 5 + 1);
  const y = 130 + desc.length * 5 + details.length * 4.5;
  doc.setDrawColor(228, 228, 231); doc.setLineWidth(0.3); doc.line(20, y, 190, y);
  doc.setFontSize(12); doc.setTextColor(...ink); doc.setFont('helvetica', 'bold');
  doc.text(r.status === 'refunded' ? 'Total (refunded)' : 'Total paid', 130, y + 9);
  doc.text(money(r.amount_cents, r.currency), 186, y + 9, { align: 'right' });

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...soft);
  doc.text(r.status === 'refunded' ? 'This payment was refunded to the original payment method.' : 'Thank you for dancing with us! This receipt confirms your payment was received.', 20, y + 24);
  doc.text('Questions about this payment? Reply to your receipt email or ask us at reception.', 20, y + 29);
  doc.save(`Drop-Studios-receipt-${r.receipt_no}.pdf`);
}
