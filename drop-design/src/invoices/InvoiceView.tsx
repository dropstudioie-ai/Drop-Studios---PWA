import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download, Mail, Trash2, XCircle } from 'lucide-react';
import type { BusinessProfile, Invoice } from './types';
import { approveInvoice, business, invoices } from './store';
import { invoicePdf } from './pdf';
import { eur, invoiceTotals, isOverdue, longDate } from './money';
import { gmailClientId, gmailComposeUrl, sendWithGmail } from './gmail';
import { InvoicePreview } from './InvoicePreview';
import { downloadBlob } from '../export/export';
import { Modal, Spinner, useConfirm, useToast } from '../components/ui';
import { StatusChip } from './InvoicesPage';

export default function InvoiceView() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [inv, setInv] = useState<Invoice | null | undefined>(undefined);
  const [me, setMe] = useState<BusinessProfile | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => { void invoices.get(id).then((i) => setInv(i ?? null)); void business.get().then(setMe); }, [id]);
  if (inv === undefined || !me) return <div className="p-10"><Spinner /></div>;
  if (!inv) return <div className="p-10">Invoice not found. <Link to="/invoices" className="underline">Back</Link></div>;
  const pdf = () => invoicePdf(inv, me);
  const file = `Invoice-${inv.number || 'draft'}.pdf`;
  const update = async (patch: Partial<Invoice>) => { const n = { ...inv, ...patch }; await invoices.save(n); setInv(n); };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link to="/invoices" className="btn-ghost btn-sm -ml-2"><ArrowLeft size={16} />Invoices</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">{inv.number || 'Draft invoice'} <StatusChip inv={inv} /></h1>
          <p className="text-muted">{inv.client.name} · {eur(invoiceTotals(inv).gross)} · due {longDate(inv.dueDate)}{inv.sentAt ? ` · sent ${new Date(inv.sentAt).toLocaleDateString('en-IE')} to ${inv.sentTo}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {inv.status === 'draft' && <button className="btn-primary" onClick={async () => { const a = await approveInvoice(inv); setInv(a); toast(`Approved as ${a.number}`); }}><Check size={16} />Approve</button>}
          {inv.status !== 'draft' && <button className="btn-outline" onClick={() => downloadBlob(pdf(), file)} data-testid="download-pdf"><Download size={16} />PDF</button>}
          {inv.status !== 'draft' && inv.status !== 'cancelled' && <button className="btn-primary" onClick={() => setSending(true)}><Mail size={16} />Send from Gmail</button>}
          {(inv.status === 'approved' || inv.status === 'sent') && <button className="btn-outline" onClick={() => void update({ status: 'paid', paidAt: Date.now() })} data-testid="mark-paid"><Check size={16} />Mark paid</button>}
          {inv.status === 'paid' && <button className="btn-ghost" onClick={() => void update({ status: inv.sentAt ? 'sent' : 'approved', paidAt: null })}>Mark unpaid</button>}
          {inv.status === 'draft' ? (
            <button className="btn-ghost text-danger" onClick={async () => { if (await confirm({ title: 'Delete draft?', body: 'This draft will be removed.', ok: 'Delete', danger: true })) { await invoices.remove(inv.id); nav('/invoices'); } }}><Trash2 size={16} />Delete</button>
          ) : inv.status !== 'cancelled' && inv.status !== 'paid' && (
            <button className="btn-ghost text-danger" onClick={async () => { if (await confirm({ title: 'Cancel invoice?', body: 'Approved invoices keep their number for your records; it will be marked cancelled. Issue a new one if needed.', ok: 'Cancel invoice', danger: true })) await update({ status: 'cancelled' }); }}><XCircle size={16} />Cancel</button>
          )}
        </div>
      </div>
      {isOverdue(inv) && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-danger">This invoice is overdue.</p>}
      <div className="mt-6"><InvoicePreview inv={inv} me={me} /></div>
      {sending && <SendDialog inv={inv} me={me} pdf={pdf} file={file} onClose={() => setSending(false)} onSent={(to) => void update({ status: inv.status === 'paid' ? 'paid' : 'sent', sentAt: Date.now(), sentTo: to })} />}
    </div>
  );
}

function SendDialog({ inv, me, pdf, file, onClose, onSent }: { inv: Invoice; me: BusinessProfile; pdf: () => Blob; file: string; onClose: () => void; onSent: (to: string) => void }) {
  const toast = useToast();
  const [to, setTo] = useState(inv.client.email);
  const [subject, setSubject] = useState(`Invoice ${inv.number} from ${me.name}`);
  const [body, setBody] = useState(`Hi ${inv.client.name.split(' ')[0]},\n\nPlease find attached invoice ${inv.number} for ${eur(invoiceTotals(inv).gross)}, due on ${longDate(inv.dueDate)}.\n\nPayment details:\n${inv.bank.accountName}\nIBAN ${inv.bank.iban}${inv.bank.bic ? `\nBIC ${inv.bank.bic}` : ''}\nReference: ${inv.number}\n\nThank you!\n${me.name}`);
  const [busy, setBusy] = useState(false);
  const [hasClient, setHasClient] = useState<boolean | null>(null);
  useEffect(() => { void gmailClientId().then((c) => setHasClient(Boolean(c))); }, []);
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to);
  async function send() {
    setBusy(true);
    try { await sendWithGmail({ to, subject, body, pdf: pdf(), filename: file }); onSent(to); toast(`Sent to ${to}`); onClose(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="Send from your Gmail" wide
      footer={<>
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-outline" disabled={!valid} onClick={() => { downloadBlob(pdf(), file); window.open(gmailComposeUrl(to, subject, body), '_blank'); onSent(to); onClose(); }}>Open Gmail draft (attach the PDF)</button>
        {hasClient && <button className="btn-primary" disabled={!valid || busy} onClick={() => void send()}>{busy ? <Spinner className="h-4 w-4" /> : <Mail size={16} />}Send now</button>}
      </>}>
      <div className="space-y-3">
        <label className="block"><span className="label">To</span><input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="block"><span className="label">Subject</span><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
        <label className="block"><span className="label">Message</span><textarea className="input min-h-48 font-mono text-xs" value={body} onChange={(e) => setBody(e.target.value)} /></label>
        <p className="text-sm text-muted">📎 {file} is attached.</p>
        {hasClient === false && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">To send directly, connect Gmail once in <Link to="/invoices/settings" className="font-semibold underline">Invoice settings</Link>. Until then, “Open Gmail draft” downloads the PDF and opens a ready-written email in Gmail for you to attach it and press send.</p>}
      </div>
    </Modal>
  );
}
