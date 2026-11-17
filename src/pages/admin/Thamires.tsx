import { useEffect, useMemo, useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { renderStory, STORY_PHOTOS, storyCount, storyPhoto, thamires, uploadStoryPhoto, type ThComment, type ThPromo, type ThGuidance, type ThMessage, type ThMention, type ThReport, type ThSettings, type ThThread, type ThStory, type Turn } from '../../lib/thamires';
import { ErrorNotice, PageSpinner, Spinner, useToast } from '../../components/ui';
import { fmt, localDateKey } from '../../domain/time';

function Switch({ label, hint, checked, onChange, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start justify-between gap-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <span><span className="block font-semibold">{label}</span><span className="block text-sm text-muted">{hint}</span></span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-line'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} /></span>
    </label>
  );
}

const Dot = ({ ok, label }: { ok: boolean; label: string }) => <span className={`chip ${ok ? 'bg-success/10 text-success' : 'bg-accent-50 text-accent-600'}`}>{ok ? '✓' : '○'} {label}</span>;

function Setup({ s, onSaved, status }: { s: ThSettings; onSaved: () => void; status: { instagram: boolean; claude: boolean; webhook: boolean } | null }) {
  const toast = useToast();
  const [notes, setNotes] = useState(s.notes ?? '');
  const save = async (patch: Partial<ThSettings>, msg?: string) => { try { await thamires.saveSettings(patch); onSaved(); if (msg) toast(msg); } catch (e) { toast((e as Error).message, 'error'); } };
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        {status ? <><Dot ok={status.claude} label="AI brain" /><Dot ok={status.instagram} label="Instagram" /><Dot ok={status.webhook} label="Receives messages" /></> : <span className="text-sm text-muted">Checking connections…</span>}
      </div>
      <div className="mt-2 divide-y divide-line">
        <Switch label="Thamires is on" hint="She reads new Instagram messages and tags and prepares replies." checked={s.enabled} onChange={(v) => void save({ enabled: v }, v ? 'Thamires is on' : 'Thamires is off')} />
        <Switch label="Send simple replies automatically" hint="Timetable, prices, booking, location and class questions go out straight away. Anything sensitive still waits for you." checked={s.auto_reply} disabled={!s.enabled} onChange={(v) => void save({ auto_reply: v })} />
        <Switch label="Thank people who tag Drop automatically" hint="Otherwise each thank-you waits for your approval." checked={s.auto_tag_thanks} disabled={!s.enabled} onChange={(v) => void save({ auto_tag_thanks: v })} />
        <Switch label="Reply to simple comments automatically" hint="Thank-yous and quick questions under Drop’s posts get a short public reply. Complaints and new questions still wait for you." checked={s.auto_comment_reply} disabled={!s.enabled} onChange={(v) => void save({ auto_comment_reply: v })} />
        <Switch label="Prepare a daily Story" hint="Today's classes, ready for you to publish in one tap." checked={s.daily_story} disabled={!s.enabled} onChange={(v) => void save({ daily_story: v })} />
      </div>
      {s.daily_story && (
        <label className="mt-2 flex items-center gap-2 text-sm">Ready by
          <select className="input w-28" value={s.story_hour} onChange={(e) => void save({ story_hour: Number(e.target.value) })}>
            {Array.from({ length: 15 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
      )}
      <div className="divide-y divide-line">
        <Switch label="Send me a daily report" hint="An evening email with what people talked about, new questions and anything waiting for you." checked={s.daily_report} disabled={!s.enabled} onChange={(v) => void save({ daily_report: v })} />
      </div>
      {s.daily_report && (
        <label className="mt-2 flex items-center gap-2 text-sm">Report at
          <select className="input w-28" value={s.report_hour} onChange={(e) => void save({ report_hour: Number(e.target.value) })}>
            {Array.from({ length: 12 }, (_, i) => i + 12).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
      )}
      <label className="mt-4 block"><span className="text-sm font-semibold">Things Thamires should know</span>
        <textarea className="input mt-1 min-h-24" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Parking: Q-Park Abbey Street. Kids classes start in January. We're closed 24–26 December." />
        <span className="text-xs text-muted">She already knows the timetable, prices, class pages and policies from the app.</span>
      </label>
      <button className="btn-outline btn-sm mt-2" disabled={notes === (s.notes ?? '')} onClick={() => void save({ notes: notes.trim() || null }, 'Saved')}>Save notes</button>
    </section>
  );
}

function DraftCard({ m, onDone }: { m: ThMessage & { assistant_threads: ThThread }; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(m.text);
  const [busy, setBusy] = useState(false);
  const last = useAsync(() => thamires.messages(m.thread_id), [m.thread_id]);
  const inbound = (last.data ?? []).filter((x) => x.direction === 'in').slice(-3);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast(ok); onDone(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } };
  return (
    <li className={`card p-4 ${m.needs_human ? 'border-2 border-accent-500' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold">@{m.assistant_threads.username ?? 'someone'}{m.assistant_threads.language && m.assistant_threads.language !== 'English' && <span className="chip ml-2 bg-brand-50 text-brand-700">🌍 {m.assistant_threads.language}</span>}</p>
        <span className="text-xs text-muted">{fmt.dateTime(m.created_at)}</span>
      </div>
      {inbound.map((x) => <p key={x.id} className="mt-2 rounded-xl bg-canvas p-2 text-sm">{x.text}</p>)}
      {m.needs_human && <p className="mt-2 text-sm font-semibold text-accent-600">👋 Needs a person: {m.reason}</p>}
      <label className="mt-3 block text-xs font-semibold text-muted">Thamires’ reply (edit if you like)</label>
      <textarea className="input mt-1 min-h-24" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
      {m.translation && <p className="mt-1 rounded-lg bg-brand-50 p-2 text-xs text-brand-700"><strong>In English:</strong> {m.translation}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => void act(() => thamires.send(m.id, text.trim()), 'Sent on Instagram')}>{busy ? <Spinner className="h-4 w-4" /> : 'Send'}</button>
        <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void act(() => thamires.reject(m.id), 'Discarded')}>Discard</button>
      </div>
    </li>
  );
}

function Conversations({ reload }: { reload: number }) {
  const toast = useToast();
  const threads = useAsync(() => thamires.threads(), [reload]);
  const [open, setOpen] = useState<string | null>(null);
  const msgs = useAsync(() => (open ? thamires.messages(open) : Promise.resolve([] as ThMessage[])), [open, reload]);
  const [text, setText] = useState('');
  const t = threads.data?.find((x) => x.id === open);
  if (threads.loading && !threads.data) return <Spinner />;
  if (!threads.data?.length) return <p className="text-sm text-muted">No Instagram conversations yet.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-[260px_1fr]">
      <ul className="space-y-1">
        {threads.data.map((x) => (
          <li key={x.id}><button onClick={() => setOpen(x.id)} className={`w-full rounded-xl px-3 py-2 text-left ${open === x.id ? 'bg-brand-50' : 'hover:bg-canvas'}`}>
            <span className="block font-semibold">@{x.username ?? x.ig_user_id}</span>
            <span className="text-xs text-muted">{x.status === 'needs_human' ? '👋 needs a person · ' : ''}{fmt.dateTime(x.last_message_at)}</span>
          </button></li>
        ))}
      </ul>
      {t ? (
        <div className="card p-4">
          <div className="flex items-center justify-between"><p className="font-bold">@{t.username}</p>
            {t.status === 'needs_human' && <button className="btn-ghost btn-sm" onClick={() => void thamires.threadStatus(t.id, 'open').then(() => threads.reload())}>Mark handled</button>}</div>
          {t.memory && (
            <div className="mt-2 rounded-xl bg-accent-50 p-3 text-sm">
              <p><strong>💭 What Thamires remembers:</strong> {t.memory}</p>
              <button className="mt-1 text-xs font-semibold text-accent-600 underline" onClick={async () => { try { await thamires.forget(t.id); threads.reload(); toast('Forgotten'); } catch (e) { toast((e as Error).message, 'error'); } }}>Forget this</button>
            </div>
          )}
          <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto">
            {(msgs.data ?? []).map((m) => (
              <li key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.direction === 'in' ? 'bg-canvas' : 'ml-auto bg-brand-600 text-white'} ${m.status === 'draft' ? 'opacity-60' : ''}`}>
                {m.text}{m.status === 'draft' && <span className="block text-[11px]">draft, waiting for approval</span>}{m.status === 'failed' && <span className="block text-[11px]">not sent: {m.error}</span>}{m.reaction && <span className="mt-1 block w-fit rounded-full bg-white px-1 text-sm">{m.reaction}</span>}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your own reply…" />
            <button className="btn-primary btn-sm" disabled={!text.trim()} onClick={async () => { try { await thamires.reply(t.id, text.trim()); setText(''); msgs.reload(); } catch (e) { toast((e as Error).message, 'error'); } }}>Send</button>
          </div>
        </div>
      ) : <p className="text-sm text-muted">Choose a conversation.</p>}
    </div>
  );
}

function Tags({ list, onDone }: { list: ThMention[]; onDone: () => void }) {
  const toast = useToast();
  const [texts, setTexts] = useState<Record<string, string>>({});
  if (!list.length) return <p className="text-sm text-muted">No tags yet. When someone tags Drop in a post or Story, it shows here.</p>;
  return (
    <ul className="space-y-3">
      {list.map((m) => (
        <li key={m.id} className="card flex gap-3 p-4">
          {m.media_url ? <img src={m.media_url} alt="" className="h-24 w-16 shrink-0 rounded-lg object-cover" /> : <span className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg bg-canvas text-2xl">📸</span>}
          <div className="min-w-0 flex-1">
            <p className="font-bold">@{m.username ?? 'someone'} <span className="font-normal text-muted">· {m.kind === 'story' ? 'Story mention' : 'tagged post'} · {fmt.dateTime(m.received_at)}</span></p>
            {m.caption && <p className="truncate text-sm text-muted">“{m.caption}”</p>}
            {m.reply_status === 'draft' && m.reply_text ? (
              <>
                <textarea className="input mt-2 min-h-16" value={texts[m.id] ?? m.reply_text} onChange={(e) => setTexts({ ...texts, [m.id]: e.target.value })} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="btn-primary btn-sm" onClick={async () => { try { await thamires.mentionSend(m.id, (texts[m.id] ?? m.reply_text!).trim()); toast(m.kind === 'story' ? 'Thank-you sent by DM' : 'Comment posted'); onDone(); } catch (e) { toast((e as Error).message, 'error'); } }}>{m.kind === 'story' ? 'Send thank-you DM' : 'Post comment'}</button>
                  <button className="btn-ghost btn-sm" onClick={async () => { await thamires.mentionSkip(m.id); onDone(); }}>Skip</button>
                </div>
              </>
            ) : <p className="mt-1 text-sm">{m.reply_status === 'sent' ? '✓ Thanked' : m.reply_status === 'failed' ? `Not sent: ${m.error}` : m.reply_status === 'skipped' ? 'Skipped' : 'Preparing a thank-you…'}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              {m.permalink && <a className="font-semibold text-brand-700" href={m.permalink} target="_blank" rel="noreferrer">Open on Instagram ↗</a>}
              {m.kind === 'story' && <label className="flex items-center gap-1"><input type="checkbox" checked={m.reshared} onChange={(e) => void thamires.reshared(m.id, e.target.checked).then(onDone)} />Reshared to our Story (do this in the Instagram app)</label>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Comments({ list, onDone }: { list: ThComment[]; onDone: () => void }) {
  const toast = useToast();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!list.length) return <p className="text-sm text-muted">No comments yet. When someone comments on one of Drop’s posts, Thamires drafts a short public reply here.</p>;
  const act = async (id: string, fn: () => Promise<unknown>, ok: string) => { setBusy(id); try { await fn(); toast(ok); onDone(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); } };
  return (
    <ul className="space-y-3">
      {list.map((c) => (
        <li key={c.id} className={`card p-4 ${c.reply_status === 'draft' && c.needs_human ? 'border-2 border-accent-500' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold">@{c.username ?? 'someone'}</p>
            <span className="text-xs text-muted">{fmt.dateTime(c.received_at)}</span>
          </div>
          <p className="mt-1 rounded-xl bg-canvas p-2 text-sm">{c.text}</p>
          {c.post_caption && <p className="mt-1 truncate text-xs text-muted">On the post: “{c.post_caption}”</p>}
          {c.reply_status === 'draft' && c.out_of_ordinary && <p className="mt-2 text-sm font-semibold text-accent-600">🤔 New question: answer it on “Questions for you” and she’ll rewrite this reply.</p>}
          {c.reply_status === 'draft' && c.needs_human && !c.out_of_ordinary && <p className="mt-2 text-sm font-semibold text-accent-600">👋 Needs a person: {c.reason}</p>}
          {c.reply_status === 'draft' && c.reply_text ? (
            <>
              <label className="mt-3 block text-xs font-semibold text-muted">Public reply (edit if you like)</label>
              <textarea className="input mt-1 min-h-16" value={texts[c.id] ?? c.reply_text} onChange={(e) => setTexts({ ...texts, [c.id]: e.target.value })} maxLength={1000} />
              {c.translation && <p className="mt-1 rounded-lg bg-brand-50 p-2 text-xs text-brand-700"><strong>In English:</strong> {c.translation}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-primary btn-sm" disabled={busy === c.id} onClick={() => void act(c.id, () => thamires.commentSend(c.id, (texts[c.id] ?? c.reply_text!).trim()), 'Reply posted')}>{busy === c.id ? <Spinner className="h-4 w-4" /> : 'Post reply'}</button>
                <button className="btn-ghost btn-sm" disabled={busy === c.id} onClick={() => void act(c.id, () => thamires.commentSkip(c.id), 'Skipped')}>Skip</button>
              </div>
            </>
          ) : <p className="mt-2 text-sm">{c.reply_status === 'sent' ? <>✓ Replied: <span className="text-muted">{c.reply_text}</span></> : c.reply_status === 'failed' ? `Not sent: ${c.error}` : c.reply_status === 'skipped' ? 'Skipped' : 'Preparing a reply…'}</p>}
          {c.permalink && <a className="mt-2 inline-block text-sm font-semibold text-brand-700" href={c.permalink} target="_blank" rel="noreferrer">Open the post ↗</a>}
        </li>
      ))}
    </ul>
  );
}

const Insights = ({ i }: { i: Record<string, number> }) => (
  <span className="flex flex-wrap gap-2 text-xs">
    {i.reach != null && <span className="chip bg-brand-50 text-brand-700">👀 {i.reach} reached</span>}
    {i.impressions != null && <span className="chip bg-brand-50 text-brand-700">{i.impressions} views</span>}
    {i.replies != null && <span className="chip bg-brand-50 text-brand-700">💬 {i.replies} replies</span>}
    {i.taps_forward != null && <span className="chip bg-canvas">⏩ {i.taps_forward}</span>}
    {i.taps_back != null && <span className="chip bg-canvas">⏪ {i.taps_back}</span>}
    {i.exits != null && <span className="chip bg-canvas">🚪 {i.exits} exits</span>}
  </span>
);

function RecentStories({ reload }: { reload: number }) {
  const list = useAsync(() => thamires.recentStories(), [reload]);
  if (!list.data?.length) return null;
  return (
    <div className="mt-6">
      <h3 className="font-bold">How recent Stories did</h3>
      <p className="text-sm text-muted">Instagram sends the numbers within a day of each Story.</p>
      <ul className="mt-2 space-y-2">
        {list.data.map((st) => (
          <li key={st.id} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-32 font-semibold">{new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${st.story_date}T12:00:00`))}</span>
            {st.insights ? <Insights i={st.insights} /> : <span className="text-muted">Numbers not in yet</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhotoPicker({ story, index, onChanged }: { story: ThStory; index: number; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = storyPhoto(story, index);
  const choose = async (url: string | null) => {
    setBusy(true);
    try { await thamires.setStoryPhoto(story.id, url, index); onChanged(); setOpen(false); toast('Photo changed'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  };
  if (!open) return <button className="btn-outline btn-sm w-full" onClick={() => setOpen(true)}>🖼️ Change photo</button>;
  return (
    <div className="fixed inset-x-3 bottom-3 z-50 max-h-[80vh] overflow-y-auto rounded-2xl border border-line bg-surface p-3 shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[520px]">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Choose the Story photo</p>
        <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Close</button>
      </div>
      <label className={`btn-primary btn-sm mt-2 inline-flex cursor-pointer ${busy ? 'opacity-50' : ''}`}>
        {busy ? <Spinner className="h-4 w-4" /> : '📷 Upload a photo'}
        <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          setBusy(true);
          try { const url = await uploadStoryPhoto(f); await thamires.setStoryPhoto(story.id, url, index); onChanged(); setOpen(false); toast('Photo uploaded'); }
          catch (err) { toast((err as Error).message, 'error'); } finally { setBusy(false); e.target.value = ''; }
        }} />
      </label>
      <span className="ml-2 text-xs text-muted">Portrait photos look best. Bright, sharp, people dancing.</span>
      <div className="mt-3 grid max-h-80 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
        {STORY_PHOTOS.map((p) => (
          <button key={p.url} title={p.label} disabled={busy} onClick={() => void choose(p.url)}
            className={`overflow-hidden rounded-lg border-2 ${current === p.url ? 'border-brand-600' : 'border-transparent'}`}>
            <img src={p.url} alt={p.label} loading="lazy" className="aspect-[4/5] w-full object-cover" />
          </button>
        ))}
      </div>
      {(story.photos?.[String(index)] || (index === 0 && story.photo_url)) && <button className="mt-2 text-xs font-semibold text-muted underline" disabled={busy} onClick={() => void choose(null)}>Back to the automatic photo</button>}
    </div>
  );
}

function Promos({ reload }: { reload: number }) {
  const toast = useToast();
  const list = useAsync(() => thamires.promos(), [reload]);
  const [busy, setBusy] = useState<string | null>(null);
  const day = (d: string | null) => (d ? new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${d}T12:00:00`)) : '');
  const next = (p: ThPromo) => {
    if (!p.enabled || !p.starts_on) return null;
    const base = p.last_posted_on ? new Date(new Date(`${p.last_posted_on}T12:00:00`).getTime() + p.every_days * 864e5) : new Date(`${p.starts_on}T12:00:00`);
    const k = localDateKey(base < new Date() ? new Date() : base);
    return p.ends_on && k > p.ends_on ? null : k;
  };
  if (list.loading && !list.data) return <Spinner />;
  if (!list.data?.length) return <p className="text-sm text-muted">No promos scheduled.</p>;
  return (
    <ul className="space-y-3">
      {list.data.map((p) => (
        <li key={p.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold">{p.title}</p>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={p.enabled} disabled={!p.starts_on} onChange={async (e) => { try { await thamires.setPromo(p.id, { enabled: e.target.checked }); list.reload(); } catch (err) { toast((err as Error).message, 'error'); } }} />On</label>
          </div>
          <p className="mt-1 text-sm">{p.items.map((x, i) => <span key={i}>{i > 0 && ' → '}{x.kind === 'video' ? '🎬' : '🖼️'} {x.label ?? x.path}</span>)}</p>
          <p className="mt-1 text-sm text-muted">{p.starts_on ? `Every ${p.every_days} days at ${String(p.post_hour).padStart(2, '0')}:00, ${day(p.starts_on)} to ${day(p.ends_on)}` : 'Starts when gift cards go live'} · posted {p.posts_done}×{p.last_posted_on ? `, last on ${day(p.last_posted_on)}` : ''}{next(p) ? ` · next ${day(next(p))}` : ''}</p>
          {p.last_error && <p className="mt-1 text-sm text-danger">Last try: {p.last_error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {p.items.map((x, i) => <a key={i} className="btn-ghost btn-sm" href={thamires.mediaUrl(x.path)} target="_blank" rel="noreferrer">Preview {i + 1}</a>)}
            <button className="btn-outline btn-sm" disabled={busy === p.id} onClick={async () => { if (!confirm(`Post “${p.title}” to Instagram Stories now?`)) return; setBusy(p.id); try { const r = await thamires.postPromoNow(p.id); const res = r[p.title]; if (res?.error) toast(res.error, 'error'); else toast('Posted to Instagram Stories'); list.reload(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); } }}>{busy === p.id ? <Spinner className="h-4 w-4" /> : 'Post now'}</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TodayStory({ reload }: { reload: () => void }) {
  const toast = useToast();
  const today = localDateKey(new Date());
  const story = useAsync(() => thamires.story(today), [today]);
  const [imgs, setImgs] = useState<{ url: string; blob: Blob }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const st = story.data as ThStory | null;
    if (!st || !st.lines.length) { setImgs([]); return; }
    let live = true;
    void Promise.all(st.lines.map((_, i) => renderStory(st, i))).then((blobs) => { if (live) setImgs(blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))); });
    return () => { live = false; };
  }, [story.data]);
  const s = story.data as ThStory | null;
  const n = s ? storyCount(s) : 0;
  const ready = s && (s.status === 'draft' || s.status === 'failed') && imgs.length === n && n > 0;
  return (
    <div className="space-y-3 text-sm">
      {!s && <><p>Thamires prepares the Stories automatically each morning: one per class. You can make them now:</p><button className="btn-primary btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { await thamires.prepareStory(); story.reload(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>Prepare today’s Stories</button></>}
      {s?.status === 'skipped' && <p>No classes today, so no Story.</p>}
      {n > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {s!.lines.map((l, i) => (
            <div key={i} className="w-40 shrink-0 space-y-2">
              <div className="overflow-hidden rounded-2xl bg-ink" style={{ aspectRatio: '9 / 16' }}>
                {imgs[i] ? <img src={imgs[i].url} alt={`${l.time} ${l.title}`} className="h-full w-full" /> : <span className="flex h-full items-center justify-center text-white/70">Loading…</span>}
              </div>
              <p className="text-xs font-semibold">{i + 1}. {l.time} {l.title}</p>
              {s!.status === 'draft' && <PhotoPicker story={s!} index={i} onChanged={() => story.reload()} />}
              {imgs[i] && <a className="block text-center text-xs font-semibold text-brand-700" href={imgs[i].url} download={`drop-story-${today}-${i + 1}.jpg`}>Download</a>}
            </div>
          ))}
        </div>
      )}
      {ready && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { const r = await thamires.publishStories(s!.id, imgs.map((x) => x.blob)); toast(`${r.published} ${r.published === 1 ? 'Story' : 'Stories'} published on Instagram`); story.reload(); reload(); } catch (e) { toast((e as Error).message, 'error'); story.reload(); } finally { setBusy(false); } }}>
            {busy ? <Spinner className="h-4 w-4" /> : s!.status === 'failed' ? 'Try again' : `Publish ${n === 1 ? 'the Story' : `all ${n} Stories`} to Instagram`}
          </button>
          {s!.status === 'draft' && <button className="btn-ghost btn-sm" onClick={async () => { await thamires.skipStory(s!.id); story.reload(); }}>Skip today</button>}
        </div>
      )}
      {s?.status === 'published' && <><p className="font-semibold text-success">✓ Published on Instagram{(s.ig_media_ids?.length ?? 0) > 1 ? ` (${s.ig_media_ids!.length} Stories)` : ''}</p>{s.insights && <Insights i={s.insights} />}</>}
      {s?.status === 'failed' && <p className="text-danger">Not all published: {s.error}</p>}
      <p className="text-xs text-muted">Tip: after publishing, add a Link sticker to dropstudios.ie/app on each Story in the Instagram app so people can tap to book.</p>
    </div>
  );
}

function GuidanceCard({ g, onDone }: { g: ThGuidance; onDone: () => void }) {
  const toast = useToast();
  const [answer, setAnswer] = useState(g.answer ?? '');
  const [editing, setEditing] = useState(g.status === 'open');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await thamires.guide(g.id, answer.trim());
      toast(r.redrafted ? 'Thanks! Thamires rewrote her reply with your answer: check “To approve”.' : 'Saved. Thamires will use this from now on.');
      setEditing(false); onDone();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <li className={`card p-4 ${g.status === 'open' ? 'border-2 border-accent-500' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-bold">{g.question}</p>
        <span className="shrink-0 text-xs text-muted">{fmt.dateTime(g.created_at)}</span>
      </div>
      {g.asked_text && <p className="mt-1 text-sm text-muted">@{g.assistant_threads?.username ?? 'someone'} wrote: “{g.asked_text}”</p>}
      {editing ? (
        <>
          <label className="mt-3 block text-xs font-semibold text-muted">Your answer for Thamires (she’ll put it in her own words, in their language)</label>
          <textarea className="input mt-1 min-h-20" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={2000} placeholder="e.g. Sorry, no pets in the studio, but well-behaved dogs are welcome in the reception area." />
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" disabled={busy || !answer.trim()} onClick={() => void save()}>{busy ? <Spinner className="h-4 w-4" /> : g.status === 'open' ? 'Teach Thamires & draft the reply' : 'Save'}</button>
            {g.status === 'open'
              ? <button className="btn-ghost btn-sm" disabled={busy} onClick={async () => { await thamires.dismissGuidance(g.id); onDone(); }}>Not needed</button>
              : <button className="btn-ghost btn-sm" onClick={() => { setAnswer(g.answer ?? ''); setEditing(false); }}>Cancel</button>}
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 rounded-xl bg-success/10 p-3 text-sm"><strong>Your answer:</strong> {g.answer}</p>
          <div className="mt-2 flex gap-3 text-sm">
            <button className="font-semibold text-brand-700" onClick={() => setEditing(true)}>Change</button>
            <button className="font-semibold text-muted" onClick={async () => { await thamires.dismissGuidance(g.id); toast('Thamires won’t use this any more'); onDone(); }}>Remove</button>
          </div>
        </>
      )}
    </li>
  );
}

function Guidance({ list, onDone }: { list: ThGuidance[]; onDone: () => void }) {
  const open = list.filter((g) => g.status === 'open');
  const answered = list.filter((g) => g.status === 'answered');
  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-bold">Questions waiting for you</h3>
        <p className="text-sm text-muted">When someone asks Thamires something new or unusual, she doesn’t guess: she tells them she’s checking and asks you here (you also get an email).</p>
        {open.length ? <ul className="mt-3 space-y-3">{open.map((g) => <GuidanceCard key={g.id} g={g} onDone={onDone} />)}</ul> : <p className="mt-3 text-sm text-muted">No questions waiting. 🎉</p>}
      </section>
      {answered.length > 0 && (
        <section>
          <h3 className="font-bold">What you’ve taught her ({answered.length})</h3>
          <p className="text-sm text-muted">Thamires uses these answers for everyone who asks the same thing.</p>
          <ul className="mt-3 space-y-3">{answered.map((g) => <GuidanceCard key={g.id} g={g} onDone={onDone} />)}</ul>
        </section>
      )}
    </div>
  );
}

const TOPIC_LABEL: Record<string, string> = { timetable: 'Timetable', prices: 'Prices', booking: 'Booking', class_info: 'Class info', location: 'Location', events: 'Events', thanks: 'Thank-yous', complaint: 'Complaints', refund_or_payment: 'Refunds & payments', other: 'Other' };

function Reports({ reload }: { reload: number }) {
  const toast = useToast();
  const reports = useAsync(() => thamires.reports(), [reload]);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Thamires emails you this every evening. The last two weeks are kept here.</p>
        <button className="btn-outline btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { await thamires.reportNow(); reports.reload(); toast('Report made and emailed to you'); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>{busy ? <Spinner className="h-4 w-4" /> : 'Make today’s report now'}</button>
      </div>
      {reports.loading && !reports.data ? <Spinner /> : !reports.data?.length ? <p className="text-sm text-muted">No reports yet. The first one arrives this evening once Thamires is on.</p> : (
        <ul className="space-y-3">
          {reports.data.map((r: ThReport) => (
            <li key={r.id} className="card p-4">
              <p className="font-bold">{new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${r.report_date}T12:00:00`))}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="chip bg-brand-50 text-brand-700">💬 {r.stats.messages_in} messages</span>
                <span className="chip bg-brand-50 text-brand-700">🙋 {r.stats.people} people{r.stats.new_people ? ` (${r.stats.new_people} new)` : ''}</span>
                <span className="chip bg-brand-50 text-brand-700">✉️ {r.stats.replies_sent} replies sent</span>
                {r.stats.tags > 0 && <span className="chip bg-brand-50 text-brand-700">📸 {r.stats.tags} tags</span>}
                {(r.stats.comments ?? 0) > 0 && <span className="chip bg-brand-50 text-brand-700">💭 {r.stats.comments} comments ({r.stats.comments_replied ?? 0} replied)</span>}
                {(r.stats.reactions_week ?? 0) > 0 && <span className="chip bg-brand-50 text-brand-700">❤️ {r.stats.reactions_week} reactions this week</span>}
                {r.stats.last_story && <span className="chip bg-brand-50 text-brand-700">🗓️ Last Story: {r.stats.last_story.reach ?? 0} reached</span>}
                {(r.stats.open_questions > 0 || r.stats.waiting > 0) && <span className="chip bg-accent-50 text-accent-600">⏳ {r.stats.open_questions} questions · {r.stats.waiting} to approve</span>}
              </div>
              {r.summary && <p className="mt-3 text-sm">{r.summary}</p>}
              {r.themes.length > 0 && <><p className="mt-3 text-xs font-semibold uppercase text-muted">What people talked about</p><ul className="mt-1 text-sm">{r.themes.map((t, i) => <li key={i}>• {t.theme} <span className="text-muted">({t.count})</span></li>)}</ul></>}
              {!r.themes.length && Object.keys(r.stats.topics ?? {}).length > 0 && <p className="mt-3 text-sm">{Object.entries(r.stats.topics).map(([k, v]) => `${TOPIC_LABEL[k] ?? k} (${v})`).join(' · ')}</p>}
              {r.stats.new_questions?.length > 0 && <><p className="mt-3 text-xs font-semibold uppercase text-muted">New questions</p><ul className="mt-1 text-sm">{r.stats.new_questions.map((q, i) => <li key={i}>• {q.question} {q.answered ? <span className="text-success">✓</span> : <span className="text-accent-600">(waiting for you)</span>}</li>)}</ul></>}
              {r.suggestions.length > 0 && <><p className="mt-3 text-xs font-semibold uppercase text-muted">Ideas from Thamires</p><ul className="mt-1 text-sm">{r.suggestions.map((t, i) => <li key={i}>💡 {t}</li>)}</ul></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TryHer() {
  const toast = useToast();
  const [history, setHistory] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [lang, setLang] = useState<{ language: string | null; offered: boolean }>({ language: null, offered: false });
  const [memory, setMemory] = useState<string | null>(null);
  async function ask() {
    const next = [...history, { from: 'member' as const, text: text.trim() }];
    setHistory(next); setText(''); setBusy(true);
    try {
      const d = await thamires.test(next, { display_name: name || undefined, language: lang.language, language_offered: lang.offered, memory });
      if (d.memory) setMemory(d.memory);
      setHistory([...next, { from: 'thamires', text: d.reply }]);
      setLang({ language: d.offered_language ? lang.language : d.language, offered: lang.offered || d.offered_language });
      setMeta(`${d.language} · ${d.topic}${d.out_of_ordinary ? ` · 🤔 new question, she’d ask you: “${d.question_en}”` : d.needs_human ? ' · would wait for a person' : ''} · ${d.reason}${d.translation_en ? ` · In English: ${d.translation_en}` : ''}`);
    }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  return (
    <div className="card p-4">
      <p className="text-sm text-muted">Ask her anything a member might, in any language, to check her answers. Nothing is sent to Instagram. Press “New chat” to see how she greets someone coming back: she keeps what she remembered.</p>
      <input className="input mt-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pretend name (optional), e.g. João Silva" />
      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {history.map((t, i) => <li key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${t.from === 'member' ? 'bg-canvas' : 'ml-auto bg-brand-600 text-white'}`}>{t.text}</li>)}
        {busy && <li className="ml-auto w-fit rounded-2xl bg-brand-50 px-3 py-2 text-sm">Thamires is typing…</li>}
      </ul>
      {meta && <p className="mt-2 text-xs text-muted">{meta}</p>}
      {memory && <p className="mt-1 text-xs text-accent-600">💭 She’d remember: {memory}</p>}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void ask(); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Is there a beginners heels class this week?" />
        <button className="btn-primary btn-sm" disabled={busy || !text.trim()}>Ask</button>
        {history.length > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => { setHistory([]); setMeta(null); setLang({ language: null, offered: false }); }}>New chat</button>}
      </form>
    </div>
  );
}

export default function AdminThamires() {
  const [tick, setTick] = useState(0);
  const settings = useAsync(() => thamires.settings(), [tick]);
  const status = useAsync(() => thamires.status().catch(() => null), []);
  const drafts = useAsync(() => thamires.drafts(), [tick]);
  const mentions = useAsync(() => thamires.mentions(), [tick]);
  const guidance = useAsync(() => thamires.guidance(), [tick]);
  const comments = useAsync(() => thamires.comments(), [tick]);
  const pendingComments = useMemo(() => (comments.data ?? []).filter((c) => c.reply_status === 'draft').length, [comments.data]);
  const pendingTags = useMemo(() => (mentions.data ?? []).filter((m) => m.reply_status === 'draft').length, [mentions.data]);
  const openQuestions = useMemo(() => (guidance.data ?? []).filter((g) => g.status === 'open').length, [guidance.data]);
  const [tab, setTab] = useState<'inbox' | 'questions' | 'chats' | 'comments' | 'tags' | 'story' | 'promos' | 'reports' | 'try'>('inbox');
  useEffect(() => { const h = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(h); }, []);
  if (settings.loading && !settings.data) return <PageSpinner />;
  if (settings.error || !settings.data) return <ErrorNotice error={settings.error ?? 'Thamires isn’t set up yet.'} onRetry={settings.reload} />;
  const refresh = () => setTick((n) => n + 1);
  const tabs: [typeof tab, string][] = [['inbox', `To approve${drafts.data?.length ? ` (${drafts.data.length})` : ''}`], ['questions', `Questions for you${openQuestions ? ` (${openQuestions})` : ''}`], ['chats', 'Conversations'], ['comments', `Comments${pendingComments ? ` (${pendingComments})` : ''}`], ['tags', `Tags${pendingTags ? ` (${pendingTags})` : ''}`], ['story', 'Today’s Story'], ['promos', 'Promos'], ['reports', 'Daily reports'], ['try', 'Try her']];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-accent-500 to-brand-600 text-2xl font-black text-white">T</span>
        <div><h2 className="text-2xl font-black">Thamires</h2><p className="text-sm text-muted">Drop’s AI assistant for Instagram. She tells people she’s a virtual assistant, and passes anything sensitive to you.</p></div>
      </div>
      <Setup s={settings.data} onSaved={refresh} status={status.data ?? null} />
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${tab === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted'}`}>{label}</button>)}
      </div>
      {tab === 'inbox' && (drafts.data?.length ? <ul className="space-y-3">{drafts.data.map((m) => <DraftCard key={m.id} m={m} onDone={refresh} />)}</ul> : <p className="text-sm text-muted">Nothing waiting. New replies Thamires drafts appear here, and you get an email.</p>)}
      {tab === 'questions' && <Guidance list={guidance.data ?? []} onDone={refresh} />}
      {tab === 'chats' && <Conversations reload={tick} />}
      {tab === 'comments' && <Comments list={comments.data ?? []} onDone={refresh} />}
      {tab === 'tags' && <Tags list={mentions.data ?? []} onDone={refresh} />}
      {tab === 'story' && <><TodayStory reload={refresh} /><RecentStories reload={tick} /></>}
      {tab === 'promos' && <Promos reload={tick} />}
      {tab === 'reports' && <Reports reload={tick} />}
      {tab === 'try' && <TryHer />}
    </div>
  );
}
