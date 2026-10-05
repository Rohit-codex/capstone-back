import { verifyCsrfToken } from '../utils/csrfToken.js';

export const csrfProtection = async (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  if (!req.user?.id) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = req.headers['x-csrf-token'];
  const valid = await verifyCsrfToken(req.user.id, token);

  if (!valid) {
    return res.status(403).json({ success: false, error: 'Invalid CSRF token' });
  }

  next();
};
