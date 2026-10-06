import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', headers: { 'Content-Type': 'application/json' } });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('dastavez_token');
  const csrfToken = localStorage.getItem('dastavez_csrf');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (csrfToken && !config.headers['x-csrf-token']) config.headers['x-csrf-token'] = csrfToken;
  return config;
});
export const getErrorMessage = (error, fallback = 'Something went wrong. Please try again.') => error?.response?.data?.message || error?.response?.data?.error?.message || error?.response?.data?.error || error?.response?.data?.details?.[0] || error?.message || fallback;
export default api;
