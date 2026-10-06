import api from './api';
export const subscriptionService = {
  prices: () => api.get('/subscription/price').then((r) => r.data),
  features: () => api.get('/subscription/features').then((r) => r.data),
  mine: () => api.get('/subscription/me').then((r) => r.data),
  cancel: () => api.post('/subscription/cancel').then((r) => r.data),
};
