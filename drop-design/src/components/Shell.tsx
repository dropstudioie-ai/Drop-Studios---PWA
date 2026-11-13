import { NavLink, Outlet } from 'react-router-dom';
import { LayoutGrid, LogOut, Palette, PartyPopper, Receipt } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from './Logo';

const link = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-slate-100'}`;

export function Shell() {
  const { profile, canInvoice, signOut } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          <NavLink to="/" aria-label="Drop Design home"><Logo /></NavLink>
          <nav className="ml-4 flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Main">
            <NavLink to="/" end className={link}><LayoutGrid size={16} />Designs</NavLink>
            <NavLink to="/brand" className={link}><Palette size={16} />Brand Kit</NavLink>
            <NavLink to="/drop" className={link}><PartyPopper size={16} />Drop events</NavLink>
            {canInvoice && <NavLink to="/invoices" className={link}><Receipt size={16} />Invoices</NavLink>}
          </nav>
          <div className="hidden text-right text-xs sm:block">
            <p className="font-semibold">{profile?.full_name ?? profile?.email}</p>
            <p className="text-muted">{canInvoice ? 'Owner' : profile?.role === 'admin' ? 'Manager' : 'Instructor'}</p>
          </div>
          <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={18} /></button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto"><Outlet /></main>
    </div>
  );
}
