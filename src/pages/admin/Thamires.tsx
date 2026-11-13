import { useEffect, useMemo, useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { renderStory, thamires, type ThMessage, type ThMention, type ThSettings, type ThThread, type ThStory, type Turn } from '../../lib/thamires';
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
        <Switch label="Prepare a daily Story" hint="Today's classes, ready for you to publish in one tap." checked={s.daily_story} disabled={!s.enabled} onChange={(v) => void save({ daily_story: v })} />
      </div>
      {s.daily_story && (
        <label className="mt-2 flex items-center gap-2 text-sm">Ready by
          <select className="input w-28" value={s.story_hour} onChange={(e) => void save({ story_hour: Number(e.target.value) })}>
            {Array.from({ length: 15 }, (_, i) => i + 6).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
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
                {m.text}{m.status === 'draft' && <span className="block text-[11px]">draft, waiting for approval</span>}{m.status === 'failed' && <span className="block text-[11px]">not sent: {m.error}</span>}
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

function TodayStory({ reload }: { reload: () => void }) {
  const toast = useToast();
  const today = localDateKey(new Date());
  const story = useAsync(() => thamires.story(today), [today]);
  const [img, setImg] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!story.data || !story.data.lines.length) { setImg(null); return; }
    let live = true;
    void renderStory(story.data as ThStory).then((blob) => { if (live) setImg({ blob, url: URL.createObjectURL(blob) }); });
    return () => { live = false; };
  }, [story.data]);
  const s = story.data;
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="w-48 shrink-0 overflow-hidden rounded-2xl bg-ink" style={{ aspectRatio: '9 / 16' }}>
        {img ? <img src={img.url} alt="Today's Story" className="h-full w-full" /> : <span className="flex h-full items-center justify-center p-4 text-center text-sm text-white/70">{story.loading ? 'Loading…' : s?.status === 'skipped' ? 'No classes today' : 'No Story yet today'}</span>}
      </div>
      <div className="space-y-2 text-sm">
        {!s && <><p>Thamires prepares the Story automatically each morning. You can make it now:</p><button className="btn-primary btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { await thamires.prepareStory(); story.reload(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>Prepare today’s Story</button></>}
        {s?.status === 'draft' && img && (
          <>
            <p>Today’s classes, ready to post.</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary btn-sm" disabled={busy} onClick={async () => { setBusy(true); try { await thamires.publishStory(s.id, img.blob); toast('Story published on Instagram'); story.reload(); reload(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); } }}>{busy ? <Spinner className="h-4 w-4" /> : 'Publish to Instagram'}</button>
              <a className="btn-outline btn-sm" href={img.url} download={`drop-story-${today}.png`}>Download</a>
              <button className="btn-ghost btn-sm" onClick={async () => { await thamires.skipStory(s.id); story.reload(); }}>Skip today</button>
            </div>
          </>
        )}
        {s?.status === 'published' && <p className="font-semibold text-success">✓ Published on Instagram</p>}
        {s?.status === 'failed' && <p className="text-danger">Not published: {s.error}</p>}
      </div>
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
      setMeta(`${d.language} · ${d.topic}${d.needs_human ? ' · would wait for a person' : ''} · ${d.reason}${d.translation_en ? ` · In English: ${d.translation_en}` : ''}`);
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
  const pendingTags = useMemo(() => (mentions.data ?? []).filter((m) => m.reply_status === 'draft').length, [mentions.data]);
  const [tab, setTab] = useState<'inbox' | 'chats' | 'tags' | 'story' | 'try'>('inbox');
  useEffect(() => { const h = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(h); }, []);
  if (settings.loading && !settings.data) return <PageSpinner />;
  if (settings.error || !settings.data) return <ErrorNotice error={settings.error ?? 'Thamires isn’t set up yet.'} onRetry={settings.reload} />;
  const refresh = () => setTick((n) => n + 1);
  const tabs: [typeof tab, string][] = [['inbox', `To approve${drafts.data?.length ? ` (${drafts.data.length})` : ''}`], ['chats', 'Conversations'], ['tags', `Tags${pendingTags ? ` (${pendingTags})` : ''}`], ['story', 'Today’s Story'], ['try', 'Try her']];
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
      {tab === 'chats' && <Conversations reload={tick} />}
      {tab === 'tags' && <Tags list={mentions.data ?? []} onDone={refresh} />}
      {tab === 'story' && <TodayStory reload={refresh} />}
      {tab === 'try' && <TryHer />}
    </div>
  );
}
