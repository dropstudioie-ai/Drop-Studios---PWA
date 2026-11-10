import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { endsOn } from '../../domain/subscription';
import { adminRefund, manageSubscription } from '../../lib/payments';
import { supabase, AppError } from '../../lib/supabase';
import { api, unwrap } from '../../api';
import type { Membership, MembershipPlan, Profile } from '../../api/types';
import { useAsync } from '../../lib/useAsync';
import { formatPrice, parseEurosToCents } from '../../domain/money';
import { fmt, formatKey } from '../../domain/time';
import { MembershipCard } from '../../components/MembershipCard';
import { PauseSheet } from '../../components/PauseSheet';
import { ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner, TestBadge, useToast } from '../../components/ui';
import { Section, Table, Td } from './shared';
import { Avatar } from '../../components/Avatar';

export default function AdminCustomers() {
  const [q, setQ] = useState('');
  // ?user=<id> opens a customer directly (used by the "payment to review" email).
  const [search, setSearch] = useSearchParams();
  const selected = search.get('user');
  const setSelected = (id: string | null) => setSearch(id ? { user: id } : {});
  const list = useAsync(async () => {
    let query = supabase.from('profiles').select('*, memberships(id, classes_remaining, expires_at, admin_status)').order('created_at', { ascending: false }).limit(100);
    const term = q.trim().replace(/[%,()]/g, '');
    if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
    return unwrap(await query) as (Profile & { memberships: Pick<Membership, 'id' | 'classes_remaining' | 'expires_at' | 'admin_status'>[] })[];
  }, [q]);

  if (selected) return <CustomerDetail userId={selected} onBack={() => setSelected(null)} />;

  return (
    <Section title="Customers">
      <input className="input mb-3 max-w-md" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.loading && !list.data ? <PageSpinner /> : list.error ? <ErrorNotice error={list.error} /> : (
        <Table head={['Name', 'Email', 'Role', 'Classes available', 'Joined', '']} empty={!list.data?.length}>
          {list.data?.map((p) => {
            const now = new Date();
            const available = p.memberships
              .filter((m) => m.admin_status === 'valid' && (!m.expires_at || new Date(m.expires_at) > now))
              .reduce((s, m) => s + m.classes_remaining, 0);
            return (
              <tr key={p.id}>
                <Td className="font-semibold"><span className="flex items-center gap-2"><Avatar path={p.avatar_path} name={p.full_name} size={28} />{p.full_name || '—'}{!p.avatar_path && <span className="chip bg-accent-50 text-xs font-medium">No photo</span>}</span></Td>
                <Td>{p.email}</Td>
                <Td className="capitalize">{p.role}</Td>
                <Td className="tabular-nums">{available}</Td>
                <Td>{fmt.date(p.created_at)}</Td>
                <Td><button className="btn-sm btn-ghost" onClick={() => setSelected(p.id)}>Open</button></Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

interface LedgerRow { id: number; membership_id: string; delta: number; balance_after: number; kind: string; reason: string | null; created_at: string }
interface PaymentRow { id: string; amount_cents: number; currency: string; provider: string; status: string; is_test: boolean; created_at: string; completed_at: string | null; provider_payment_ref: string | null; plan_snapshot: { plan_name: string }; review_reason: string | null; failure_reason: string | null }

function CustomerDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const toast = useToast();
  const data = useAsync(async () => {
    const [profile, memberships, bookings, styles, ledger, payments, allowance, plans, subscriptions] = await Promise.all([
      api.profile(userId),
      api.myMemberships(userId),
      api.myBookings(userId),
      unwrap(await supabase.from('dance_styles').select('*').order('sort_order')),
      unwrap(await supabase.from('credit_transactions').select('*').eq('user_id', userId).order('id', { ascending: false }).limit(100)) as LedgerRow[],
      unwrap(await supabase.from('payments').select('*').eq('user_id', userId).order('created_at', { ascending: false })) as PaymentRow[],
      api.pauseAllowance(userId),
      unwrap(await supabase.from('membership_plans').select('*').order('sort_order')) as MembershipPlan[],
      api.mySubscriptions(userId),
    ]);
    return { profile, memberships, bookings, styles, ledger, payments, allowance, plans, subscriptions };
  }, [userId]);

  const [adjusting, setAdjusting] = useState<Membership | null>(null);
  const [pausing, setPausing] = useState<Membership | null>(null);
  const [selling, setSelling] = useState(false);

  if (data.loading && !data.data) return <PageSpinner />;
  if (data.error) return <ErrorNotice error={data.error} />;
  const d = data.data!;

  async function resume(m: Membership) {
    const reason = window.prompt('Reason for ending the pause:');
    if (reason === null) return;
    try {
      await api.resume(m.id, reason || 'Admin resumed');
      toast('Pause ended.');
      void data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function endNow(subscriptionId: string, planName: string) {
    const reason = window.prompt(`Stop ${planName} from the next payment date (no more payments)? Reason, e.g. "Asked at reception" (saved in the audit log):`);
    if (!reason?.trim()) return;
    try {
      const r = await manageSubscription('end_now', subscriptionId, reason);
      toast(`Done: no more payments. The membership ends on ${r.ends_on}.`);
      void data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function refund(p: PaymentRow) {
    const full = (p.amount_cents / 100).toFixed(2);
    const amount = window.prompt(`Refund how much of €${full} for ${p.plan_snapshot?.plan_name}? (e.g. ${full})`, full);
    if (amount === null) return;
    const cents = Math.round(Number(amount.replace(',', '.')) * 100);
    if (!(cents > 0 && cents <= p.amount_cents)) { toast('Enter an amount up to the payment amount.', 'error'); return; }
    const reason = window.prompt('Reason for the refund (saved in the audit log and sent to Square):');
    if (!reason?.trim()) return;
    try {
      await adminRefund(p.id, cents, reason);
      toast(`Refund of €${(cents / 100).toFixed(2)} sent to Square. It appears here once Square confirms it. Adjust their classes if needed.`);
      void data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function cancelCheckout(p: PaymentRow) {
    if (!window.confirm(`Cancel this unfinished checkout for ${p.plan_snapshot?.plan_name}? Nothing has been paid on it. The member can start a new one at any time.`)) return;
    try {
      unwrap(await supabase.rpc('admin_cancel_checkout', { p_payment_id: p.id }));
      toast('Checkout cancelled.');
      void data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function resolveReview(p: PaymentRow) {
    const note = window.prompt('What did you do? (e.g. "Refunded in Square, removed 3 classes") — saved in the audit log');
    if (!note?.trim()) return;
    try {
      unwrap(await supabase.rpc('admin_resolve_payment_review', { p_payment_id: p.id, p_note: note }));
      toast('Marked as reviewed.');
      void data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function setRole(role: Profile['role']) {
    if (!window.confirm(`Change role to ${role}?`)) return;
    try {
      unwrap(await supabase.rpc('admin_set_role', { p_user_id: userId, p_role: role }));
      toast(role === 'instructor'
        ? 'Now an instructor. Next: Admin → Instructors → Edit their name → choose this account under App login, so they see their classes.'
        : 'Role updated.');
      void data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
      <button className="mb-4 text-sm font-semibold text-brand-700" onClick={onBack}>← All customers</button>
      <div className="card mb-6 flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="flex items-center gap-3">
            <Avatar path={d.profile.avatar_path} name={d.profile.full_name} size={56} />
            <h2 className="text-xl font-black">{d.profile.full_name || d.profile.email}</h2>
          </div>
          <p className="text-sm text-muted">{d.profile.email}{d.profile.phone ? ` · ${d.profile.phone}` : ''} · joined {fmt.date(d.profile.created_at)}</p>
          <p className="mt-1 text-sm">Pause days used in {d.allowance.year}: {d.allowance.used_days} / {d.allowance.max_days}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm"><span className="label">Role</span>
            <select className="input" value={d.profile.role} onChange={(e) => void setRole(e.target.value as Profile['role'])}>
              <option value="customer">Customer</option><option value="instructor">Instructor</option><option value="admin">Admin</option>
            </select>
          </label>
          <button className="btn-sm btn-primary" onClick={() => setSelling(true)}>Record in-studio sale</button>
        </div>
      </div>

      {d.subscriptions.length > 0 && (
        <Section title="Monthly memberships">
          <Table head={['Plan', 'Status', 'Payments', 'Next payment', 'Ends', '']} empty={false}>
            {d.subscriptions.map((s) => {
              const ends = endsOn(s);
              return (
                <tr key={s.id}>
                  <Td className="font-semibold">{s.plan_snapshot.plan_name} · {formatPrice(s.plan_snapshot.price_cents, s.plan_snapshot.currency)}/month</Td>
                  <Td>{s.status === 'cancel_scheduled' ? 'ending' : s.status === 'past_due' ? 'payment failed' : s.status === 'ended' ? `ended (${s.end_reason ?? '—'})` : s.status}</Td>
                  <Td>{s.periods_paid} of {s.total_periods}</Td>
                  <Td>{s.next_billing_on ? formatKey(s.next_billing_on) : '—'}</Td>
                  <Td>{ends ? formatKey(ends) : '—'}</Td>
                  <Td>{s.status !== 'ended' && !s.provider_cancel_sent_at && s.next_billing_on && (
                    <button className="btn-sm btn-ghost text-danger" onClick={() => void endNow(s.id, s.plan_snapshot.plan_name)}>Stop payments now</button>
                  )}</Td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-2 text-xs text-muted">Members can cancel themselves in the app (at least 72 hours before a payment). “Stop payments now” cancels from the next payment date whatever the notice, e.g. when they ask by email or at reception.</p>
        </Section>
      )}

      <Section title="Memberships">
        <div className="grid gap-4 lg:grid-cols-2">
          {d.memberships.length === 0 && <p className="text-sm text-muted">No memberships.</p>}
          {d.memberships.map((m) => (
            <div key={m.id}>
              <MembershipCard m={m} styles={d.styles} reminderDays={0} onPause={() => setPausing(m)} onResume={() => void resume(m)} />
              <button className="btn-sm btn-outline mt-2" onClick={() => setAdjusting(m)}>Grant / revoke classes</button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Bookings">
        <Table head={['Class', 'When', 'Status', 'Booked']} empty={!d.bookings.length}>
          {d.bookings.slice(0, 50).map((b) => (
            <tr key={b.id}>
              <Td className="font-semibold">{b.session?.title}</Td>
              <Td>{b.session && fmt.dateTime(b.session.starts_at)}</Td>
              <Td>{b.status.replace('_', ' ')}{b.class_restored ? ' (returned)' : ''}{b.cancel_reason ? ` — ${b.cancel_reason}` : ''}</Td>
              <Td>{fmt.dateTime(b.booked_at)}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Class allowance history">
        <Table head={['When', 'Change', 'Balance', 'Type', 'Reason']} empty={!d.ledger.length}>
          {d.ledger.map((l) => (
            <tr key={l.id}>
              <Td>{fmt.dateTime(l.created_at)}</Td>
              <Td className={`tabular-nums font-semibold ${l.delta > 0 ? 'text-success' : 'text-danger'}`}>{l.delta > 0 ? `+${l.delta}` : l.delta}</Td>
              <Td className="tabular-nums">{l.balance_after}</Td>
              <Td>{l.kind.replace(/_/g, ' ')}</Td>
              <Td>{l.reason ?? ''}</Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Payments">
        {d.payments.some((p) => p.review_reason) && (
          <div className="mb-3"><Notice tone="warn">
            A payment was made on a checkout that had already been replaced or cancelled. It was accepted. If the member now has two of the
            same purchase (for example a second Intro Offer), refund one in the Square Dashboard and adjust their classes, then tap <strong>Mark reviewed</strong>.
          </Notice></div>
        )}
        <Table head={['Created', 'Plan', 'Amount', 'Provider', 'Status', 'Reference', '']} empty={!d.payments.length}>
          {d.payments.map((p) => (
            <tr key={p.id}>
              <Td>{fmt.dateTime(p.created_at)}</Td>
              <Td>{p.plan_snapshot?.plan_name}</Td>
              <Td className="tabular-nums">{formatPrice(p.amount_cents, p.currency, { forceDecimals: true })}</Td>
              <Td>{p.provider} {p.is_test && <TestBadge />}</Td>
              <Td>
                {p.status === 'pending' ? 'unfinished' : p.status}
                {p.failure_reason && <span className="block text-xs text-muted">{p.failure_reason}</span>}
                {p.review_reason && <span className="chip mt-1 bg-accent-100 text-ink">Needs review</span>}
              </Td>
              <Td className="max-w-40 truncate text-xs">{p.provider_payment_ref ?? '—'}</Td>
              <Td>
                {p.status === 'pending' && <button className="btn-sm btn-ghost text-danger" onClick={() => void cancelCheckout(p)}>Cancel checkout</button>}
                {p.review_reason && <button className="btn-sm btn-ghost" onClick={() => void resolveReview(p)}>Mark reviewed</button>}
                {p.status === 'succeeded' && p.provider === 'square' && p.amount_cents > 0 && (
                  <button className="btn-sm btn-ghost" onClick={() => void refund(p)}>Refund</button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Section>

      {adjusting && <AdjustSheet m={adjusting} onClose={() => setAdjusting(null)} onDone={() => { toast('Classes updated.'); void data.reload(); }} />}
      {pausing && <PauseSheet membership={pausing} allowance={d.allowance} adminOverride onClose={() => setPausing(null)} onDone={() => { toast('Membership paused.'); void data.reload(); }} />}
      {selling && <ManualSaleSheet userId={userId} plans={d.plans} styles={d.styles as { id: string; name: string }[]} onClose={() => setSelling(false)} onDone={() => { toast('Sale recorded.'); void data.reload(); }} />}
    </>
  );
}

function AdjustSheet({ m, onClose, onDone }: { m: Membership; onClose: () => void; onDone: () => void }) {
  const [delta, setDelta] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Sheet open onClose={onClose} title="Grant or revoke classes">
      <p className="text-sm">{m.plan_name} — currently {m.classes_remaining} of {m.classes_total} remaining.</p>
      <div className="mt-4 space-y-3">
        <Field label="Change" hint="Positive to grant, negative to revoke."><input className="input" type="number" value={delta} onChange={(e) => setDelta(Number(e.target.value))} /></Field>
        <Field label="Reason (required, recorded in audit log)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <ErrorNotice error={error} />}
        <button className="btn-primary w-full" disabled={busy || !delta || !reason.trim()} onClick={async () => {
          setBusy(true);
          try {
            unwrap(await supabase.rpc('admin_adjust_classes', { p_membership_id: m.id, p_delta: delta, p_reason: reason }));
            onDone();
            onClose();
          } catch (e) {
            setError(e instanceof AppError ? e.message : (e as Error).message);
            setBusy(false);
          }
        }}>{busy && <Spinner />}{delta > 0 ? `Grant ${delta}` : `Revoke ${Math.abs(delta)}`}</button>
      </div>
    </Sheet>
  );
}

function ManualSaleSheet({ userId, plans, styles, onClose, onDone }: {
  userId: string; plans: MembershipPlan[]; styles: { id: string; name: string }[]; onClose: () => void; onDone: () => void;
}) {
  const [planId, setPlanId] = useState(plans.find((p) => p.is_active)?.id ?? '');
  const plan = plans.find((p) => p.id === planId);
  const [amount, setAmount] = useState(plan ? (plan.price_cents / 100).toFixed(2) : '');
  const [styleId, setStyleId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Record in-studio sale">
      <Notice tone="info">Use this for real payments taken at the desk (cash or card terminal). It creates a membership and a “manual” payment record.</Notice>
      <div className="mt-4 space-y-3">
        <Field label="Plan"><select className="input" value={planId} onChange={(e) => { setPlanId(e.target.value); const p = plans.find((x) => x.id === e.target.value); if (p) setAmount((p.price_cents / 100).toFixed(2)); }}>
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatPrice(p.price_cents)}{p.is_active ? '' : ' (disabled)'}</option>)}
        </select></Field>
        {plan?.style_access === 'single' && (
          <Field label="Dance style"><select className="input" value={styleId} onChange={(e) => setStyleId(e.target.value)}><option value="">Choose…</option>{styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        )}
        <Field label="Amount received (€)"><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Note (e.g. 'Cash, receipt #123')"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <ErrorNotice error={error} />}
        <button className="btn-primary w-full" disabled={busy || !reason.trim() || !planId} onClick={async () => {
          const cents = parseEurosToCents(amount);
          if (cents === null) return setError('Enter a valid amount.');
          setBusy(true);
          try {
            unwrap(await supabase.rpc('admin_record_manual_sale', { p_user_id: userId, p_plan_id: planId, p_selected_style_id: styleId || null, p_amount_cents: cents, p_reason: reason }));
            onDone();
            onClose();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}>{busy && <Spinner />}Record sale</button>
      </div>
    </Sheet>
  );
}
