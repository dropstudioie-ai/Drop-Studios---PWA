import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { classPages, type StyleDetails, type TeachingProfile } from '../lib/classPages';
import { ErrorNotice, Field, PageSpinner, Spinner, useToast } from '../components/ui';

/** Instructors write their own bio and describe the classes they teach (shown on the public class pages). */
export default function TeachProfilePage() {
  const data = useAsync(() => classPages.mine(), []);
  if (data.loading && !data.data) return <PageSpinner />;
  if (data.error) return <div className="container-page py-10"><ErrorNotice error={data.error} onRetry={data.reload} /></div>;
  const p = data.data;
  if (!p) {
    return (
      <div className="container-page max-w-2xl py-10">
        <h1 className="text-3xl font-black">Your class pages</h1>
        <p className="mt-2 text-ink-soft">Your login isn't linked to an instructor profile yet. Admins can edit every class in Admin → Styles and bios in Admin → Instructors.</p>
      </div>
    );
  }
  return <Editor profile={p} onSaved={() => void data.reload()} />;
}

function Editor({ profile, onSaved }: { profile: TeachingProfile; onSaved: () => void }) {
  const first = profile.instructor.full_name.split(' ')[0];
  return (
    <div className="container-page max-w-3xl py-8">
      <h1 className="text-3xl font-black">Your bio and classes</h1>
      <p className="mt-2 text-ink-soft">
        Hi {first}! Every class now has its own page on the Drop website, so new people can find us on Google and know what to expect.
        We wrote a first draft: please check it, make it sound like you, and save. It takes about 5 minutes.
      </p>
      {profile.todo
        ? <p className="mt-3 rounded-xl bg-accent-50 p-3 text-sm font-semibold text-accent-600">Still to do: {[!profile.instructor.bio_confirmed && 'your bio', ...profile.styles.filter((s) => !s.details_confirmed).map((s) => s.name)].filter(Boolean).join(', ')}</p>
        : <p className="mt-3 rounded-xl bg-success/10 p-3 text-sm font-semibold text-success">All done, thank you! You can come back and update it any time.</p>}

      <BioForm profile={profile} onSaved={onSaved} />
      {profile.styles.map((s) => <StyleForm key={s.id} style={s} onSaved={onSaved} />)}
    </div>
  );
}

function Status({ done }: { done: boolean }) {
  return done
    ? <span className="chip bg-success/10 text-success">✓ Saved</span>
    : <span className="chip bg-accent-50 text-accent-600">Draft: please check</span>;
}

function BioForm({ profile, onSaved }: { profile: TeachingProfile; onSaved: () => void }) {
  const toast = useToast();
  const [bio, setBio] = useState(profile.instructor.bio ?? '');
  const [ig, setIg] = useState(profile.instructor.instagram ?? '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await classPages.saveBio(bio, ig); toast('Bio saved. Thank you!'); onSaved(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <section className="card mt-6 p-5" aria-labelledby="bio-h">
      <div className="flex items-center justify-between gap-3">
        <h2 id="bio-h" className="text-xl font-black">About you</h2>
        <Status done={profile.instructor.bio_confirmed} />
      </div>
      <div className="mt-3 space-y-3">
        <Field label="Your bio" hint="Who you are, your dance background, and what people love about your classes. 2 to 5 sentences.">
          <textarea className="input min-h-36 py-2" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={1200} />
        </Field>
        <Field label="Instagram (optional)"><input className="input" value={ig} onChange={(e) => setIg(e.target.value)} placeholder="@yourname" /></Field>
        <button className="btn-primary w-full sm:w-auto" disabled={busy} onClick={() => void save()}>{busy ? <Spinner /> : 'Save my bio'}</button>
      </div>
    </section>
  );
}

const FIELDS: { key: keyof StyleDetails; label: string; hint: string; rows: number; max: number }[] = [
  { key: 'description', label: 'What is the class like?', hint: 'The style, the music, the vibe, and what people get out of it.', rows: 8, max: 1500 },
  { key: 'level', label: 'Level', hint: 'e.g. All levels, perfect for beginners.', rows: 1, max: 200 },
  { key: 'what_to_wear', label: 'What to wear', hint: 'Clothes and shoes.', rows: 3, max: 400 },
  { key: 'what_to_bring', label: 'What to bring', hint: 'Water, towel, heels, knee pads… or nothing at all.', rows: 3, max: 400 },
  { key: 'first_class', label: 'Tips for someone\'s first class', hint: 'When to arrive, what to expect, anything that helps a nervous beginner.', rows: 4, max: 600 },
];

function StyleForm({ style, onSaved }: { style: TeachingProfile['styles'][number]; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<StyleDetails>(style);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setD(style); }, [style]);
  async function save() {
    setBusy(true);
    try { await classPages.saveStyle(style.id, d); toast(`${style.name} saved. Thank you!`); onSaved(); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <section className="card mt-6 p-5" aria-labelledby={`st-${style.id}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id={`st-${style.id}`} className="text-xl font-black">{style.name}</h2>
        <Status done={style.details_confirmed} />
      </div>
      <p className="mt-1 text-sm text-muted">Shown on <Link to={`/classes/${style.slug}`} className="font-semibold text-brand-700">the {style.name} page</Link>. If you share this class with another instructor, you both see the same text.</p>
      <div className="mt-3 space-y-3">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {f.rows === 1
              ? <input className="input" value={d[f.key] ?? ''} maxLength={f.max} onChange={(e) => setD({ ...d, [f.key]: e.target.value })} />
              : <textarea className="input py-2" rows={f.rows} value={d[f.key] ?? ''} maxLength={f.max} onChange={(e) => setD({ ...d, [f.key]: e.target.value })} />}
          </Field>
        ))}
        <button className="btn-primary w-full sm:w-auto" disabled={busy} onClick={() => void save()}>{busy ? <Spinner /> : `Save ${style.name}`}</button>
      </div>
    </section>
  );
}
