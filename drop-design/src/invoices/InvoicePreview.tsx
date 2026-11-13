import type { BusinessProfile, Invoice } from './types';
import { eur, invoiceTotals, longDate } from './money';

/** On-screen version of the PDF, for approval. */
export function InvoicePreview({ inv, me }: { inv: Invoice; me: BusinessProfile }) {
  const tt = invoiceTotals(inv);
  return (
    <div className="rounded-xl border border-line bg-white p-6 text-sm shadow-sm" data-testid="invoice-preview">
      <div className="flex justify-between gap-4">
        <div>
          <p className="text-lg font-bold">{me.name}</p>
          <p className="whitespace-pre-line text-muted">{me.address}</p>
          {me.vatNumber && <p className="text-muted">VAT no. {me.vatNumber}</p>}
        </div>
        <div className="text-right">
          <p className="text-2xl font-black">INVOICE</p>
          <p><span className="text-muted">No.</span> {inv.number || 'DRAFT'}</p>
          <p><span className="text-muted">Date</span> {longDate(inv.issueDate)}</p>
          <p><span className="text-muted">Due</span> {longDate(inv.dueDate)}</p>
        </div>
      </div>
      <div className="mt-5">
        <p className="text-xs font-semibold uppercase text-muted">Bill to</p>
        <p className="font-semibold">{inv.client.name}</p>
        <p className="whitespace-pre-line text-muted">{[inv.client.address, inv.client.email].filter(Boolean).join('\n')}</p>
      </div>
      <table className="mt-5 w-full">
        <thead><tr className="bg-slate-50 text-left text-xs uppercase text-muted"><th className="p-2">Description</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Unit</th><th className="p-2 text-right">Amount</th></tr></thead>
        <tbody>{inv.items.map((i) => <tr key={i.id} className="border-b border-line"><td className="p-2">{i.description}</td><td className="p-2 text-right">{i.quantity}</td><td className="p-2 text-right">{eur(i.unitPriceCents)}</td><td className="p-2 text-right">{eur(Math.round(i.quantity * i.unitPriceCents))}</td></tr>)}</tbody>
      </table>
      <div className="ml-auto mt-3 w-64 space-y-1">
        {inv.vatMode !== 'none' && inv.vatRate > 0 ? <>
          <p className="flex justify-between"><span className="text-muted">Subtotal (excl. VAT)</span><span>{eur(tt.net)}</span></p>
          <p className="flex justify-between"><span className="text-muted">VAT @ {inv.vatRate}%</span><span>{eur(tt.vat)}</span></p>
        </> : <p className="text-right text-xs text-muted">{me.vatNumber ? 'VAT not charged' : 'Not registered for VAT'}</p>}
        <p className="flex justify-between border-t border-line pt-1 text-base font-bold"><span>Total due</span><span data-testid="invoice-total">{eur(tt.gross)}</span></p>
      </div>
      <div className="mt-5 rounded-lg bg-slate-50 p-3">
        <p className="font-semibold">Payment details</p>
        <p className="font-mono text-xs">{inv.bank.accountName} · {inv.bank.bankName}<br />IBAN {inv.bank.iban}{inv.bank.bic ? ` · BIC ${inv.bank.bic}` : ''}</p>
      </div>
      {inv.notes && <p className="mt-3 text-muted">{inv.notes}</p>}
    </div>
  );
}
