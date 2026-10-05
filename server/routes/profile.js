import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { upload } from '../utils/upload.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  getProfile,
  updateProfile,
  uploadProfileImage,
  initiateEmailChange,
  verifyCurrentEmail,
  initiateNewEmail,
  completeEmailChange,
  initiatePasswordChange,
  completePasswordChange,
  resendPasswordOTP,
  resendCurrentEmailOTP,
  resendNewEmailOTP,
  getPreferences,
  updatePreferences,
  setupCompany
} from '../controllers/profileController.js';

const router = express.Router();


router.get('/info', authenticateJWT, asyncHandler(getProfile));
router.put('/company-setup', authenticateJWT, asyncHandler(setupCompany));


router.put('/info', authenticateJWT, asyncHandler(updateProfile));


router.post('/profile-image', authenticateJWT, upload.single('profileImage'), asyncHandler(uploadProfileImage));


router.post('/email/initiate-change', authenticateJWT, asyncHandler(initiateEmailChange));
router.post('/email/verify-current', authenticateJWT, asyncHandler(verifyCurrentEmail));
router.post('/email/initiate-new', authenticateJWT, asyncHandler(initiateNewEmail));
router.post('/email/complete-change', authenticateJWT, asyncHandler(completeEmailChange));
router.post('/email/resend-current-otp', authenticateJWT, asyncHandler(resendCurrentEmailOTP));
router.post('/email/resend-new-otp', authenticateJWT, asyncHandler(resendNewEmailOTP));


router.post('/password/initiate-change', authenticateJWT, asyncHandler(initiatePasswordChange));
router.post('/password/complete-change', authenticateJWT, asyncHandler(completePasswordChange));
router.post('/password/resend-otp', authenticateJWT, asyncHandler(resendPasswordOTP));

router.get('/preferences', authenticateJWT, asyncHandler(getPreferences));
router.patch('/preferences', authenticateJWT, asyncHandler(updatePreferences));

export default router; 