import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../api';
import { useAsync } from '../../lib/useAsync';
import { formatPrice } from '../../domain/money';
import { addDaysToKey, localDateKey } from '../../domain/time';
import { ErrorNotice, Notice, PageSpinner } from '../../components/ui';
import { Section, Table, Td } from './shared';

interface Analytics {
  revenue_cents: number;
  sales: number;
  test_payments_excluded: number;
  sales_by_plan: { plan_name: string; plan_code: string; sales: number; revenue_cents: number }[];
  intro_conversion: { intro_customers: number; converted: number; rate: number } | null;
  membership_usage: { finished_memberships: number; avg_classes_used: number; avg_classes_available: number; expired_with_unused_classes: number; repeat_purchase_rate: number } | null;
  classes: { sessions: number; capacity: number; booked: number; occupancy_rate: number; cancellations: number; late_cancellations: number; no_shows: number; cancelled_by_studio: number } | null;
  attended_classes: number;
  unmarked_past_bookings: number;
  revenue_per_attended_class_cents: number | null;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function Stat({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      {value === null
        ? <p className="mt-1 text-lg font-semibold text-muted">No data yet</p>
        : <p className="mt-1 font-display text-2xl font-black text-ink">{value}</p>}
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </div>
  );
}

export default function Overview() {
  const today = localDateKey(new Date());
  const [from, setFrom] = useState(addDaysToKey(today, -29));
  const [to, setTo] = useState(today);
  const a = useAsync(async () => unwrap(await supabase.rpc('admin_analytics', { p_from: from, p_to: to })) as Analytics, [from, to]);
  const tickets = useAsync(async () => unwrap(await supabase.rpc('admin_ticket_sales', { p_from: from, p_to: to })) as {
    tickets_sold: number; ticket_revenue_cents: number; drop_ins_sold: number; drop_in_revenue_cents: number; refunds_to_review: number;
  }, [from, to]);
  const t = tickets.data;

  const d = a.data;
  const maxRevenue = Math.max(1, ...(d?.sales_by_plan.map((p) => p.revenue_cents) ?? [1]));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm"><span className="label">To</span><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {a.loading && !d ? <PageSpinner /> : a.error ? <ErrorNotice error={a.error} onRetry={a.reload} /> : d && (
        <>
          {t && t.refunds_to_review > 0 && <div className="mb-4"><Notice tone="warn">{t.refunds_to_review} paid class{t.refunds_to_review === 1 ? '' : 'es'} (tickets or Drop Ins) need a refund in Square. See the Audit log (“ticket refund required”).</Notice></div>}
          {d.test_payments_excluded > 0 && <div className="mb-4"><Notice tone="test">{d.test_payments_excluded} TEST payment(s) in this period are excluded from all revenue figures.</Notice></div>}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue" value={formatPrice(d.revenue_cents, 'EUR', { forceDecimals: true })}
              note={t && (t.tickets_sold + t.drop_ins_sold) > 0
                ? `${d.sales - t.tickets_sold - t.drop_ins_sold} memberships · ${t.drop_ins_sold} Drop Ins · ${t.tickets_sold} tickets`
                : `${d.sales} membership sales`} />
            <Stat label="Revenue / attended class" value={d.revenue_per_attended_class_cents === null ? null : formatPrice(d.revenue_per_attended_class_cents, 'EUR', { forceDecimals: true })}
              note={d.unmarked_past_bookings ? `${d.unmarked_past_bookings} past bookings not marked attended yet` : `${d.attended_classes} attended`} />
            <Stat label="Class occupancy" value={d.classes ? pct(d.classes.occupancy_rate) : null} note={d.classes ? `${d.classes.booked} of ${d.classes.capacity} spots, ${d.classes.sessions} classes` : 'No past classes in range'} />
            <Stat label="Intro conversion" value={d.intro_conversion ? pct(d.intro_conversion.rate) : null}
              note={d.intro_conversion ? `${d.intro_conversion.converted} of ${d.intro_conversion.intro_customers} bought again` : 'No intro sales in range'} />
            <Stat label="Avg classes used" value={d.membership_usage ? `${d.membership_usage.avg_classes_used} / ${d.membership_usage.avg_classes_available}` : null}
              note={d.membership_usage ? `${d.membership_usage.finished_memberships} finished memberships` : 'No finished memberships yet'} />
            <Stat label="Repeat purchase rate" value={d.membership_usage ? pct(d.membership_usage.repeat_purchase_rate) : null} />
            <Stat label="Expired with unused classes" value={d.membership_usage ? String(d.membership_usage.expired_with_unused_classes) : null} />
            <Stat label="Cancellations" value={d.classes ? String(d.classes.cancellations) : null}
              note={d.classes ? `${d.classes.late_cancellations} late · ${d.classes.no_shows} no-shows · ${d.classes.cancelled_by_studio} ${d.classes.cancelled_by_studio === 1 ? 'class' : 'classes'} cancelled by studio` : undefined} />
          </div>

          {t && (t.tickets_sold > 0 || t.drop_ins_sold > 0) && (
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Drop Ins" value={String(t.drop_ins_sold)} note={`${formatPrice(t.drop_in_revenue_cents, 'EUR', { forceDecimals: true })} revenue`} />
              <Stat label="Workshop tickets" value={String(t.tickets_sold)} note={`${formatPrice(t.ticket_revenue_cents, 'EUR', { forceDecimals: true })} revenue`} />
            </div>
          )}

          <div className="mt-8">
            <Section title="Revenue by plan">
              {d.sales_by_plan.length === 0 ? <p className="text-sm text-muted">No sales in this period.</p> : (
                <>
                  <ul className="card space-y-3 p-4" aria-label="Revenue by plan">
                    {d.sales_by_plan.map((p) => (
                      <li key={p.plan_code} className="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_5rem]"
                        title={`${p.plan_name}: ${formatPrice(p.revenue_cents, 'EUR', { forceDecimals: true })} from ${p.sales} sales`}>
                        <span className="truncate font-semibold text-ink-soft">{p.plan_name}</span>
                        <span className="h-4 rounded-r bg-canvas">
                          <span className="block h-4 rounded-r-[4px] bg-brand-600" style={{ width: `${(p.revenue_cents / maxRevenue) * 100}%` }} />
                        </span>
                        <span className="text-right tabular-nums font-semibold text-ink">{formatPrice(p.revenue_cents)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3">
                    <Table head={['Plan', 'Sales', 'Revenue']}>
                      {d.sales_by_plan.map((p) => (
                        <tr key={p.plan_code}><Td>{p.plan_name}</Td><Td className="tabular-nums">{p.sales}</Td><Td className="tabular-nums">{formatPrice(p.revenue_cents, 'EUR', { forceDecimals: true })}</Td></tr>
                      ))}
                    </Table>
                  </div>
                </>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  );
}
