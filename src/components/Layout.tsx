import { NavLink, Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from './Logo';
import { CalendarIcon, HomeIcon, ShieldIcon, TicketIcon, UserIcon, UsersIcon } from './icons';
import { InstallPrompt, OfflineBanner, UpdatePrompt } from './pwa';
import { STUDIO } from '../config/studio';

const navCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:text-ink'}`;

export function Layout() {
  const { session, isAdmin, isStaff } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <UpdatePrompt />
      <OfflineBanner />
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="container-page flex h-14 items-center justify-between md:h-16">
          <Link to="/" aria-label="Drop Studios home"><Logo height={26} /></Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink to="/timetable" className={navCls}>Timetable</NavLink>
            <NavLink to="/memberships" className={navCls}>Memberships</NavLink>
            {isStaff && <NavLink to="/teach" className={navCls}>My classes</NavLink>}
            {isAdmin && <NavLink to="/admin" className={navCls}>Admin</NavLink>}
            {session ? (
              <NavLink to="/account" className={navCls}>My Membership</NavLink>
            ) : (
              <>
                <NavLink to="/login" className={navCls}>Log in</NavLink>
                <Link to="/register" className="btn-sm btn-primary ml-2">Join now</Link>
              </>
            )}
          </nav>
          {!session && <Link to="/register" className="btn-sm btn-accent md:hidden">Join</Link>}
          {session && isAdmin && <Link to="/admin" className="btn-sm btn-ghost md:hidden" aria-label="Admin"><ShieldIcon /></Link>}
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
            <Link to="/memberships" className="hover:text-ink">Memberships</Link>
            <Link to="/timetable" className="hover:text-ink">Timetable</Link>
            <Link to="/terms" className="hover:text-ink">Terms</Link>
            <Link to="/privacy" className="hover:text-ink">Privacy</Link>
          </div>
        </div>
      </footer>

      <BottomNav signedIn={Boolean(session)} staff={isStaff} />
      <InstallPrompt />
    </div>
  );
}

function BottomNav({ signedIn, staff }: { signedIn: boolean; staff: boolean }) {
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? 'text-brand-600' : 'text-muted'}`;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden" aria-label="App">
      <NavLink to="/" end className={item}><HomeIcon />Home</NavLink>
      <NavLink to="/timetable" className={item}><CalendarIcon />Timetable</NavLink>
      {staff
        ? <NavLink to="/teach" className={item}><UsersIcon />Classes</NavLink>
        : <NavLink to="/memberships" className={item}><TicketIcon />Plans</NavLink>}
      <NavLink to={signedIn ? '/account' : '/login'} className={item}><UserIcon />{signedIn ? 'Me' : 'Log in'}</NavLink>
    </nav>
  );
}
