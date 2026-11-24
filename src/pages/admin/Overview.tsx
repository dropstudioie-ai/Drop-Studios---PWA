import { ticketChoices } from '../../lib/ticketChoices';
import { adminRefund } from '../../lib/payments';
import { useAuth } from '../../auth/AuthProvider';
import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../api';
import { useAsync } from '../../lib/useAsync';
import { formatPrice } from '../../domain/money';
import { addDaysToKey, fmt, localDateKey } from '../../domain/time';
import { ErrorNotice, Notice, PageSpinner, useToast } from '../../components/ui';
import { Section, Table, Td } from './shared';
import { SurveyResults } from './SurveyResults';

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
  const { canViewFinance } = useAuth();
  if (!canViewFinance) return <ManagerOverview />;
  return <SalesOverview />;
}

function ManagerOverview() {
  const links: [string, string][] = [['Members', '/admin/customers'], ['Timetable', '/admin/timetable'], ['Bookings', '/admin/bookings'], ['Events', '/admin/events'],
    ['Instructors', '/admin/instructors'], ['Styles', '/admin/styles'], ['Audit log', '/admin/audit'], ['Settings', '/admin/settings']];
  return (
    <div>
      <SurveyResults />
      <p className="max-w-2xl text-sm text-ink-soft">You’re a <strong>Manager</strong>: you can run classes, members, bookings and events. Sales, payments, refunds and earnings are only visible to full admins.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {links.map(([label, to]) => <Link key={to} to={to} className="card p-4 text-center font-semibold hover:shadow-md">{label}</Link>)}
      </div>
    </div>
  );
}

function SalesOverview() {
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
      <SurveyResults />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="label">From</span><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm"><span className="label">To</span><input type="date" className="input" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {a.loading && !d ? <PageSpinner /> : a.error ? <ErrorNotice error={a.error} onRetry={a.reload} /> : d && (
        <>
          <PaymentsToReview />
          <CancelledPaidClasses />
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

/** Cancelled paid classes: waiting for the member to choose (credit or refund), and refunds to do in Square. */
function CancelledPaidClasses() {
  const toast = useToast();
  const list = useAsync(() => ticketChoices.open(), []);
  const rows = list.data ?? [];
  useScrollToHash('refunds', rows.length > 0);
  if (!rows.length) return null;
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast(msg); list.reload(); } catch (e) { toast((e as Error).message, 'error'); } };
  return (
    <div id="refunds" className="mb-6 scroll-mt-20 rounded-2xl border-2 border-accent-500 bg-accent-50 p-4">
      <p className="font-bold">Cancelled paid classes</p>
      <ul className="mt-2 divide-y divide-accent-500/30 text-sm">
        {rows.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><Link className="font-semibold underline" to={`/admin/customers?user=${c.user_id}`}>{c.member?.full_name ?? 'Member'}</Link> · {c.class_title}, {fmt.dateTime(c.class_starts_at)} · {formatPrice(c.amount_cents, 'EUR')}
              <span className="block text-xs text-muted">{c.status === 'waiting' ? 'Waiting for them to choose a class credit or a refund (asked by email and in the app)' : c.status === 'refund_requested' ? '💶 They cancelled their Drop In and ask for a refund: approve (refunds their card) or decline (they get a class credit)' : 'Chose a refund: refund it in Square (member → Payments → Refund)'}</span></span>
            {c.status === 'refund_requested' ? (
              <span className="flex gap-2">
                <button className="btn-primary btn-sm" onClick={() => void act(async () => {
                  if (!confirm(`Refund ${formatPrice(c.amount_cents, 'EUR')} to ${c.member?.full_name ?? 'this member'}'s card?`)) throw new Error('Not refunded');
                  await adminRefund(c.payment_id, c.amount_cents, `Drop In cancelled by member: ${c.class_title}`);
                  await ticketChoices.decideRefund(c.id, true);
                }, 'Refunded and member told')}>Approve &amp; refund</button>
                <button className="btn-outline btn-sm" onClick={() => void act(() => ticketChoices.decideRefund(c.id, false, prompt('Note for them (optional)') ?? undefined), 'Declined: class credit given and member told')}>Decline (give credit)</button>
              </span>
            ) : c.status === 'waiting' ? (
              <span className="flex gap-2">
                <button className="btn-outline btn-sm" onClick={() => void act(() => ticketChoices.adminChoose(c.id, true), 'Class credit given (valid 1 month)')}>Give credit</button>
                <button className="btn-ghost btn-sm" onClick={() => void act(() => ticketChoices.adminChoose(c.id, false), 'Marked as refund')}>They want a refund</button>
              </span>
            ) : <button className="btn-primary btn-sm" onClick={() => void act(() => ticketChoices.markRefunded(c.id), 'Marked refunded')}>Refunded ✓</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

const REVIEW_REASON: Record<string, string> = {
  paid_after_cancel: 'Paid after the booking had already been cancelled (the hold ran out). Check they have a booking or a credit, or refund them.',
  rental_slot_lost: 'Paid for a studio rental, but someone else took one of the slots. Move them or refund that date.',
};

/** Payments flagged by the system: open the member to sort it, then mark it reviewed. */
function PaymentsToReview() {
  const toast = useToast();
  const list = useAsync(async () => unwrap(await supabase.from('payments').select('id, amount_cents, currency, kind, created_at, review_reason, user_id, plan_snapshot, member:profiles!payments_user_id_fkey(full_name)').not('review_reason', 'is', null).order('created_at')) as unknown as
    { id: string; amount_cents: number; currency: string; kind: string; created_at: string; review_reason: string; user_id: string; plan_snapshot: { plan_name?: string } | null; member: { full_name: string | null } | null }[], []);
  const rows = list.data ?? [];
  useScrollToHash('review', rows.length > 0);
  if (!rows.length) return null;
  const resolve = async (id: string) => {
    const note = prompt('What did you do? (e.g. “She’s booked for Wed 2 Dec”, “Refunded”)');
    if (note === null) return;
    try { unwrap(await supabase.rpc('admin_resolve_payment_review', { p_payment_id: id, p_note: note || 'Reviewed' })); toast('Marked reviewed'); list.reload(); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <div id="review" className="mb-6 scroll-mt-20 rounded-2xl border-2 border-danger bg-red-50 p-4">
      <p className="font-bold">💳 Payments to review</p>
      <ul className="mt-2 divide-y divide-danger/20 text-sm">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><Link className="font-semibold underline" to={`/admin/customers?user=${p.user_id}`}>{p.member?.full_name ?? 'Member'}</Link> · {p.plan_snapshot?.plan_name ?? p.kind} · {formatPrice(p.amount_cents, p.currency)} · {fmt.date(p.created_at)}
              <span className="block text-xs text-muted">{REVIEW_REASON[p.review_reason] ?? p.review_reason}</span></span>
            <span className="flex gap-2">
              <Link className="btn-outline btn-sm" to={`/admin/customers?user=${p.user_id}`}>Open member</Link>
              <button className="btn-primary btn-sm" onClick={() => void resolve(p.id)}>Mark reviewed</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Links like /admin#review jump to their section once it has loaded. */
function useScrollToHash(id: string, ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (ready && hash === `#${id}`) document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [ready, hash, id]);
}
