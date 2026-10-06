import api from './api';
const withSlug = (slug) => ({ headers: { 'x-chat-slug': slug } });
export const chatService = {
  getSessions: () => api.get('/chat/sessions').then((r) => r.data),
  getHistory: (slug) => api.get(`/chat/session/${encodeURIComponent(slug)}`).then((r) => r.data),
  sendMessage: (slug, payload) => api.post('/chat/message', payload, withSlug(slug)).then((r) => r.data),
  deleteSession: (slug) => api.delete(`/chat/session/${encodeURIComponent(slug)}`).then((r) => r.data),
  renameSession: (slug, title) => api.patch(`/chat/session/${encodeURIComponent(slug)}/title`, { title }).then((r) => r.data),
};
