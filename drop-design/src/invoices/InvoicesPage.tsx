import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Settings } from 'lucide-react';
import type { Invoice } from './types';
import { invoices } from './store';
import { eur, invoiceTotals, isOverdue, isoDate, longDate } from './money';
import { EmptyState, Spinner } from '../components/ui';

export function StatusChip({ inv }: { inv: Invoice }) {
  const overdue = isOverdue(inv);
  const [label, cls] = overdue ? ['Overdue', 'bg-red-100 text-red-700'] : ({
    draft: ['Draft', 'bg-slate-100 text-slate-600'], approved: ['Approved', 'bg-blue-100 text-blue-700'], sent: ['Sent', 'bg-violet-100 text-violet-700'],
    paid: ['Paid', 'bg-emerald-100 text-emerald-700'], cancelled: ['Cancelled', 'bg-slate-100 text-slate-500 line-through'],
  } as const)[inv.status];
  return <span className={`chip align-middle ${cls}`}>{label}</span>;
}

/** Irish VAT returns are every two months (Jan–Feb, Mar–Apr, …). */
const vatPeriod = (iso: string) => { const m = Number(iso.slice(5, 7)); const a = m % 2 ? m : m - 1; const n = (x: number) => new Date(2000, x - 1, 1).toLocaleString('en-IE', { month: 'short' }); return `${n(a)}–${n(a + 1)} ${iso.slice(0, 4)}`; };

function Analysis({ list }: { list: Invoice[] }) {
  const year = new Date().getFullYear();
  const live = list.filter((i) => i.status !== 'draft' && i.status !== 'cancelled');
  const thisYear = live.filter((i) => i.issueDate.startsWith(String(year)));
  const sum = (xs: Invoice[], k: 'gross' | 'vat' | 'net' = 'gross') => xs.reduce((n, i) => n + invoiceTotals(i)[k], 0);
  const outstanding = live.filter((i) => i.status !== 'paid');
  const overdue = live.filter((i) => isOverdue(i));
  const byClient = useMemo(() => {
    const m = new Map<string, { name: string; total: number; n: number; unpaid: number }>();
    for (const i of thisYear) { const e = m.get(i.clientId) ?? { name: i.client.name, total: 0, n: 0, unpaid: 0 }; e.total += invoiceTotals(i).gross; e.n++; if (i.status !== 'paid') e.unpaid += invoiceTotals(i).gross; m.set(i.clientId, e); }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [thisYear]);
  const months = Array.from({ length: 12 }, (_, k) => sum(thisYear.filter((i) => Number(i.issueDate.slice(5, 7)) === k + 1)));
  const max = Math.max(1, ...months);
  const vat = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of live) m.set(vatPeriod(i.issueDate), (m.get(vatPeriod(i.issueDate)) ?? 0) + invoiceTotals(i).vat);
    return [...m.entries()].filter(([, v]) => v > 0).slice(0, 4);
  }, [live]);
  const paidDays = live.filter((i) => i.paidAt).map((i) => (i.paidAt! - new Date(`${i.issueDate}T12:00:00`).getTime()) / 864e5);
  const avgDays = paidDays.length ? Math.round(paidDays.reduce((a, b) => a + b, 0) / paidDays.length) : null;
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <div className="grid grid-cols-2 gap-3 lg:col-span-2">
        {[['Invoiced in ' + year, eur(sum(thisYear)), `${thisYear.length} invoices`], ['Waiting to be paid', eur(sum(outstanding)), `${outstanding.length} invoices`],
          ['Overdue', eur(sum(overdue)), overdue.length ? `${overdue.length} need chasing` : 'nothing overdue'], ['Average time to get paid', avgDays == null ? '—' : `${avgDays} days`, `${paidDays.length} paid invoices`]].map(([k, v, s]) => (
          <div key={k} className="card p-4"><p className="text-xs font-semibold uppercase text-muted">{k}</p><p className="mt-1 text-2xl font-black tabular-nums">{v}</p><p className="text-xs text-muted">{s}</p></div>
        ))}
        <div className="card col-span-2 p-4">
          <p className="text-xs font-semibold uppercase text-muted">Invoiced per month, {year}</p>
          <div className="mt-3 flex h-28 items-end gap-1.5">
            {months.map((v, k) => (
              <div key={k} className="flex flex-1 flex-col items-center gap-1" title={`${eur(v)}`}>
                <div className="w-full rounded-t bg-ink" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0 }} />
                <span className="text-[10px] text-muted">{'JFMAMJJASOND'[k]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase text-muted">Top clients this year</p>
          {byClient.length === 0 ? <p className="mt-2 text-sm text-muted">No invoices yet.</p> : byClient.slice(0, 5).map((c) => (
            <p key={c.name} className="mt-2 flex justify-between text-sm"><span className="truncate">{c.name} <span className="text-muted">×{c.n}</span></span><span className="font-semibold tabular-nums">{eur(c.total)}</span></p>
          ))}
        </div>
        <div className="card p-4">
          <p className="text-xs font-semibold uppercase text-muted">VAT charged by return period</p>
          {vat.length === 0 ? <p className="mt-2 text-sm text-muted">No VAT charged yet.</p> : vat.map(([p, v]) => <p key={p} className="mt-2 flex justify-between text-sm"><span>{p}</span><span className="font-semibold tabular-nums">{eur(v)}</span></p>)}
        </div>
      </div>
    </section>
  );
}

export default function InvoicesPage() {
  const [list, setList] = useState<Invoice[] | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  useEffect(() => { void invoices.list().then(setList); }, []);
  const today = isoDate(new Date());
  const shown = (list ?? []).filter((i) => (status === 'all' || (status === 'overdue' ? isOverdue(i, today) : status === 'unpaid' ? ['approved', 'sent'].includes(i.status) : i.status === status))
    && (!q || `${i.number} ${i.client.name} ${i.items.map((x) => x.description).join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-3xl font-black">Invoices</h1><p className="text-muted">Only you can see this section.</p></div>
        <div className="flex gap-2">
          <Link to="/invoices/settings" className="btn-outline"><Settings size={16} />Settings</Link>
          <Link to="/invoices/new" className="btn-primary" data-testid="new-invoice"><Plus size={16} />New invoice</Link>
        </div>
      </div>
      {list === null ? <Spinner /> : (
        <>
          <div className="mt-6"><Analysis list={list} /></div>
          <div className="mt-8 flex flex-wrap items-center gap-2">
            {['all', 'unpaid', 'overdue', 'paid', 'draft', 'cancelled'].map((s) => <button key={s} onClick={() => setStatus(s)} className={`chip capitalize ${status === s ? 'bg-ink text-white' : 'bg-slate-100 text-ink-soft'}`}>{s}</button>)}
            <label className="relative ml-auto"><Search size={16} className="absolute left-3 top-2.5 text-muted" /><input className="input w-64 pl-9" placeholder="Search invoices" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search invoices" /></label>
          </div>
          {shown.length === 0 ? <div className="mt-4"><EmptyState title={list.length ? 'No invoices match' : 'No invoices yet'}>{list.length ? '' : 'Click New invoice. You’ll be asked who it’s for, how much, whether VAT is included and which account to pay into.'}</EmptyState></div> : (
            <div className="card mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-line text-left text-xs uppercase text-muted"><th className="p-3">Number</th><th className="p-3">Client</th><th className="p-3">Date</th><th className="p-3">Due</th><th className="p-3 text-right">Total</th><th className="p-3">Status</th></tr></thead>
                <tbody>{shown.map((i) => (
                  <tr key={i.id} className="border-b border-line last:border-0 hover:bg-slate-50">
                    <td className="p-3 font-semibold"><Link to={`/invoices/${i.id}`} className="hover:underline" data-testid="invoice-row">{i.number || 'Draft'}</Link></td>
                    <td className="p-3">{i.client.name}</td><td className="p-3">{longDate(i.issueDate)}</td><td className="p-3">{longDate(i.dueDate)}</td>
                    <td className="p-3 text-right font-semibold tabular-nums">{eur(invoiceTotals(i).gross)}</td><td className="p-3"><StatusChip inv={i} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
