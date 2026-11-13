import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react';
import type { BankAccount, BusinessProfile, Client, Invoice, InvoiceItem, VatMode } from './types';
import { IRISH_VAT_RATES } from './types';
import { addDays, eur, isoDate, parseEuro, totals } from './money';
import { approveInvoice, banks, business, clients, invoices } from './store';
import { InvoicePreview } from './InvoicePreview';
import { Spinner, useToast } from '../components/ui';
import { uid } from '../model/elements';

type Step = 'who' | 'what' | 'vat' | 'bank' | 'review';
const STEPS: [Step, string][] = [['who', 'Who to'], ['what', 'How much'], ['vat', 'VAT'], ['bank', 'Bank account'], ['review', 'Approve']];

/** Four questions, then a preview to approve: who, how much, is VAT included, which account. */
export default function InvoiceWizard() {
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState<Step>('who');
  const [me, setMe] = useState<BusinessProfile | null>(null);
  const [clientList, setClients] = useState<Client[]>([]);
  const [bankList, setBanks] = useState<BankAccount[]>([]);
  const [history, setHistory] = useState<Invoice[]>([]);
  const [client, setClient] = useState<Client | null>(null);
  const [newClient, setNewClient] = useState({ name: '', email: '', address: '', vatNumber: '' });
  const [q, setQ] = useState('');
  const [items, setItems] = useState<{ id: string; description: string; quantity: string; price: string }[]>([{ id: uid(), description: '', quantity: '1', price: '' }]);
  const [vatMode, setVatMode] = useState<VatMode | null>(null);
  const [vatRate, setVatRate] = useState(23);
  const [bank, setBank] = useState<BankAccount | null>(null);
  const [newBank, setNewBank] = useState({ label: '', accountName: '', bankName: '', iban: '', bic: '' });
  const [issueDate, setIssueDate] = useState(isoDate(new Date()));
  const [dueDays, setDueDays] = useState(14);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([business.get(), clients.list(), banks.list(), invoices.list()]).then(([b, c, k, h]) => {
      setMe(b); setClients(c); setBanks(k); setHistory(h); setDueDays(b.defaultDueDays); setVatRate(b.defaultVatRate);
      setBank(k.find((x) => x.isDefault) ?? k[0] ?? null);
    });
  }, []);

  // Learn from past invoices: what you usually bill this client, into which account, with or without VAT.
  const past = useMemo(() => client ? history.filter((h) => h.clientId === client.id && h.status !== 'cancelled') : [], [client, history]);
  useEffect(() => {
    const last = past[0];
    if (!last) return;
    setVatMode((v) => v ?? last.vatMode); setVatRate(last.vatRate);
    const k = bankList.find((b) => b.id === last.bank.id); if (k) setBank(k);
  }, [past, bankList]);

  const parsed: InvoiceItem[] = items.map((i) => ({ id: i.id, description: i.description.trim(), quantity: Number(i.quantity) || 0, unitPriceCents: parseEuro(i.price) ?? NaN }));
  const itemsOk = parsed.length > 0 && parsed.every((i) => i.description && i.quantity > 0 && Number.isFinite(i.unitPriceCents) && i.unitPriceCents > 0);
  const mode: VatMode = vatMode ?? (me?.vatNumber ? 'added' : 'none');
  const tt = itemsOk ? totals(parsed, mode, vatRate) : null;

  if (!me) return <div className="p-10"><Spinner /></div>;

  const draft = (): Invoice => ({
    id: uid(), number: '', issueDate, dueDate: addDays(issueDate, dueDays), clientId: client!.id, client: client!, items: parsed,
    vatMode: mode, vatRate: mode === 'none' ? 0 : vatRate, bank: bank!, status: 'draft', notes, createdAt: Date.now(), updatedAt: Date.now(),
  });

  async function nextFromWho() {
    if (client) { setStep('what'); return; }
    if (!newClient.name.trim()) { toast('Enter who the invoice is for', 'error'); return; }
    if (newClient.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newClient.email)) { toast('That email doesn’t look right', 'error'); return; }
    const c = clients.create({ name: newClient.name.trim(), email: newClient.email.trim(), address: newClient.address.trim(), vatNumber: newClient.vatNumber.trim() || undefined });
    await clients.save(c); setClients([...clientList, c]); setClient(c); setStep('what');
  }
  async function nextFromBank() {
    if (bank) { setStep('review'); return; }
    if (!/^[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}$/i.test(newBank.iban.replace(/\s/g, ''))) { toast('Enter a valid IBAN', 'error'); return; }
    if (!newBank.accountName.trim()) { toast('Enter the account name', 'error'); return; }
    const k: BankAccount = { id: uid(), label: newBank.label.trim() || newBank.bankName.trim() || 'Bank account', accountName: newBank.accountName.trim(), bankName: newBank.bankName.trim(),
      iban: newBank.iban.replace(/\s/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim(), bic: newBank.bic.trim().toUpperCase(), isDefault: bankList.length === 0 };
    await banks.save(k); setBanks([...bankList, k]); setBank(k); setStep('review');
  }
  async function approve() {
    setBusy(true);
    try { const inv = await approveInvoice(draft()); toast(`Invoice ${inv.number} approved`); nav(`/invoices/${inv.id}`); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function saveDraft() { const d = draft(); await invoices.save(d); toast('Saved as draft'); nav(`/invoices/${d.id}`); }

  const shownClients = clientList.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.email.toLowerCase().includes(q.toLowerCase()));
  const idx = STEPS.findIndex(([s]) => s === step);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <button className="btn-ghost btn-sm -ml-2" onClick={() => (idx > 0 ? setStep(STEPS[idx - 1][0]) : nav('/invoices'))}><ArrowLeft size={16} />{idx > 0 ? 'Back' : 'Invoices'}</button>
      <ol className="mt-3 flex gap-1">{STEPS.map(([s, l], i) => <li key={s} className={`flex-1 rounded-full py-1 text-center text-xs font-semibold ${i < idx ? 'bg-zinc-300' : i === idx ? 'bg-ink text-white' : 'bg-slate-100 text-muted'}`}>{l}</li>)}</ol>

      <div className="card mt-6 p-6">
        {step === 'who' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-black">Who is this invoice for?</h1>
            {clientList.length > 0 && (
              <>
                <input className="input" placeholder="Search your clients" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
                <div className="grid gap-2 sm:grid-cols-2">
                  {shownClients.map((c) => (
                    <button key={c.id} onClick={() => setClient(client?.id === c.id ? null : c)} className={`rounded-xl border p-3 text-left ${client?.id === c.id ? 'border-ink bg-zinc-50 ring-1 ring-ink' : 'border-line hover:bg-slate-50'}`}>
                      <span className="block font-semibold">{c.name}</span><span className="text-xs text-muted">{c.email || 'no email'} · {history.filter((h) => h.clientId === c.id).length} invoices</span>
                    </button>
                  ))}
                </div>
                <p className="text-center text-xs font-semibold uppercase text-muted">or a new client</p>
              </>
            )}
            {!client && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="label">Name or company</span><input className="input" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} data-testid="client-name" /></label>
                <label><span className="label">Email (to send it)</span><input className="input" type="email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} data-testid="client-email" /></label>
                <label><span className="label">Their VAT number (optional)</span><input className="input" value={newClient.vatNumber} onChange={(e) => setNewClient({ ...newClient, vatNumber: e.target.value })} /></label>
                <label className="sm:col-span-2"><span className="label">Address</span><textarea className="input min-h-16" value={newClient.address} onChange={(e) => setNewClient({ ...newClient, address: e.target.value })} /></label>
              </div>
            )}
            <button className="btn-primary w-full" onClick={() => void nextFromWho()} data-testid="next">Next</button>
          </div>
        )}

        {step === 'what' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-black">What’s it for, and how much?</h1>
            {past[0] && <p className="rounded-lg bg-slate-50 p-2 text-sm text-muted">Last time for {client!.name}: “{past[0].items[0]?.description}” · {eur(totals(past[0].items, past[0].vatMode, past[0].vatRate).gross)} <button className="font-semibold text-ink underline" onClick={() => setItems(past[0].items.map((i) => ({ id: uid(), description: i.description, quantity: String(i.quantity), price: (i.unitPriceCents / 100).toFixed(2) })))}>Use again</button></p>}
            {items.map((it, i) => (
              <div key={it.id} className="grid grid-cols-[1fr_70px_120px_auto] items-end gap-2">
                <label><span className="label">Description</span><input className="input" value={it.description} placeholder="e.g. Dance workshop, 15 March" onChange={(e) => setItems(items.map((x) => x.id === it.id ? { ...x, description: e.target.value } : x))} data-testid={`item-desc-${i}`} /></label>
                <label><span className="label">Qty</span><input className="input" inputMode="decimal" value={it.quantity} onChange={(e) => setItems(items.map((x) => x.id === it.id ? { ...x, quantity: e.target.value } : x))} /></label>
                <label><span className="label">Amount €</span><input className="input" inputMode="decimal" value={it.price} placeholder="0.00" onChange={(e) => setItems(items.map((x) => x.id === it.id ? { ...x, price: e.target.value } : x))} data-testid={`item-price-${i}`} /></label>
                <button className="icon-btn" aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems(items.filter((x) => x.id !== it.id))}><Trash2 size={16} /></button>
              </div>
            ))}
            <button className="btn-ghost btn-sm" onClick={() => setItems([...items, { id: uid(), description: '', quantity: '1', price: '' }])}><Plus size={14} />Add another line</button>
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className="label">Invoice date</span><input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></label>
              <label><span className="label">Payment due in</span><select className="input" value={dueDays} onChange={(e) => setDueDays(Number(e.target.value))}>{[0, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d === 0 ? 'On receipt' : `${d} days`}</option>)}</select></label>
            </div>
            <button className="btn-primary w-full" disabled={!itemsOk} onClick={() => setStep('vat')} data-testid="next">Next</button>
          </div>
        )}

        {step === 'vat' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-black">Is VAT included?</h1>
            {!me.vatNumber && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Your business has no VAT number saved, so you normally shouldn’t charge VAT. Add it in Invoice settings if you’re registered.</p>}
            {([['included', 'Yes, the amount already includes VAT', 'VAT is worked out from inside the total'], ['added', 'No, add VAT on top', 'The client pays the amount plus VAT'], ['none', 'No VAT on this invoice', 'Not VAT registered, or the service is exempt']] as const).map(([v, l, d]) => (
              <button key={v} onClick={() => setVatMode(v)} className={`block w-full rounded-xl border p-4 text-left ${mode === v ? 'border-ink bg-zinc-50 ring-1 ring-ink' : 'border-line hover:bg-slate-50'}`} data-testid={`vat-${v}`}>
                <span className="block font-semibold">{l}</span><span className="text-sm text-muted">{d}</span>
              </button>
            ))}
            {mode !== 'none' && <label className="block"><span className="label">VAT rate</span><select className="input" value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))}>{IRISH_VAT_RATES.filter((r) => r > 0).map((r) => <option key={r} value={r}>{r}%</option>)}</select></label>}
            {tt && <p className="text-sm">Net {eur(tt.net)} · VAT {eur(tt.vat)} · <strong>Total {eur(tt.gross)}</strong></p>}
            <button className="btn-primary w-full" onClick={() => setStep('bank')} data-testid="next">Next</button>
          </div>
        )}

        {step === 'bank' && (
          <div className="space-y-4">
            <h1 className="text-2xl font-black">Which account should it be paid into?</h1>
            <div className="grid gap-2">
              {bankList.map((k) => (
                <button key={k.id} onClick={() => setBank(bank?.id === k.id ? null : k)} className={`rounded-xl border p-3 text-left ${bank?.id === k.id ? 'border-ink bg-zinc-50 ring-1 ring-ink' : 'border-line hover:bg-slate-50'}`}>
                  <span className="block font-semibold">{k.label}{k.isDefault ? ' (default)' : ''}</span><span className="font-mono text-xs text-muted">{k.accountName} · {k.iban}</span>
                </button>
              ))}
            </div>
            {!bank && (
              <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
                <p className="font-semibold sm:col-span-2">{bankList.length ? 'Or add another account' : 'Add your bank account'}</p>
                <label><span className="label">Label</span><input className="input" placeholder="e.g. AIB business" value={newBank.label} onChange={(e) => setNewBank({ ...newBank, label: e.target.value })} /></label>
                <label><span className="label">Bank</span><input className="input" value={newBank.bankName} onChange={(e) => setNewBank({ ...newBank, bankName: e.target.value })} /></label>
                <label className="sm:col-span-2"><span className="label">Account name</span><input className="input" value={newBank.accountName} onChange={(e) => setNewBank({ ...newBank, accountName: e.target.value })} data-testid="bank-name" /></label>
                <label><span className="label">IBAN</span><input className="input font-mono" value={newBank.iban} onChange={(e) => setNewBank({ ...newBank, iban: e.target.value })} data-testid="bank-iban" /></label>
                <label><span className="label">BIC</span><input className="input font-mono" value={newBank.bic} onChange={(e) => setNewBank({ ...newBank, bic: e.target.value })} /></label>
              </div>
            )}
            <label className="block"><span className="label">Note on the invoice (optional)</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Thanks for having us!" /></label>
            <button className="btn-primary w-full" onClick={() => void nextFromBank()} data-testid="next">Preview invoice</button>
          </div>
        )}

        {step === 'review' && client && bank && (
          <div className="space-y-4">
            <h1 className="text-2xl font-black">Check and approve</h1>
            <InvoicePreview inv={{ ...draft(), number: 'Assigned on approval' }} me={me} />
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-outline" onClick={() => void saveDraft()}>Save as draft</button>
              <button className="btn-primary" disabled={busy} onClick={() => void approve()} data-testid="approve-invoice">{busy ? <Spinner className="h-4 w-4" /> : <Check size={16} />}Approve invoice</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
