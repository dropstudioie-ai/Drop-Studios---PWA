import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { PageSpinner } from '../components/ui';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageSpinner />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

// UI convenience only — every admin action is re-authorised in the database.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, profile, loading, isAdmin } = useAuth();
  if (loading || (session && !profile)) return <PageSpinner />;
  if (!session) return <Navigate to="/login?next=/admin" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}
