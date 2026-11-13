import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { formatPrice } from '../domain/money';
import { classesLabel, sortPlans } from '../domain/plans';
import { addDaysToKey, fmt, localDateKey, zonedTime } from '../domain/time';
import { STUDIO } from '../config/studio';
import { useAuth } from '../auth/AuthProvider';
import { CalendarIcon, PinIcon, TicketIcon, UserIcon } from '../components/icons';
import { isStandalone } from '../components/pwa';
import { classImage } from '../config/classImages';
import StaffHome from './StaffHome';
import { FeedbackPrompt } from './Feedback';

export default function Home() {
  const { isStaff } = useAuth();
  return isStaff ? <StaffHome /> : <MemberHome />;
}

function MemberHome() {
  const { session } = useAuth();
  const installed = isStandalone();
  const today = localDateKey(new Date());
  const upcoming = useAsync(async () => {
    const list = await api.sessions(new Date().toISOString(), zonedTime(addDaysToKey(today, 3)).toISOString());
    return list.filter((s) => s.status === 'scheduled' && new Date(s.starts_at) > new Date()).slice(0, 6);
  }, [today]);
  const styles = useAsync(() => api.styles(), []);
  const plans = useAsync(() => api.plans(), []);
  const intro = plans.data?.find((p) => p.first_time_only);
  const cheapestRegular = sortPlans(plans.data?.filter((p) => !p.first_time_only) ?? [])[0];

  return (
    <>
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-600 opacity-60 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-accent-500 opacity-40 blur-3xl" />
        <div className="container-page relative py-8 sm:py-12">
          <p className="chip bg-white/10 text-accent-400">{STUDIO.tagline} · {STUDIO.city}</p>
          <h1 className="mt-3 text-4xl font-black leading-[0.95] sm:text-6xl">
            {session ? <>Ready to <span className="text-accent-500">dance?</span></> : <>Book your <span className="text-accent-500">first class.</span></>}
          </h1>
          <p className="mt-3 max-w-xl text-white/80">
            {session
              ? 'Pick a class below and book your spot in seconds.'
              : <>Dance and fitness classes for every level in Dublin.{intro ? <> New here? <strong className="text-white">{classesLabel(intro.class_count)} for {formatPrice(intro.price_cents, intro.currency)}</strong>, or come as a Drop In and <strong className="text-white">bring a friend free</strong>.</> : ''}</>}
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            {!session && intro
              ? <Link to={`/checkout/${intro.code}`} className="btn-accent text-lg">Start with the Intro Offer</Link>
              : <Link to="/timetable" className="btn-accent text-lg">Book a class</Link>}
            <Link to="/timetable" className="btn border-2 border-white/30 text-lg text-white hover:bg-white/10">{!session && intro ? 'See the timetable' : 'Full timetable'}</Link>
          </div>
        </div>
      </section>

      {session && <div className="container-page pt-6"><FeedbackPrompt /></div>}

      <section className="container-page py-10 sm:py-12">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-black sm:text-3xl">Next classes</h2>
          <Link to="/timetable" className="text-sm font-semibold text-brand-700">Full timetable →</Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.data?.map((s) => (
            <Link key={s.id} to={`/timetable?class=${s.id}`} className="card flex items-center gap-4 p-4 transition hover:shadow-md">
              <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl text-white" style={{ background: s.style?.color ?? '#1f43e6' }}>
                <span className="text-[10px] font-semibold uppercase">{fmt.weekdayShort(s.starts_at)}</span>
                <span className="font-display font-extrabold">{fmt.time(s.starts_at)}</span>
              </span>
              <span>
                <span className="block font-bold">{s.title}</span>
                <span className="text-sm text-muted">{s.style?.name}{s.instructor ? ` · ${s.instructor.full_name}` : ''}</span>
              </span>
            </Link>
          ))}
          {upcoming.data?.length === 0 && <p className="text-muted">No classes scheduled in the next few days. Check the full timetable.</p>}
        </div>
      </section>

      {styles.data && styles.data.length > 0 && (
        <section className="bg-ink py-12 text-white" aria-labelledby="styles-h">
          <div className="container-page">
            <div className="flex items-end justify-between gap-3">
              <h2 id="styles-h" className="text-2xl font-black sm:text-3xl">Our classes</h2>
              <Link to="/classes" className="text-sm font-semibold text-accent-400">About each class →</Link>
            </div>
            <ul className="-mx-4 mt-5 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4">
              {styles.data.map((s) => {
                const art = classImage(s.slug);
                return (
                  <li key={s.id} className="w-[64%] shrink-0 snap-start sm:w-auto">
                    <Link to={`/classes/${s.slug}`} className="group block overflow-hidden rounded-2xl ring-1 ring-white/10 transition hover:-translate-y-1 hover:ring-white/40">
                      {art ? (
                        <img src={art.card} alt={`${s.name} class`} loading="lazy" width={720} height={900} className="aspect-[4/5] w-full object-cover" />
                      ) : (
                        <span className="flex aspect-[4/5] w-full items-end p-5 font-display text-4xl font-black uppercase" style={{ background: s.color }}>{s.name}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <section className="container-page py-12">
        <h2 className="text-2xl font-black sm:text-3xl">How it works</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { icon: <UserIcon />, title: 'Create your account', text: 'Sign up in under a minute.' },
            { icon: <TicketIcon />, title: 'Pick a membership', text: cheapestRegular ? `Monthly memberships from ${formatPrice(cheapestRegular.price_cents, cheapestRegular.currency)}, or try 3 classes with the Intro Offer.` : 'Monthly memberships, or try 3 classes with the Intro Offer.' },
            { icon: <CalendarIcon />, title: 'Book your classes', text: 'Reserve up to 3 weeks ahead. Free cancellation up to 30 minutes before.' },
          ].map((step, i) => (
            <li key={step.title} className="card p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">{step.icon}</span>
              <p className="mt-3 text-xs font-bold uppercase tracking-wider text-accent-600">Step {i + 1}</p>
              <p className="mt-1 font-display text-lg font-extrabold">{step.title}</p>
              <p className="mt-1 text-sm text-ink-soft">{step.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {!session && <Link to="/register" className="btn-accent text-lg">Create your free account</Link>}
          <Link to="/memberships" className="btn-primary text-lg">See memberships</Link>
        </div>
      </section>

      {!installed && <section className="bg-ink py-12 text-white" aria-labelledby="app-h">
        <div className="container-page flex flex-col items-center gap-6 text-center md:flex-row md:text-left">
          <img src="/brand/drop-icon.svg" alt="" className="h-20 w-20 shrink-0 rounded-3xl shadow-xl" />
          <div className="flex-1">
            <h2 id="app-h" className="font-display text-3xl font-black uppercase tracking-tight">Get the Drop app</h2>
            <p className="mt-2 max-w-xl text-white/80">Book classes in one tap, get reminders and manage your membership from your phone. Free, no app store needed.</p>
          </div>
          <Link to="/app" className="btn-accent shrink-0 text-lg">Download the app</Link>
        </div>
      </section>}

      {(STUDIO.address || STUDIO.email || STUDIO.phone) && (
        <section className="bg-white py-12">
          <div className="container-page flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <PinIcon className="mt-1 text-accent-600" />
              <div>
                <h2 className="text-xl font-black">Find us</h2>
                {STUDIO.address && <p className="text-ink-soft">{STUDIO.address}</p>}
                {STUDIO.phone && (
                  <p className="mt-1 text-sm text-muted">
                    Contact {STUDIO.contactName ? `${STUDIO.contactName}: ` : ''}
                    <a href={STUDIO.phoneHref} className="font-semibold text-brand-700">{STUDIO.phone}</a>
                    {STUDIO.email && <> · <a href={`mailto:${STUDIO.email}`} className="font-semibold text-brand-700">{STUDIO.email}</a></>}
                  </p>
                )}
              </div>
            </div>
            {STUDIO.mapsUrl && <a href={STUDIO.mapsUrl} target="_blank" rel="noreferrer" className="btn-outline">Get directions</a>}
          </div>
        </section>
      )}
    </>
  );
}
