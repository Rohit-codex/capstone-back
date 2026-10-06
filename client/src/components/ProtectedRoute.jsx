import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from './LoadingSpinner';
export default function ProtectedRoute({ children, adminOnly = false }) {
  const { isAuthenticated, isLoading, user } = useAuth(); const location = useLocation();
  if (isLoading) return <div className="full-screen-loader"><LoadingSpinner label="Restoring your session" /></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (adminOnly && !user?.isAdmin) return <Navigate to="/dashboard" replace />;
  return children;
}
