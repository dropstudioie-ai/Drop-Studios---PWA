import { formatKey, localDateKey } from '../../domain/time';
import { useState } from 'react';
import { supabase, AppError } from '../../lib/supabase';
import { unwrap } from '../../api';
import type { DanceStyle, Instructor } from '../../api/types';
import { useAsync } from '../../lib/useAsync';
import { formatPrice, parseEurosToCents } from '../../domain/money';
import { ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner, useToast } from '../../components/ui';
import { Link } from 'react-router-dom';
import { Section, Table, Td } from './shared';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function AdminStyles() {
  const toast = useToast();
  const list = useAsync(async () => unwrap(await supabase.from('dance_styles').select('*').order('sort_order')) as DanceStyle[], []);
  const [edit, setEditState] = useState<Partial<DanceStyle> | null>(null);
  const [dropInText, setDropInText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setEdit = (v: Partial<DanceStyle> | null) => {
    // Reset the price box when a different style (or a new one) is opened.
    if (v && (edit === null || v.id !== edit.id)) setDropInText(v.drop_in_price_cents != null ? (v.drop_in_price_cents / 100).toFixed(2) : '');
    setEditState(v);
  };

  async function save() {
    if (!edit?.name?.trim()) return;
    const dropIn = dropInText.trim() ? parseEurosToCents(dropInText) : null;
    if (dropInText.trim() && dropIn === null) return setError('Enter a valid Drop In price, e.g. 15 or 15.50, or leave it empty.');
    const row = { name: edit.name.trim(), slug: edit.slug || slugify(edit.name), color: edit.color ?? '#2F5BFF', description: edit.description || null, level: edit.level || null, what_to_wear: edit.what_to_wear || null, what_to_bring: edit.what_to_bring || null, first_class: edit.first_class || null, is_active: edit.is_active ?? true, sort_order: edit.sort_order ?? 100, drop_in_price_cents: dropIn };
    const res = edit.id ? await supabase.from('dance_styles').update(row).eq('id', edit.id) : await supabase.from('dance_styles').insert(row);
    if (res.error) return setError(res.error.message);
    toast('Style saved.');
    setEdit(null);
    void list.reload();
  }

  if (list.loading) return <PageSpinner />;
  return (
    <Section title="Dance styles" actions={<button className="btn-sm btn-primary" onClick={() => { setError(null); setEdit({ is_active: true }); }}>Add style</button>}>
      <Table head={['', 'Style', 'Drop In', 'Order', 'Status', '']} empty={!list.data?.length}>
        {list.data?.map((s) => (
          <tr key={s.id} className={s.is_active ? '' : 'opacity-50'}>
            <Td><span className="inline-block h-4 w-4 rounded-full" style={{ background: s.color }} /></Td>
            <Td className="font-semibold">{s.name}</Td>
            <Td className="tabular-nums">{s.drop_in_price_cents != null ? formatPrice(s.drop_in_price_cents) : '—'}</Td>
            <Td>{s.sort_order}</Td>
            <Td>{s.is_active ? 'Active' : 'Hidden'}</Td>
            <Td><button className="btn-sm btn-ghost" onClick={() => { setError(null); setEdit(s); }}>Edit</button></Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Sheet open onClose={() => setEdit(null)} title={edit.id ? 'Edit style' : 'Add style'}>
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Colour"><input className="input h-12 p-1" type="color" value={edit.color ?? '#2F5BFF'} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
            <Field label="Drop In price (€)" hint="Price of a single class in this style. Leave empty to not sell Drop Ins."><input className="input" inputMode="decimal" value={dropInText} onChange={(e) => setDropInText(e.target.value)} placeholder="e.g. 15" /></Field>
            <Field label="Display order"><input className="input" type="number" value={edit.sort_order ?? 100} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></Field>
            <Field label="Description" hint="Shown on the public class page. The instructors are asked to check it."><textarea className="input min-h-28 py-2" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <Field label="Level"><input className="input" value={edit.level ?? ''} onChange={(e) => setEdit({ ...edit, level: e.target.value })} /></Field>
            <Field label="What to wear"><textarea className="input py-2" rows={2} value={edit.what_to_wear ?? ''} onChange={(e) => setEdit({ ...edit, what_to_wear: e.target.value })} /></Field>
            <Field label="What to bring"><textarea className="input py-2" rows={2} value={edit.what_to_bring ?? ''} onChange={(e) => setEdit({ ...edit, what_to_bring: e.target.value })} /></Field>
            <Field label="First class tips"><textarea className="input py-2" rows={3} value={edit.first_class ?? ''} onChange={(e) => setEdit({ ...edit, first_class: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Active</label>
            {error && <ErrorNotice error={error} />}
            <button className="btn-primary w-full" onClick={save}>Save</button>
          </div>
        </Sheet>
      )}
    </Section>
  );
}

type InstructorRow = Instructor & { profile: { email: string | null; full_name: string } | null };

function BirthdayCell({ b, linked }: { b?: { date_of_birth: string | null; next_birthday: string | null }; linked: boolean }) {
  if (!linked) return <span className="text-muted">—</span>;
  if (!b?.date_of_birth) return <span className="chip bg-accent-100 text-ink">Not added yet</span>;
  const day = formatKey(b.date_of_birth, { day: 'numeric', month: 'long' });
  const days = b.next_birthday ? Math.round((Date.parse(b.next_birthday) - Date.parse(localDateKey(new Date()))) / 86_400_000) : null;
  return <span>🎂 {day}{days === 0 ? ' · today!' : days !== null && days <= 7 ? ` · in ${days} day${days === 1 ? '' : 's'}` : ''}</span>;
}

const WEEKDAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type StaffAccount = { id: string; email: string | null; full_name: string; role: string };
type TaughtClass = { instructor_id: string | null; title: string; weekday: number; start_time: string };

export function AdminInstructors() {
  const toast = useToast();
  const list = useAsync(async () =>
    unwrap(await supabase.from('instructors').select('*, profile:profiles(email,full_name)').order('full_name')) as InstructorRow[], []);
  // Birthdays are private, so they come from an admin-only function, not the public instructors table.
  const birthdays = useAsync(async () =>
    unwrap(await supabase.rpc('admin_instructor_birthdays')) as { instructor_id: string; date_of_birth: string | null; next_birthday: string | null }[], []);
  const birthdayOf = (id: string) => birthdays.data?.find((b) => b.instructor_id === id);
  // Accounts that can be linked (role instructor or admin), and the weekly classes each instructor teaches.
  const refs = useAsync(async () => {
    const [accounts, taught] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, role').in('role', ['instructor', 'admin']).order('full_name'),
      supabase.from('class_templates').select('instructor_id, title, weekday, start_time').eq('is_active', true).order('weekday').order('start_time'),
    ]);
    return { accounts: unwrap(accounts) as StaffAccount[], taught: unwrap(taught) as TaughtClass[] };
  }, []);
  const [edit, setEdit] = useState<Partial<InstructorRow> | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = (i: Partial<InstructorRow>) => {
    setError(null);
    setLoginEmail(i.profile?.email ?? '');
    setEdit(i);
  };

  async function save() {
    if (!edit?.full_name?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const row = { full_name: edit.full_name.trim(), bio: edit.bio || null, photo_url: edit.photo_url || null, instagram: edit.instagram || null, is_active: edit.is_active ?? true };
      const saved = unwrap(edit.id
        ? await supabase.from('instructors').update(row).eq('id', edit.id).select('id').single()
        : await supabase.from('instructors').insert(row).select('id').single()) as { id: string };
      // Linking a login gives that person the instructor view for these classes.
      if ((edit.profile?.email ?? '') !== loginEmail.trim()) {
        unwrap(await supabase.rpc('admin_link_instructor', { p_instructor_id: saved.id, p_email: loginEmail.trim() || null }));
      }
      toast('Instructor saved.');
      setEdit(null);
      void list.reload();
      void birthdays.reload();
    } catch (e) {
      setError(e instanceof AppError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (list.loading || refs.loading) return <PageSpinner />;
  const accounts = refs.data?.accounts ?? [];
  const linkedEmails = new Set((list.data ?? []).map((i) => i.profile?.email).filter(Boolean));
  const unlinked = accounts.filter((a) => a.role === 'instructor' && !linkedEmails.has(a.email));
  const classesOf = (id: string) => (refs.data?.taught ?? []).filter((t) => t.instructor_id === id);
  const knownEmail = accounts.some((a) => a.email === loginEmail);

  return (
    <Section title="Instructors" actions={<button className="btn-sm btn-primary" onClick={() => open({ is_active: true })}>Add instructor</button>}>
      {unlinked.length > 0 && (
        <div className="mb-4"><Notice tone="warn">
          <strong>{unlinked.map((a) => a.full_name || a.email).join(', ')}</strong> {unlinked.length === 1 ? 'has' : 'have'} an instructor account
          but {unlinked.length === 1 ? 'isn’t' : 'aren’t'} linked to an instructor below yet, so they don’t see any classes yet.
          Tap <strong>Edit</strong> on their name and choose their account under <strong>App login</strong>.
        </Notice></div>
      )}
      <p className="mb-3 text-sm text-muted">
        Each instructor sees the class lists of the classes they teach (set the instructor of each class in <Link className="font-semibold text-brand-700" to="/admin/timetable">Timetable</Link>),
        can add members to them, and can book any class for themselves for free. You get a reminder a week before each instructor’s birthday and on the day.
      </p>
      <Table head={['Name', 'App login', 'Teaches', 'Birthday', 'Status', '']} empty={!list.data?.length}>
        {list.data?.map((i) => {
          const taught = classesOf(i.id);
          return (
            <tr key={i.id} className={i.is_active ? '' : 'opacity-50'}>
              <Td className="font-semibold">{i.full_name}</Td>
              <Td>{i.profile?.email ?? <span className="chip bg-accent-100 text-ink">Not linked</span>}</Td>
              <Td className="text-xs">{taught.length ? taught.map((t) => `${WEEKDAY[t.weekday]} ${t.start_time.slice(0, 5)} ${t.title}`).join(' · ') : <span className="text-muted">No weekly classes</span>}</Td>
              <Td><BirthdayCell b={birthdayOf(i.id)} linked={!!i.profile} /></Td>
              <Td>{i.is_active ? 'Active' : 'Inactive'}</Td>
              <Td><button className="btn-sm btn-ghost" onClick={() => open(i)}>Edit</button></Td>
            </tr>
          );
        })}
      </Table>
      {edit && (
        <Sheet open onClose={() => setEdit(null)} title={edit.id ? 'Edit instructor' : 'Add instructor'}>
          <div className="space-y-3">
            <Field label="Full name"><input className="input" value={edit.full_name ?? ''} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="App login" hint="The account they log in with. Choose “Someone else” to type the email they registered with.">
              <select className="input" value={knownEmail ? loginEmail : loginEmail ? '__other' : ''}
                onChange={(e) => setLoginEmail(e.target.value === '__other' ? ' ' : e.target.value)}>
                <option value="">Not linked</option>
                {accounts.map((a) => <option key={a.id} value={a.email ?? ''}>{a.full_name || a.email} · {a.email}{a.role === 'admin' ? ' (admin)' : ''}</option>)}
                <option value="__other">Someone else…</option>
              </select>
            </Field>
            {!knownEmail && loginEmail !== '' && (
              <Field label="Their login email">
                <input className="input" type="email" value={loginEmail.trim()} onChange={(e) => setLoginEmail(e.target.value || ' ')} placeholder="name@example.com" autoFocus />
              </Field>
            )}
            <Field label="Instagram handle"><input className="input" value={edit.instagram ?? ''} onChange={(e) => setEdit({ ...edit, instagram: e.target.value })} /></Field>
            <Field label="Photo URL"><input className="input" value={edit.photo_url ?? ''} onChange={(e) => setEdit({ ...edit, photo_url: e.target.value })} /></Field>
            <Field label="Bio"><textarea className="input min-h-24 py-2" value={edit.bio ?? ''} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Active</label>
            {error && <ErrorNotice error={error} />}
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Spinner />}Save</button>
          </div>
        </Sheet>
      )}
    </Section>
  );
}
