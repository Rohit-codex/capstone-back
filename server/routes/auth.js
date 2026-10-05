import express from 'express';
import rateLimit from 'express-rate-limit';
import { 
  checkEmail, 
  signup, 
  login, 
  getCurrentUser, 
  logout, 
  forgotPasswordRequest, 
  verifyResetOTP, 
  resetPassword,
  googleAuth,
  verifyTwoFactor,
  refreshAccessToken,
  toggleTwoFactor
} from '../controllers/authController.js';
import asyncHandler from '../utils/asyncHandler.js';
import { validateRequest, schemas } from '../middleware/validators.js';
import { authenticateJWT, authenticateJWTOnly } from '../middleware/auth.js';

const router = express.Router();


const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  message: 'Too many login attempts, please try again in 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});



router.post('/check-email', authLimiter, validateRequest(schemas.auth.checkEmail), asyncHandler(checkEmail));
router.post('/signup', authLimiter, validateRequest(schemas.auth.signup), asyncHandler(signup));
router.post('/login', [loginLimiter, validateRequest(schemas.auth.login)], asyncHandler(login));
router.post('/verify-2fa', validateRequest(schemas.auth.verify2fa), asyncHandler(verifyTwoFactor));
router.post('/refresh', validateRequest(schemas.auth.refresh), asyncHandler(refreshAccessToken));


router.post('/forgot-password', asyncHandler(forgotPasswordRequest));
router.post('/verify-reset-otp', asyncHandler(verifyResetOTP));
router.post('/reset-password', asyncHandler(resetPassword));
router.post('/google', asyncHandler(googleAuth));

import { getUserFeatureConfig } from '../middleware/featureAccess.js';


router.get('/user', asyncHandler(getCurrentUser));
router.post('/logout', asyncHandler(logout));
router.post('/2fa/toggle', authenticateJWT, asyncHandler(toggleTwoFactor));


router.get('/feature-config', authenticateJWT, asyncHandler(async (req, res) => {
  const userTier = req.user?.userTier || 'basic';
  const config = await getUserFeatureConfig(userTier);
  res.json({ success: true, tier: userTier, features: config });
}));

import { generateCsrfToken } from '../utils/csrfToken.js';

// Refresh CSRF token — uses JWT-only auth (no CSRF check) to break the chicken-and-egg
router.post('/refresh-csrf', authenticateJWTOnly, asyncHandler(async (req, res) => {
  const csrfToken = await generateCsrfToken(req.user.id);
  res.json({ success: true, csrfToken });
}));

export default router;