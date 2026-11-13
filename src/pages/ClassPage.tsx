import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { api } from '../api';
import { classPages, setPageMeta, WEEKDAYS } from '../lib/classPages';
import { classImage } from '../config/classImages';
import { formatPrice } from '../domain/money';
import { classesLabel } from '../domain/plans';
import { STUDIO } from '../config/studio';
import { ErrorNotice, PageSpinner } from '../components/ui';

const DEFAULT_TITLE = 'Drop Studios — Dance & Fitness, Dublin';

/** One public page per class style: what it is, level, what to wear and bring, instructors and when it runs. */
export default function ClassPage() {
  const { slug = '' } = useParams();
  const data = useAsync(() => classPages.page(slug), [slug]);
  const styles = useAsync(() => api.styles(), []);
  const plans = useAsync(() => api.plans(), []);
  const intro = plans.data?.find((p) => p.first_time_only);
  const page = data.data;

  useEffect(() => {
    if (!page) return;
    const s = page.style;
    setPageMeta(`${s.name} classes in Dublin | ${STUDIO.name}`,
      `${s.name} dance classes in Dublin city centre at ${STUDIO.name}. ${s.level ?? ''} ${s.description ?? ''}`.replace(/\s+/g, ' '));
    return () => { document.title = DEFAULT_TITLE; };
  }, [page]);

  if (data.loading && !page) return <PageSpinner />;
  if (data.error) return <div className="container-page py-10"><ErrorNotice error={data.error} onRetry={data.reload} /></div>;
  if (!page) return <div className="container-page py-16 text-center"><h1 className="text-3xl font-black">Class not found</h1><Link to="/classes" className="btn-primary mt-6">See all classes</Link></div>;

  const s = page.style;
  const art = classImage(s.slug);
  const facts = [
    ['🎯', 'Level', s.level],
    ['👟', 'What to wear', s.what_to_wear],
    ['🎒', 'What to bring', s.what_to_bring],
    ['👋', 'Your first class', s.first_class],
  ].filter(([, , v]) => v) as [string, string, string][];

  return (
    <article>
      <header className="bg-ink text-white">
        <div className="container-page grid items-center gap-6 py-8 md:grid-cols-2 md:py-12">
          <div>
            <p className="chip bg-white/10 text-accent-400">Dance classes in Dublin city centre</p>
            <h1 className="mt-3 font-display text-5xl font-black uppercase leading-none sm:text-6xl">{s.name}</h1>
            {s.level && <p className="mt-3 text-lg text-white/85">{s.level}</p>}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Link to={`/timetable?style=${s.slug}`} className="btn-accent text-lg">Book a {s.name} class</Link>
              {intro && <Link to={`/checkout/${intro.code}`} className="btn border-2 border-white/30 text-lg text-white hover:bg-white/10">New? {classesLabel(intro.class_count)} for {formatPrice(intro.price_cents, intro.currency)}</Link>}
            </div>
            {s.drop_in_price_cents != null && <p className="mt-3 text-sm text-white/70">Or drop in for {formatPrice(s.drop_in_price_cents, 'EUR')}. First time? Bring a friend free.</p>}
          </div>
          {art
            ? <img src={art.wide} alt={`${s.name} class at ${STUDIO.name}`} width={1280} height={720} className="w-full rounded-2xl" />
            : <div className="aspect-video w-full rounded-2xl" style={{ background: s.color }} />}
        </div>
      </header>

      <div className="container-page grid gap-10 py-10 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-10">
          {s.description && (
            <section aria-labelledby="about-h">
              <h2 id="about-h" className="text-2xl font-black">About the class</h2>
              <p className="mt-3 whitespace-pre-line text-lg leading-relaxed text-ink-soft">{s.description}</p>
            </section>
          )}

          {facts.length > 0 && (
            <section aria-labelledby="know-h">
              <h2 id="know-h" className="text-2xl font-black">Good to know</h2>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                {facts.map(([icon, label, value]) => (
                  <div key={label} className="card p-4">
                    <dt className="font-display font-extrabold">{icon} {label}</dt>
                    <dd className="mt-1 whitespace-pre-line text-sm text-ink-soft">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {page.instructors.length > 0 && (
            <section aria-labelledby="who-h">
              <h2 id="who-h" className="text-2xl font-black">{page.instructors.length > 1 ? 'Your instructors' : 'Your instructor'}</h2>
              <ul className="mt-4 space-y-3">
                {page.instructors.map((i) => (
                  <li key={i.id} className="card flex gap-4 p-4">
                    {i.photo_url
                      ? <img src={i.photo_url} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
                      : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-display text-2xl font-black text-white" style={{ background: s.color }}>{i.full_name[0]}</span>}
                    <div className="min-w-0">
                      <p className="font-display text-lg font-extrabold">{i.full_name}</p>
                      {i.bio && <p className="mt-1 whitespace-pre-line text-sm text-ink-soft">{i.bio}</p>}
                      {i.instagram && <a href={`https://instagram.com/${i.instagram}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm font-semibold text-brand-700">@{i.instagram}</a>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="card p-5" aria-labelledby="when-h">
            <h2 id="when-h" className="text-xl font-black">When it runs</h2>
            {page.weekly.length === 0 ? <p className="mt-2 text-sm text-muted">Check the timetable for the next class.</p> : (
              <ul className="mt-3 divide-y divide-line">
                {page.weekly.map((w, n) => (
                  <li key={n} className="flex items-baseline justify-between gap-3 py-2">
                    <span className="font-semibold">{WEEKDAYS[w.weekday % 7]}s</span>
                    <span className="text-right text-sm text-ink-soft">{w.start_time} · {w.duration_minutes} min{w.instructor ? <><br />with {w.instructor}</> : ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <Link to={`/timetable?style=${s.slug}`} className="btn-primary mt-4 w-full">See dates and book</Link>
            <p className="mt-3 text-xs text-muted">{STUDIO.address}. Free cancellation up to 30 minutes before class.</p>
          </section>

          {styles.data && styles.data.length > 1 && (
            <nav aria-label="Other classes" className="card p-5">
              <h2 className="font-display font-extrabold">Other classes at Drop</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {styles.data.filter((x) => x.slug !== s.slug).map((x) => (
                  <li key={x.id}><Link to={`/classes/${x.slug}`} className="chip bg-canvas hover:bg-brand-50">{x.name}</Link></li>
                ))}
              </ul>
            </nav>
          )}
        </aside>
      </div>
    </article>
  );
}

/** All classes, each linking to its page. */
export function ClassesIndex() {
  const styles = useAsync(() => api.styles(), []);
  useEffect(() => {
    setPageMeta(`Dance classes in Dublin | ${STUDIO.name}`, `FitDance, Commercial, Hip Hop, Heels, Jazz Funk, Reggaeton and Choreography classes for every level in Dublin city centre at ${STUDIO.name}.`);
    return () => { document.title = DEFAULT_TITLE; };
  }, []);
  return (
    <div className="container-page py-10">
      <h1 className="text-3xl font-black sm:text-4xl">Our classes</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">Dance and fitness classes for every level, in the heart of Dublin. Pick a class to see what it's like, what to wear and when it runs.</p>
      {styles.loading && !styles.data ? <PageSpinner /> : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {styles.data?.map((s) => {
            const art = classImage(s.slug);
            return (
              <li key={s.id}>
                <Link to={`/classes/${s.slug}`} className="group block overflow-hidden rounded-2xl ring-1 ring-line transition hover:-translate-y-1">
                  {art ? <img src={art.card} alt={`${s.name} class`} loading="lazy" width={720} height={900} className="aspect-[4/5] w-full object-cover" />
                    : <span className="flex aspect-[4/5] w-full items-end p-4 font-display text-3xl font-black uppercase text-white" style={{ background: s.color }}>{s.name}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
