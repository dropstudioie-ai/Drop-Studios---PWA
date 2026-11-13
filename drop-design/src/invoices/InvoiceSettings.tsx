import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Star, Trash2 } from 'lucide-react';
import type { BankAccount, BusinessProfile, Client } from './types';
import { banks, business, clients, googleClientId } from './store';
import { useConfirm, useToast, Spinner } from '../components/ui';

export default function InvoiceSettings() {
  const toast = useToast();
  const confirm = useConfirm();
  const [me, setMe] = useState<BusinessProfile | null>(null);
  const [bankList, setBanks] = useState<BankAccount[]>([]);
  const [clientList, setClients] = useState<Client[]>([]);
  const [gid, setGid] = useState('');
  const load = async () => { setMe(await business.get()); setBanks(await banks.list()); setClients(await clients.list()); setGid(await googleClientId.get()); };
  useEffect(() => { void load(); }, []);
  if (!me) return <div className="p-10"><Spinner /></div>;
  const field = (k: keyof BusinessProfile, label: string, o: { area?: boolean; type?: string } = {}) => (
    <label className={o.area ? 'sm:col-span-2' : ''}><span className="label">{label}</span>
      {o.area ? <textarea className="input min-h-20" value={String(me[k])} onChange={(e) => setMe({ ...me, [k]: e.target.value })} />
        : <input className="input" type={o.type ?? 'text'} value={String(me[k])} onChange={(e) => setMe({ ...me, [k]: o.type === 'number' ? Number(e.target.value) : e.target.value })} />}
    </label>
  );
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link to="/invoices" className="btn-ghost btn-sm -ml-2"><ArrowLeft size={16} />Invoices</Link>
      <h1 className="mt-2 text-3xl font-black">Invoice settings</h1>

      <section className="card mt-6 p-5">
        <h2 className="font-bold">Your business (shown on every invoice)</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {field('name', 'Business name')}{field('email', 'Email')}{field('address', 'Address', { area: true })}{field('phone', 'Phone')}
          {field('vatNumber', 'VAT number (leave empty if not registered)')}{field('companyNumber', 'Company (CRO) number')}
          {field('invoicePrefix', 'Invoice number prefix')}{field('nextNumber', 'Next invoice number', { type: 'number' })}
          {field('defaultDueDays', 'Default days to pay', { type: 'number' })}{field('footer', 'Footer line')}
        </div>
        <button className="btn-primary mt-4" onClick={async () => { await business.save(me); toast('Saved'); }}>Save business details</button>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-bold">Bank accounts</h2>
        {bankList.length === 0 && <p className="mt-2 text-sm text-muted">Add one when you create your first invoice.</p>}
        {bankList.map((k) => (
          <div key={k.id} className="mt-2 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <div className="min-w-0 flex-1"><p className="font-semibold">{k.label}{k.isDefault ? ' · default' : ''}</p><p className="font-mono text-xs text-muted">{k.accountName} · {k.iban} · {k.bic}</p></div>
            {!k.isDefault && <button className="btn-ghost btn-sm" onClick={async () => { await banks.save({ ...k, isDefault: true }); void load(); }}><Star size={14} />Make default</button>}
            <button className="icon-btn text-danger" aria-label={`Delete ${k.label}`} onClick={async () => { if (await confirm({ title: 'Remove bank account?', body: 'Past invoices keep their payment details.', ok: 'Remove', danger: true })) { await banks.remove(k.id); void load(); } }}><Trash2 size={16} /></button>
          </div>
        ))}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-bold">Clients</h2>
        {clientList.length === 0 && <p className="mt-2 text-sm text-muted">Clients are saved when you invoice them.</p>}
        {clientList.map((c) => (
          <div key={c.id} className="mt-2 grid items-end gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]">
            <label><span className="label">Name</span><input className="input" value={c.name} onChange={(e) => setClients(clientList.map((x) => x.id === c.id ? { ...x, name: e.target.value } : x))} /></label>
            <label><span className="label">Email</span><input className="input" value={c.email} onChange={(e) => setClients(clientList.map((x) => x.id === c.id ? { ...x, email: e.target.value } : x))} /></label>
            <button className="btn-outline btn-sm" onClick={async () => { await clients.save(clientList.find((x) => x.id === c.id)!); toast('Client saved'); }}>Save</button>
            <label className="sm:col-span-3"><span className="label">Address</span><textarea className="input min-h-14" value={c.address} onChange={(e) => setClients(clientList.map((x) => x.id === c.id ? { ...x, address: e.target.value } : x))} /></label>
          </div>
        ))}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-bold">Send invoices from Gmail</h2>
        <p className="mt-1 text-sm text-muted">One-time setup so invoices go straight from your Gmail with the PDF attached. You’ll get step-by-step instructions; it only allows “send email”, nothing else.</p>
        <label className="mt-3 block"><span className="label">Google OAuth client ID</span><input className="input font-mono" value={gid} onChange={(e) => setGid(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" /></label>
        <button className="btn-primary mt-3" onClick={async () => { await googleClientId.set(gid); toast(gid ? 'Gmail sending enabled' : 'Gmail sending turned off'); }}>Save</button>
        <p className="mt-2 text-xs text-muted">Without it you can still click “Open Gmail draft”: the PDF downloads and a ready-written email opens in Gmail.</p>
      </section>
    </div>
  );
}
