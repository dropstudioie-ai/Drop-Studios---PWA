import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  ['', 'Overview'],
  ['timetable', 'Timetable'],
  ['bookings', 'Bookings'],
  ['customers', 'Customers'],
  ['plans', 'Plans'],
  ['styles', 'Styles'],
  ['instructors', 'Instructors'],
  ['audit', 'Audit log'],
  ['settings', 'Settings'],
] as const;

export default function AdminLayout() {
  return (
    <div className="container-page py-6">
      <h1 className="text-2xl font-black">Studio admin</h1>
      <nav className="-mx-4 mt-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0" aria-label="Admin sections">
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={`/admin${path ? `/${path}` : ''}`} end={path === ''}
            className={({ isActive }) => `shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-muted hover:text-ink'}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6"><Outlet /></div>
    </div>
  );
}
