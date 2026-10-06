import api from './api';
export const authService = {
  login: (credentials) => api.post('/auth/login', credentials).then((r) => r.data),
  verifyTwoFactor: (payload) => api.post('/auth/verify-2fa', payload).then((r) => r.data),
  checkEmail: (email) => api.post('/auth/check-email', { email }).then((r) => r.data),
  signup: (payload) => api.post('/auth/signup', payload).then((r) => r.data),
  getCurrentUser: () => api.get('/auth/user').then((r) => r.data),
  logout: () => api.post('/auth/logout').then((r) => r.data),
  googleLogin: (credential) => api.post('/auth/google', { credential }).then((r) => r.data),
  toggleTwoFactor: () => api.post('/auth/2fa/toggle').then((r) => r.data),
};
