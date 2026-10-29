import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../api';
import type { AppSettings, Booking } from '../../api/types';
import { useAsync } from '../../lib/useAsync';
import { fmt } from '../../domain/time';
import { ErrorNotice, Field, Notice, PageSpinner, Spinner, useToast } from '../../components/ui';
import { Section, Table, Td } from './shared';

type BookingRow = Booking & { profile: { full_name: string; email: string | null } | null; session: { title: string; starts_at: string } | null };

export function AdminBookings() {
  const [status, setStatus] = useState('');
  const list = useAsync(async () => {
    let q = supabase.from('bookings').select('*, profile:profiles(full_name,email), session:class_sessions(title,starts_at)').order('booked_at', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    return unwrap(await q) as BookingRow[];
  }, [status]);
  return (
    <Section title="Bookings & cancellations" actions={
      <select className="input min-h-10 py-1" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option><option value="booked">Booked</option><option value="cancelled">Cancelled</option>
        <option value="late_cancelled">Late cancelled</option><option value="attended">Attended</option><option value="no_show">No-show</option>
      </select>}>
      {list.loading && !list.data ? <PageSpinner /> : list.error ? <ErrorNotice error={list.error} /> : (
        <Table head={['Customer', 'Class', 'Class time', 'Status', 'Class returned', 'Booked at', 'Cancelled at']} empty={!list.data?.length}>
          {list.data?.map((b) => (
            <tr key={b.id}>
              <Td className="font-semibold">{b.profile?.full_name || b.profile?.email}</Td>
              <Td>{b.session?.title}</Td>
              <Td className="whitespace-nowrap">{b.session && fmt.dateTime(b.session.starts_at)}</Td>
              <Td>{b.status.replace('_', ' ')}{b.cancel_reason ? ` — ${b.cancel_reason}` : ''}</Td>
              <Td>{b.status.includes('cancel') || b.status === 'no_show' ? (b.class_restored ? 'Yes' : 'No') : ''}</Td>
              <Td className="whitespace-nowrap">{fmt.dateTime(b.booked_at)}</Td>
              <Td className="whitespace-nowrap">{b.cancelled_at ? fmt.dateTime(b.cancelled_at) : ''}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

interface AuditRow { id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string }

export function AdminAudit() {
  const [type, setType] = useState('');
  const list = useAsync(async () => {
    let q = supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(200);
    if (type) q = q.eq('entity_type', type);
    const rows = unwrap(await q) as AuditRow[];
    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
    const actors = actorIds.length ? unwrap(await supabase.from('profiles').select('id, full_name, email').in('id', actorIds)) as { id: string; full_name: string; email: string }[] : [];
    return rows.map((r) => ({ ...r, actor: actors.find((a) => a.id === r.actor_id) }));
  }, [type]);
  return (
    <Section title="Audit log" actions={
      <select className="input min-h-10 py-1" value={type} onChange={(e) => setType(e.target.value)}>
        <option value="">Everything</option>
        {['membership', 'booking', 'membership_plans', 'class_templates', 'class_sessions', 'dance_styles', 'instructors', 'app_settings', 'profile'].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>}>
      {list.loading && !list.data ? <PageSpinner /> : (
        <Table head={['When', 'Who', 'Action', 'Entity', 'Details']} empty={!list.data?.length}>
          {list.data?.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap">{fmt.dateTime(r.created_at)}</Td>
              <Td>{r.actor?.full_name || r.actor?.email || (r.actor_id ? r.actor_id.slice(0, 8) : 'System')}</Td>
              <Td className="font-semibold">{r.action.replace(/_/g, ' ')}</Td>
              <Td>{r.entity_type}</Td>
              <Td><details><summary className="cursor-pointer text-xs text-brand-700">View</summary><pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap text-[11px]">{JSON.stringify(r.details, null, 2)}</pre></details></Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

export function AdminSettings() {
  const toast = useToast();
  const s = useAsync(async () => unwrap(await supabase.from('app_settings').select('*').single()) as AppSettings, []);
  const [form, setForm] = useState<AppSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = form ?? s.data;
  if (s.loading || !f) return <PageSpinner />;
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setForm({ ...f, [k]: v });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { timezone: _tz, ...patch } = f!;
    void _tz;
    const { error } = await supabase.from('app_settings').update(patch).eq('id', true);
    setBusy(false);
    if (error) setError(error.message); else toast('Settings saved.');
  }

  return (
    <Section title="Booking & membership rules">
      <Notice tone="info">These rules apply immediately to bookings. Purchased memberships keep the activation policy they were bought under.</Notice>
      <form onSubmit={save} className="card mt-4 grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Booking window (days ahead)"><input className="input" type="number" min={1} max={90} value={f.booking_window_days} onChange={(e) => set('booking_window_days', Number(e.target.value))} /></Field>
        <Field label="Free cancellation until (minutes before class)"><input className="input" type="number" min={0} value={f.cancellation_cutoff_minutes} onChange={(e) => set('cancellation_cutoff_minutes', Number(e.target.value))} /></Field>
        <Field label="Membership validity starts">
          <select className="input" value={f.activation_policy} onChange={(e) => set('activation_policy', e.target.value as AppSettings['activation_policy'])}>
            <option value="on_purchase">On purchase (payment confirmed)</option>
            <option value="on_first_booking">On first booking</option>
          </select>
        </Field>
        <Field label="Max pause days per calendar year"><input className="input" type="number" min={0} value={f.max_pause_days_per_year} onChange={(e) => set('max_pause_days_per_year', Number(e.target.value))} /></Field>
        <Field label="Minimum pause length (days)"><input className="input" type="number" min={1} value={f.min_pause_days} onChange={(e) => set('min_pause_days', Number(e.target.value))} /></Field>
        <Field label="Expiry reminder (days before)"><input className="input" type="number" min={0} value={f.expiry_reminder_days} onChange={(e) => set('expiry_reminder_days', Number(e.target.value))} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.late_cancel_restores_class} onChange={(e) => set('late_cancel_restores_class', e.target.checked)} />Late cancellations get the class back</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.no_show_restores_class} onChange={(e) => set('no_show_restores_class', e.target.checked)} />No-shows get the class back</label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-5 w-5" checked={f.expiry_reminders_enabled} onChange={(e) => set('expiry_reminders_enabled', e.target.checked)} />Queue expiry reminder notifications (needs a sender — see deployment docs)</label>
        {error && <div className="sm:col-span-2"><ErrorNotice error={error} /></div>}
        <div className="sm:col-span-2"><button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save settings</button></div>
      </form>
    </Section>
  );
}
