import api from './api';
export const adminService = {
  stats: () => api.get('/admin/financial-stats').then((r) => r.data),
  users: () => api.get('/admin/users').then((r) => r.data),
  updateTier: (id, tier) => api.put(`/admin/users/${id}/tier`, { tier }).then((r) => r.data),
};
