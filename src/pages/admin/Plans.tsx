import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../api';
import type { ClassTemplate, DanceStyle, MembershipPlan } from '../../api/types';
import { useAsync } from '../../lib/useAsync';
import { formatPrice, parseEurosToCents } from '../../domain/money';
import { classesLabel, durationLabel, styleAccessLabel } from '../../domain/plans';
import { ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner, useToast } from '../../components/ui';
import { Section, Table, Td, WEEKDAYS } from './shared';

type PlanForm = Omit<MembershipPlan, 'id'> & { id?: string };

const blank: PlanForm = {
  code: '', name: '', display_label: null, short_description: null, price_cents: 0, currency: 'EUR',
  class_count: 4, validity_days: 28, style_access: 'multi', all_styles: true, first_time_only: false,
  is_active: false, is_most_popular: false, sort_order: 100,
};

export default function AdminPlans() {
  const toast = useToast();
  const data = useAsync(async () => {
    const [plans, styles, planStyles, exclusions, templates] = await Promise.all([
      unwrap(await supabase.from('membership_plans').select('*').order('sort_order')) as MembershipPlan[],
      unwrap(await supabase.from('dance_styles').select('*').order('sort_order')) as DanceStyle[],
      unwrap(await supabase.from('plan_styles').select('*')) as { plan_id: string; style_id: string }[],
      unwrap(await supabase.from('plan_exclusions').select('*').not('template_id', 'is', null)) as { id: string; plan_id: string; template_id: string }[],
      unwrap(await supabase.from('class_templates').select('*').order('weekday').order('start_time')) as ClassTemplate[],
    ]);
    return { plans, styles, planStyles, exclusions, templates };
  }, []);
  const [editing, setEditing] = useState<PlanForm | null>(null);

  if (data.loading) return <PageSpinner />;
  if (data.error) return <ErrorNotice error={data.error} />;
  const d = data.data!;

  return (
    <>
      <Notice tone="info">
        Changing a plan only affects <strong>future</strong> purchases. Customers keep the price, classes, styles and validity they bought.
      </Notice>
      <div className="mt-6">
        <Section title="Membership plans" actions={<button className="btn-sm btn-primary" onClick={() => setEditing(blank)}>New plan</button>}>
          <Table head={['Order', 'Plan', 'Price', 'Classes', 'Validity', 'Access', 'Rules', 'Status', '']}>
            {d.plans.map((p) => (
              <tr key={p.id} className={p.is_active ? '' : 'opacity-50'}>
                <Td>{p.sort_order}</Td>
                <Td><span className="font-semibold">{p.name}</span>{p.display_label && <span className="chip ml-1 bg-accent-50">{p.display_label}</span>}{p.is_most_popular && <span className="chip ml-1 bg-brand-50">Most Popular</span>}</Td>
                <Td className="tabular-nums">{formatPrice(p.price_cents, p.currency)}</Td>
                <Td>{classesLabel(p.class_count)}</Td>
                <Td>{p.billing_interval === 'monthly' ? `Monthly · ${p.commitment_months}-month min.` : durationLabel(p.validity_days)}</Td>
                <Td>{styleAccessLabel(p.style_access)}{!p.all_styles && <span className="block text-xs text-muted">{d.planStyles.filter((x) => x.plan_id === p.id).length} styles</span>}</Td>
                <Td className="text-xs">{p.first_time_only && 'First-time only. '}{p.credit_rollover && 'Classes roll over. '}{p.highlight === 'recommended' && 'Recommended. '}{p.highlight === 'best_value' && 'Best value. '}{d.exclusions.filter((e) => e.plan_id === p.id).length > 0 && `${d.exclusions.filter((e) => e.plan_id === p.id).length} excluded classes`}</Td>
                <Td>{p.is_active ? 'On sale' : 'Disabled'}</Td>
                <Td><button className="btn-sm btn-ghost" onClick={() => setEditing(p)}>Edit</button></Td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
      {editing && (
        <PlanSheet value={editing} styles={d.styles} templates={d.templates}
          selectedStyles={d.planStyles.filter((x) => x.plan_id === editing.id).map((x) => x.style_id)}
          excluded={d.exclusions.filter((x) => x.plan_id === editing.id).map((x) => x.template_id)}
          onClose={() => setEditing(null)} onSaved={() => { toast('Plan saved.'); void data.reload(); }} />
      )}
    </>
  );
}

function PlanSheet({ value, styles, templates, selectedStyles, excluded, onClose, onSaved }: {
  value: PlanForm; styles: DanceStyle[]; templates: ClassTemplate[]; selectedStyles: string[]; excluded: string[];
  onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<PlanForm>(value);
  const [price, setPrice] = useState((value.price_cents / 100).toFixed(2));
  const [styleIds, setStyleIds] = useState<string[]>(selectedStyles);
  const [excludedIds, setExcludedIds] = useState<string[]>(excluded);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => setF({ ...f, [k]: v });
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function save() {
    const cents = parseEurosToCents(price);
    if (cents === null) return setError('Enter a valid price, e.g. 49 or 49.50');
    if (!f.all_styles && styleIds.length === 0) return setError('Choose at least one eligible style.');
    setBusy(true);
    setError(null);
    try {
      const { id, ...row } = f;
      const payload = { ...row, price_cents: cents, display_label: row.display_label || null, short_description: row.short_description || null };
      const saved = unwrap(id
        ? await supabase.from('membership_plans').update(payload).eq('id', id).select().single()
        : await supabase.from('membership_plans').insert(payload).select().single()) as MembershipPlan;

      // Sync eligible styles and excluded recurring classes.
      unwrap(await supabase.from('plan_styles').delete().eq('plan_id', saved.id));
      if (!f.all_styles && styleIds.length) {
        unwrap(await supabase.from('plan_styles').insert(styleIds.map((style_id) => ({ plan_id: saved.id, style_id }))));
      }
      const toRemove = excluded.filter((t) => !excludedIds.includes(t));
      const toAdd = excludedIds.filter((t) => !excluded.includes(t));
      if (toRemove.length) unwrap(await supabase.from('plan_exclusions').delete().eq('plan_id', saved.id).in('template_id', toRemove));
      if (toAdd.length) unwrap(await supabase.from('plan_exclusions').insert(toAdd.map((template_id) => ({ plan_id: saved.id, template_id }))));
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={f.id ? `Edit ${value.name}` : 'New plan'}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field></div>
        <Field label="Code (unique)"><input className="input" value={f.code} onChange={(e) => set('code', e.target.value)} disabled={Boolean(f.id)} /></Field>
        <Field label="Label (optional)" hint="e.g. Intro Offer"><input className="input" value={f.display_label ?? ''} onChange={(e) => set('display_label', e.target.value)} /></Field>
        <Field label="Price (€)"><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Classes included"><input className="input" type="number" min={1} value={f.class_count} onChange={(e) => set('class_count', Number(e.target.value))} /></Field>
        <Field label="Valid for (days)" hint={durationLabel(f.validity_days)}><input className="input" type="number" min={1} value={f.validity_days} onChange={(e) => set('validity_days', Number(e.target.value))} /></Field>
        <Field label="Display order"><input className="input" type="number" value={f.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} /></Field>
        <div className="col-span-2"><Field label="Style access">
          <select className="input" value={f.style_access} onChange={(e) => set('style_access', e.target.value as PlanForm['style_access'])}>
            <option value="multi">Multiple dance styles</option>
            <option value="single">One dance style (customer chooses at purchase)</option>
          </select>
        </Field></div>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.all_styles} onChange={(e) => set('all_styles', e.target.checked)} />All active styles are eligible</label>
        {!f.all_styles && (
          <div className="col-span-2 flex flex-wrap gap-2">
            {styles.map((s) => (
              <label key={s.id} className={`chip cursor-pointer border px-3 py-2 ${styleIds.includes(s.id) ? 'border-brand-600 bg-brand-50' : 'border-line'}`}>
                <input type="checkbox" className="sr-only" checked={styleIds.includes(s.id)} onChange={() => setStyleIds(toggle(styleIds, s.id))} />{s.name}
              </label>
            ))}
          </div>
        )}
        <Field label="Billing">
          <select className="input" value={f.billing_interval ?? 'one_off'} onChange={(e) => {
            const monthly = e.target.value === 'monthly';
            setF({ ...f, billing_interval: monthly ? 'monthly' : 'one_off', commitment_months: monthly ? f.commitment_months ?? 3 : null,
              credit_rollover: monthly ? f.credit_rollover ?? false : false, first_time_only: monthly ? false : f.first_time_only });
          }}>
            <option value="one_off">One-off pack</option>
            <option value="monthly">Monthly (recurring)</option>
          </select>
        </Field>
        {f.billing_interval === 'monthly' ? (
          <Field label="Minimum commitment (months)">
            <input className="input" type="number" min={1} max={24} value={f.commitment_months ?? 3} onChange={(e) => set('commitment_months', Number(e.target.value))} />
          </Field>
        ) : <div />}
        {f.billing_interval === 'monthly' && (
          <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={Boolean(f.credit_rollover)} onChange={(e) => set('credit_rollover', e.target.checked)} />Unused classes roll over to the next month (until the commitment period ends)</label>
        )}
        <Field label="Highlight">
          <select className="input" value={f.highlight ?? ''} onChange={(e) => set('highlight', (e.target.value || null) as MembershipPlan['highlight'])}>
            <option value="">None</option><option value="recommended">Recommended (stands out)</option><option value="best_value">Best value (dark card)</option>
          </select>
        </Field>
        <Field label="Button text (optional)"><input className="input" value={f.cta_label ?? ''} onChange={(e) => set('cta_label', e.target.value || null)} placeholder="e.g. Choose Committed" /></Field>
        {f.billing_interval !== 'monthly' && <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.first_time_only} onChange={(e) => set('first_time_only', e.target.checked)} />First-time customers only</label>}
        {f.billing_interval === 'monthly' && <p className="col-span-2 text-xs text-muted">Changing the price of a monthly plan applies to new members only. Existing members keep the price they signed up at.</p>}
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />On sale</label>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.is_most_popular} onChange={(e) => set('is_most_popular', e.target.checked)} />Show “Most Popular” badge (only if backed by real sales data)</label>
        {templates.length > 0 && (
          <details className="col-span-2 rounded-xl border border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold">Excluded recurring classes ({excludedIds.length})</summary>
            <p className="mt-2 text-xs text-muted">Excluded classes can’t be booked with this plan. Exclusions only apply to future purchases (and to classes added later).</p>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {templates.map((t) => (
                <li key={t.id}><label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={excludedIds.includes(t.id)} onChange={() => setExcludedIds(toggle(excludedIds, t.id))} />
                  {WEEKDAYS[t.weekday].slice(0, 3)} {t.start_time.slice(0, 5)} — {t.title}
                </label></li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {error && <div className="mt-3"><ErrorNotice error={error} /></div>}
      <button className="btn-primary mt-4 w-full" disabled={busy || !f.name.trim() || !f.code.trim()} onClick={save}>{busy && <Spinner />}Save plan</button>
    </Sheet>
  );
}
