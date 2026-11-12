import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../lib/useAsync';
import { formatPrice } from '../domain/money';
import { classesLabel, sortPlans } from '../domain/plans';
import { addDaysToKey, fmt, localDateKey, zonedTime } from '../domain/time';
import { availabilityLabel } from '../domain/booking';
import { STUDIO } from '../config/studio';
import { useAuth } from '../auth/AuthProvider';
import { CalendarIcon, PinIcon, TicketIcon, UserIcon } from '../components/icons';
import { isStandalone } from '../components/pwa';
import StaffHome from './StaffHome';

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
    return list.filter((s) => s.status === 'scheduled').slice(0, 6);
  }, [today]);
  const styles = useAsync(() => api.styles(), []);
  const plans = useAsync(() => api.plans(), []);
  const intro = plans.data?.find((p) => p.first_time_only);
  const cheapestRegular = sortPlans(plans.data?.filter((p) => !p.first_time_only) ?? [])[0];
  const next = upcoming.data?.find((s) => !s.is_special) ?? upcoming.data?.[0];

  return (
    <>
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-600 opacity-60 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-accent-500 opacity-40 blur-3xl" />
        <div className="container-page relative grid gap-10 py-12 sm:py-20 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <p className="chip bg-white/10 text-accent-400">{STUDIO.tagline} · {STUDIO.city}</p>
            <h1 className="mt-4 text-5xl font-black leading-[0.95] sm:text-7xl">
              Feel the beat.<br /><span className="text-accent-500">Drop</span> in.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/80">
              Dance and fitness classes for every level. Book your spot in seconds, straight from your phone.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/timetable" className="btn-accent text-lg">View timetable</Link>
              <Link to="/memberships" className="btn border-2 border-white/30 text-lg text-white hover:bg-white/10">
                {intro ? `New here? ${classesLabel(intro.class_count)} for ${formatPrice(intro.price_cents, intro.currency)}` : 'See memberships'}
              </Link>
            </div>
          </div>

          {next && (
            <Link to="/timetable" className="block rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur transition hover:bg-white/15">
              <p className="text-xs font-bold uppercase tracking-widest text-accent-400">Next class</p>
              <p className="mt-2 font-display text-2xl font-black">{next.title}</p>
              <p className="mt-1 text-white/80">{fmt.weekdayLong(next.starts_at)} · {fmt.time(next.starts_at)}</p>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: next.style?.color }} />
                  {next.style?.name}{next.instructor ? ` · ${next.instructor.full_name}` : ''}
                </span>
                {availabilityLabel(next.availability) && <span className="font-semibold text-accent-400">{availabilityLabel(next.availability)}</span>}
              </div>
            </Link>
          )}
        </div>

      </section>

      <section className="container-page py-10 sm:py-12">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-black sm:text-3xl">Coming up</h2>
          <Link to="/timetable" className="text-sm font-semibold text-brand-700">Full timetable →</Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {upcoming.data?.map((s) => (
            <Link key={s.id} to="/timetable" className="card flex items-center gap-4 p-4 transition hover:shadow-md">
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
        <section className="bg-white py-12">
          <div className="container-page">
            <h2 className="text-2xl font-black sm:text-3xl">Our styles</h2>
            <div className="mt-5 flex flex-wrap gap-2">
              {styles.data.map((s) => (
                <Link key={s.id} to={`/timetable?style=${s.slug}`} className="rounded-full px-5 py-3 font-display text-lg font-extrabold text-white transition hover:scale-105" style={{ background: s.color }}>
                  {s.name}
                </Link>
              ))}
            </div>
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
