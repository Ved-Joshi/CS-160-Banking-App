import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';

export function AdminRoute() {
  const { user, loading, rolesLoading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading || rolesLoading) {
    return <div className="centered-screen">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!isAdmin) {
    return <Navigate to="/app/dashboard" replace />;
  }

  return <Outlet />;
}
