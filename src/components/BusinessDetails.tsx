import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Field, Spinner, useToast } from './ui';

interface Billing { business_name: string; address: string; tax_number: string; billing_email: string }
const EMPTY: Billing = { business_name: '', address: '', tax_number: '', billing_email: '' };

/** Renters' business details, printed on their studio hire invoices. */
export function BusinessDetails({ userId }: { userId: string }) {
  const toast = useToast();
  const [f, setF] = useState<Billing>(EMPTY);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Billing | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('billing_details').select('business_name, address, tax_number, billing_email').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (data) { const v = { ...EMPTY, ...Object.fromEntries(Object.entries(data).map(([k, x]) => [k, x ?? ''])) } as Billing; setF(v); setSaved(v); } });
  }, [userId]);

  async function save() {
    setBusy(true);
    const row = { user_id: userId, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])), updated_at: new Date().toISOString() };
    const { error } = await supabase.from('billing_details').upsert(row);
    setBusy(false);
    if (error) { toast('Could not save your business details.', 'error'); return; }
    setSaved(f); setOpen(false); toast('Saved. Your invoices will show these details.');
  }
  const set = (k: keyof Billing) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold">🧾 Business details for invoices</p>
          <p className="text-sm text-muted">{saved?.business_name ? `${saved.business_name}${saved.tax_number ? ` · ${saved.tax_number}` : ''}` : 'Renting for a company or group? Add its details and they’ll appear on your invoices.'}</p>
        </div>
        {!open && <button className="btn-outline btn-sm" onClick={() => setOpen(true)}>{saved?.business_name ? 'Edit' : 'Add details'}</button>}
      </div>
      {open && (
        <div className="mt-4 space-y-3">
          <Field label="Business or group name"><input className="input" maxLength={120} value={f.business_name} onChange={set('business_name')} placeholder="e.g. Your Dance Company Ltd" /></Field>
          <Field label="Billing address"><textarea className="input min-h-20 py-3" maxLength={300} value={f.address} onChange={set('address')} placeholder="Street, city, Eircode" /></Field>
          <Field label="VAT or company number (optional)"><input className="input" maxLength={40} value={f.tax_number} onChange={set('tax_number')} placeholder="e.g. IE1234567X or CRO 123456" /></Field>
          <Field label="Email for invoices (optional)" hint="Leave empty to use your account email."><input className="input" type="email" maxLength={200} value={f.billing_email} onChange={set('billing_email')} /></Field>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => void save()}>{busy ? <Spinner /> : 'Save details'}</button>
            <button className="btn-ghost" onClick={() => { setF(saved ?? EMPTY); setOpen(false); }}>Cancel</button>
          </div>
          <p className="text-xs text-muted">Invoices you download from “Payments &amp; receipts” always show your latest details.</p>
        </div>
      )}
    </div>
  );
}
