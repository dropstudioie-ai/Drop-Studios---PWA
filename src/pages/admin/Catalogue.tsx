import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../api';
import type { DanceStyle, Instructor } from '../../api/types';
import { useAsync } from '../../lib/useAsync';
import { ErrorNotice, Field, PageSpinner, Sheet, useToast } from '../../components/ui';
import { Section, Table, Td } from './shared';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function AdminStyles() {
  const toast = useToast();
  const list = useAsync(async () => unwrap(await supabase.from('dance_styles').select('*').order('sort_order')) as DanceStyle[], []);
  const [edit, setEdit] = useState<Partial<DanceStyle> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!edit?.name?.trim()) return;
    const row = { name: edit.name.trim(), slug: edit.slug || slugify(edit.name), color: edit.color ?? '#2F5BFF', description: edit.description || null, is_active: edit.is_active ?? true, sort_order: edit.sort_order ?? 100 };
    const res = edit.id ? await supabase.from('dance_styles').update(row).eq('id', edit.id) : await supabase.from('dance_styles').insert(row);
    if (res.error) return setError(res.error.message);
    toast('Style saved.');
    setEdit(null);
    void list.reload();
  }

  if (list.loading) return <PageSpinner />;
  return (
    <Section title="Dance styles" actions={<button className="btn-sm btn-primary" onClick={() => { setError(null); setEdit({ is_active: true }); }}>Add style</button>}>
      <Table head={['', 'Style', 'Order', 'Status', '']} empty={!list.data?.length}>
        {list.data?.map((s) => (
          <tr key={s.id} className={s.is_active ? '' : 'opacity-50'}>
            <Td><span className="inline-block h-4 w-4 rounded-full" style={{ background: s.color }} /></Td>
            <Td className="font-semibold">{s.name}</Td>
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
            <Field label="Display order"><input className="input" type="number" value={edit.sort_order ?? 100} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></Field>
            <Field label="Description"><textarea className="input min-h-20 py-2" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Active</label>
            {error && <ErrorNotice error={error} />}
            <button className="btn-primary w-full" onClick={save}>Save</button>
          </div>
        </Sheet>
      )}
    </Section>
  );
}

export function AdminInstructors() {
  const toast = useToast();
  const list = useAsync(async () => unwrap(await supabase.from('instructors').select('*').order('full_name')) as Instructor[], []);
  const [edit, setEdit] = useState<Partial<Instructor> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!edit?.full_name?.trim()) return;
    const row = { full_name: edit.full_name.trim(), bio: edit.bio || null, photo_url: edit.photo_url || null, instagram: edit.instagram || null, is_active: edit.is_active ?? true };
    const res = edit.id ? await supabase.from('instructors').update(row).eq('id', edit.id) : await supabase.from('instructors').insert(row);
    if (res.error) return setError(res.error.message);
    toast('Instructor saved.');
    setEdit(null);
    void list.reload();
  }

  if (list.loading) return <PageSpinner />;
  return (
    <Section title="Instructors" actions={<button className="btn-sm btn-primary" onClick={() => { setError(null); setEdit({ is_active: true }); }}>Add instructor</button>}>
      <Table head={['Name', 'Instagram', 'Status', '']} empty={!list.data?.length}>
        {list.data?.map((i) => (
          <tr key={i.id} className={i.is_active ? '' : 'opacity-50'}>
            <Td className="font-semibold">{i.full_name}</Td>
            <Td>{i.instagram ?? '—'}</Td>
            <Td>{i.is_active ? 'Active' : 'Inactive'}</Td>
            <Td><button className="btn-sm btn-ghost" onClick={() => { setError(null); setEdit(i); }}>Edit</button></Td>
          </tr>
        ))}
      </Table>
      {edit && (
        <Sheet open onClose={() => setEdit(null)} title={edit.id ? 'Edit instructor' : 'Add instructor'}>
          <div className="space-y-3">
            <Field label="Full name"><input className="input" value={edit.full_name ?? ''} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="Instagram handle"><input className="input" value={edit.instagram ?? ''} onChange={(e) => setEdit({ ...edit, instagram: e.target.value })} /></Field>
            <Field label="Photo URL"><input className="input" value={edit.photo_url ?? ''} onChange={(e) => setEdit({ ...edit, photo_url: e.target.value })} /></Field>
            <Field label="Bio"><textarea className="input min-h-24 py-2" value={edit.bio ?? ''} onChange={(e) => setEdit({ ...edit, bio: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Active</label>
            {error && <ErrorNotice error={error} />}
            <button className="btn-primary w-full" onClick={save}>Save</button>
          </div>
        </Sheet>
      )}
    </Section>
  );
}
