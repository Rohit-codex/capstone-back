import api from './api';
export const documentService = {
  list: () => api.get('/files/user-files').then((r) => r.data),
  upload: (file) => { const form = new FormData(); form.append('file', file); return api.post('/files/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data); },
  analyze: (fileId, payload) => api.post(`/files/analyze/${fileId}`, payload).then((r) => r.data),
  delete: (fileId) => api.delete(`/files/${fileId}`).then((r) => r.data),
  download: (fileId) => api.get(`/files/${fileId}/download`, { responseType: 'blob' }).then((r) => r.data),
};
