import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../api';
import { useAsync } from '../../lib/useAsync';
import { gifts, normaliseCode, type GiftLookup } from '../../lib/gifts';
import { formatPrice } from '../../domain/money';
import { messageFor } from '../../domain/messages';
import { fmt } from '../../domain/time';
import { ErrorNotice, Field, Notice, PageSpinner, Spinner, useToast } from '../../components/ui';
import { Section, Table, Td } from './shared';

const STATUS: Record<string, string> = { active: 'Active', redeemed: 'Redeemed', expired: 'Expired', cancelled: 'Cancelled' };

/** Reception: a member brings a printed card (or the email) and you add it to their account. */
function RedeemAtReception({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<GiftLookup | null>(null);
  const [q, setQ] = useState('');
  const [member, setMember] = useState<{ id: string; full_name: string | null; email: string | null } | null>(null);
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = useAsync(async () => {
    const t = q.trim().replace(/[%,()]/g, '');
    if (t.length < 2 || member) return [] as { id: string; full_name: string | null; email: string | null }[];
    return unwrap(await supabase.from('profiles').select('id, full_name, email').or(`full_name.ilike.%${t}%,email.ilike.%${t}%,phone.ilike.%${t}%`).limit(8)) as { id: string; full_name: string | null; email: string | null }[];
  }, [q, member]);
  const check = async () => {
    setBusy(true); setError(null); setInfo(null);
    try { setInfo(await gifts.lookup(normaliseCode(code))); } catch (e) { setError(messageFor((e as Error).message)); } finally { setBusy(false); }
  };
  const redeem = async () => {
    if (!info || !member) return;
    setBusy(true); setError(null);
    try {
      const r = await gifts.adminRedeem(info.code, member.id, info.style_access === 'single' ? style || null : null);
      toast(`${r.plan_name.replace(' (gift)', '')} added to ${member.full_name ?? 'the member'}`);
      setCode(''); setInfo(null); setMember(null); setQ(''); setStyle(''); onDone();
    } catch (e) { setError(messageFor((e as Error).message)); } finally { setBusy(false); }
  };
  return (
    <Section title="Redeem at reception">
      <p className="text-sm text-muted">For printed cards: enter the code, choose the member, and their classes are added straight away.</p>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <input className="input font-mono uppercase tracking-widest" value={code} onChange={(e) => { setCode(e.target.value); setInfo(null); }} placeholder="DROP-XXXX-XXXX" />
        <button className="btn-outline btn-sm" disabled={busy || code.trim().length < 8}>Check code</button>
      </form>
      {error && <div className="mt-3"><Notice tone="warn">{error}</Notice></div>}
      {info && (
        <div className="mt-3 space-y-3 rounded-2xl border border-line p-3">
          <p><strong>{info.plan_name.replace(' (gift)', '')}</strong> · {info.status === 'active' ? <span className="text-success">valid until {fmt.date(info.expires_at)}</span> : <span className="text-danger">{STATUS[info.status] ?? info.status}</span>}{info.recipient_name ? ` · for ${info.recipient_name}` : ''}</p>
          {info.status === 'active' && (
            <>
              {member ? (
                <p className="text-sm">Member: <strong>{member.full_name}</strong> <span className="text-muted">{member.email}</span> <button className="ml-2 text-xs font-semibold text-brand-700 underline" onClick={() => setMember(null)}>change</button></p>
              ) : (
                <>
                  <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the member: name, email or phone" />
                  {(found.data ?? []).map((m) => (
                    <button key={m.id} className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-canvas" onClick={() => setMember(m)}>
                      <span><strong>{m.full_name ?? 'Member'}</strong> <span className="text-muted">{m.email}</span></span><span className="font-semibold text-brand-700">Choose</span>
                    </button>
                  ))}
                  <p className="text-xs text-muted">New to Drop? Ask them to create their account in the app first (it takes a minute).</p>
                </>
              )}
              {info.style_access === 'single' && (
                <Field label="Dance style">
                  <select className="input" value={style} onChange={(e) => setStyle(e.target.value)}>
                    <option value="">Choose…</option>
                    {(info.styles ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
              <button className="btn-primary btn-sm" disabled={busy || !member || (info.style_access === 'single' && !style)} onClick={() => void redeem()}>{busy ? <Spinner className="h-4 w-4" /> : 'Redeem for this member'}</button>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

export default function AdminGifts() {
  const list = useAsync(() => gifts.all(), []);
  if (list.loading && !list.data) return <PageSpinner />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  const rows = list.data ?? [];
  const sold = rows.reduce((n, g) => n + g.plan_snapshot.price_cents, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="chip bg-brand-50 text-brand-700">🎁 {rows.length} sold · {formatPrice(sold, 'EUR')}</span>
        <span className="chip bg-success/10 text-success">{rows.filter((g) => g.status === 'redeemed').length} redeemed</span>
        <span className="chip bg-accent-50 text-accent-600">{rows.filter((g) => g.status === 'active').length} waiting to be used</span>
        <Link to="/gift" className="chip bg-canvas font-semibold">Open the gift card page ↗</Link>
      </div>
      <RedeemAtReception onDone={list.reload} />
      <Section title="Gift cards sold">
        {rows.length ? (
          <Table head={['Bought', 'Gift', 'From', 'For', 'Delivery', 'Code', 'Status']}>
            {rows.map((g) => (
              <tr key={g.id}>
                <Td>{g.purchased_at ? fmt.date(g.purchased_at) : ''}</Td>
                <Td className="font-semibold">{g.plan_snapshot.plan_name.replace(' (gift)', '')}</Td>
                <Td>{g.buyer?.full_name}<span className="block text-xs text-muted">{g.buyer?.email}</span></Td>
                <Td>{g.recipient_name ?? '—'}<span className="block text-xs text-muted">{g.recipient_email}</span></Td>
                <Td className="text-xs">{g.recipient_email ? (g.recipient_emailed_at ? `Emailed ${fmt.date(g.recipient_emailed_at)}` : `Email on ${g.send_on}`) : 'In person'}</Td>
                <Td className="font-mono text-xs">{g.code}</Td>
                <Td>{STATUS[g.status] ?? g.status}{g.status === 'redeemed' && <span className="block text-xs text-muted">by {g.redeemer?.full_name ?? 'member'} · {g.redeemed_via === 'reception' ? 'at reception' : 'in the app'}</span>}</Td>
              </tr>
            ))}
          </Table>
        ) : <p className="text-sm text-muted">No gift cards sold yet.</p>}
      </Section>
    </div>
  );
}
