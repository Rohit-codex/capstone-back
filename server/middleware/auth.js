import { verifyToken } from '../utils/jwt.js';
import { verifyCsrfToken } from '../utils/csrfToken.js';


const isDev = process.env.NODE_ENV === 'development';
const CSRF_DISABLED = process.env.CSRF_DISABLE === 'true' || isDev;
const AUTH_RELAXED = isDev;

export const authenticateJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  const queryToken = req.query.token;

  let token = null;
  
  if (authHeader) {
    token = authHeader.split(' ')[1];
  } else if (queryToken) {
    
    token = queryToken;
  }

  if (!token) {
    console.log('🔐 Auth failed: No token provided');
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    req.user._id = decoded.id;
    
    
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!CSRF_DISABLED) {
        const csrfToken = req.headers['x-csrf-token'];
        const valid = await verifyCsrfToken(req.user.id, csrfToken);
        if (!valid) {
          console.log('🔐 CSRF validation failed:', { userId: req.user.id, hasCsrfToken: !!csrfToken });
          return res.status(403).json({ message: 'Invalid CSRF token' });
        }
      }
    }
    next();
  } catch (error) {
    console.error('🔐 JWT verification failed:', error.message);
    
    if (AUTH_RELAXED) {
      console.log('⚠️ Development mode: Token error detected');
      console.log('⚠️ Error details:', error.message);
      console.log('⚠️ Hint: Try logging out and logging back in to get a fresh token');
    }
    return res.status(403).json({ 
      message: 'Invalid token',
      devMode: AUTH_RELAXED,
      hint: AUTH_RELAXED ? 'Try logging out and logging back in' : undefined
    });
  }
};

// JWT-only auth — skips CSRF check (used for CSRF refresh endpoint)
export const authenticateJWTOnly = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  const token = authHeader ? authHeader.split(' ')[1] : queryToken || null;

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    req.user = verifyToken(token);
    req.user._id = req.user.id;
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Invalid token' });
  }
};