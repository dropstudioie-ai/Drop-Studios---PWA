import { NavLink, Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from './Logo';
import { CalendarIcon, HomeIcon, ShieldIcon, SparkleIcon, TicketIcon, UserIcon, UsersIcon } from './icons';
import { InstallPrompt, OfflineBanner, UpdatePrompt, isStandalone } from './pwa';
import { OutOfClassesPrompt } from './OutOfClasses';
import { NotificationsPrompt } from './NotificationsPrompt';
import { STUDIO } from '../config/studio';

const navCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:text-ink'}`;

export function Layout() {
  const { session, isAdmin, isStaff } = useAuth();
  const installed = isStandalone();
  return (
    <div className="flex min-h-dvh flex-col">
      <UpdatePrompt />
      {!isStaff && <OutOfClassesPrompt />}
      <NotificationsPrompt />
      <OfflineBanner />
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="container-page flex h-14 items-center justify-between md:h-16">
          <Link to="/" aria-label="Drop Studios home"><Logo height={26} /></Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {isStaff && <NavLink to="/" end className={navCls}>Today</NavLink>}
            {isStaff && <NavLink to="/teach" end className={navCls}>{isAdmin ? 'Classes' : 'My classes'}</NavLink>}
            {isStaff && !isAdmin && <NavLink to="/teach/events" className={navCls}>Events</NavLink>}
            <NavLink to="/timetable" className={navCls}>Timetable</NavLink>
            {!isStaff && <NavLink to="/memberships" className={navCls}>Memberships</NavLink>}
            {isAdmin && <NavLink to="/admin/customers" className={navCls}>Members</NavLink>}
            {isAdmin && <NavLink to="/admin" end className={navCls}>Admin</NavLink>}
            {session ? (
              <NavLink to="/account" className={navCls}>{isStaff ? 'My account' : 'My Membership'}</NavLink>
            ) : (
              <>
                <NavLink to="/login" className={navCls}>Log in</NavLink>
                <Link to="/register" className="btn-sm btn-primary ml-2">Join now</Link>
              </>
            )}
          </nav>
          {!session && <Link to="/register" className="btn-sm btn-accent md:hidden">Join</Link>}

        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-12 border-t border-line bg-white pb-20 md:pb-0">
        <div className="container-page flex flex-wrap items-center justify-between gap-4 py-8 text-sm text-muted">
          <div>
            <Logo height={22} />
            <p className="mt-2">{STUDIO.tagline} · {STUDIO.address ? <a href={STUDIO.mapsUrl} target="_blank" rel="noreferrer" className="hover:text-ink">{STUDIO.address}</a> : STUDIO.city}</p>
          </div>
          <div className="flex flex-wrap gap-4">
            {STUDIO.email && <a href={`mailto:${STUDIO.email}`} className="hover:text-ink">{STUDIO.email}</a>}
            {STUDIO.phone && <a href={STUDIO.phoneHref} className="hover:text-ink">{STUDIO.phone}{STUDIO.contactName ? ` (${STUDIO.contactName})` : ''}</a>}
            {STUDIO.instagram && <a href={STUDIO.instagram} className="hover:text-ink" rel="noreferrer" target="_blank">Instagram</a>}
            {!isStaff && <Link to="/memberships" className="hover:text-ink">Memberships</Link>}
            <Link to="/timetable" className="hover:text-ink">Timetable</Link>
            {!installed && <Link to="/app" className="font-semibold text-brand-700 hover:text-ink">Get the app</Link>}
            <Link to="/terms" className="hover:text-ink">Terms</Link>
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
          </div>
        </div>
      </footer>

      <BottomNav signedIn={Boolean(session)} staff={isStaff} admin={isAdmin} />
      <InstallPrompt />
    </div>
  );
}

function BottomNav({ signedIn, staff, admin }: { signedIn: boolean; staff: boolean; admin: boolean }) {
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? 'text-brand-600' : 'text-muted'}`;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="App">
      {admin ? (
        <>
          <NavLink to="/" end className={item}><HomeIcon />Today</NavLink>
          <NavLink to="/teach" end className={item}><CalendarIcon />Classes</NavLink>
          <NavLink to="/admin/customers" className={item}><UsersIcon />Members</NavLink>
          <NavLink to="/admin" end className={item}><ShieldIcon />Admin</NavLink>
        </>
      ) : staff ? (
        <>
          <NavLink to="/" end className={item}><HomeIcon />Today</NavLink>
          <NavLink to="/teach" end className={item}><UsersIcon />My classes</NavLink>
          <NavLink to="/teach/events" className={item}><SparkleIcon />Events</NavLink>
          <NavLink to="/timetable" className={item}><CalendarIcon />Timetable</NavLink>
        </>
      ) : (
        <>
          <NavLink to="/" end className={item}><HomeIcon />Home</NavLink>
          <NavLink to="/timetable" className={item}><CalendarIcon />Timetable</NavLink>
          <NavLink to="/memberships" className={item}><TicketIcon />Plans</NavLink>
        </>
      )}
      <NavLink to={signedIn ? '/account' : '/login'} className={item}><UserIcon />{signedIn ? 'Me' : 'Log in'}</NavLink>
    </nav>
  );
}
