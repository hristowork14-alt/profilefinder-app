import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/context';
import { PageLoading } from './EmptyState';

/** Sends signed-out visitors to /login and brings them back afterwards. */
export function ProtectedRoute() {
  const { user, loading, exitTo } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading label="Checking your session…" />;
  if (!user) {
    if (exitTo && exitTo.from === location.pathname) return <Navigate to={exitTo.to} replace />;
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}
