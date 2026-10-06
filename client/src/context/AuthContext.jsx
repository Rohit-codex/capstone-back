import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authService } from '../services/authService';
const AuthContext = createContext(null);
const readStoredUser = () => { try { return JSON.parse(localStorage.getItem('dastavez_user') || 'null'); } catch { return null; } };
export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStoredUser);
  const [isLoading, setIsLoading] = useState(Boolean(localStorage.getItem('dastavez_token')));
  const persistUser = useCallback((nextUser) => { setUser(nextUser); if (nextUser) localStorage.setItem('dastavez_user', JSON.stringify(nextUser)); else localStorage.removeItem('dastavez_user'); }, []);
  const completeAuthentication = useCallback((payload) => { localStorage.setItem('dastavez_token', payload.token); if (payload.refreshToken) localStorage.setItem('dastavez_refresh_token', payload.refreshToken); if (payload.csrfToken) localStorage.setItem('dastavez_csrf', payload.csrfToken); persistUser(payload.user); }, [persistUser]);
  const logout = useCallback(async () => { try { await authService.logout(); } catch { /* Clear a local session even when the API is offline. */ } localStorage.removeItem('dastavez_token'); localStorage.removeItem('dastavez_refresh_token'); localStorage.removeItem('dastavez_csrf'); persistUser(null); }, [persistUser]);
  useEffect(() => { let active = true; if (!localStorage.getItem('dastavez_token')) { setIsLoading(false); return undefined; } authService.getCurrentUser().then((currentUser) => active && persistUser(currentUser)).catch(() => active && logout()).finally(() => active && setIsLoading(false)); return () => { active = false; }; }, [logout, persistUser]);
  const value = useMemo(() => ({ user, isLoading, isAuthenticated: Boolean(user && localStorage.getItem('dastavez_token')), completeAuthentication, updateUser: persistUser, logout }), [user, isLoading, completeAuthentication, persistUser, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context; }
