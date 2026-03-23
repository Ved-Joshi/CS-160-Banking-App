import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';

export function ProtectedRoute() {
  const { user, loading, mfaPending } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="centered-screen">Loading your banking session...</div>;
  }

  if (mfaPending) {
    return <Navigate to="/mfa" replace state={{ from: location }} />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
