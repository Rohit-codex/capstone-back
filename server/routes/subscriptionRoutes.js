// server/routes/subscriptionRoutes.js
import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { attachSubscription, requireTier, requireOrgAdmin } from '../middleware/subscription.js';
import { isAdmin } from '../middleware/adminMiddleware.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  getMySubscription,
  getAllFeatures,
  upgradeTier,
  cancelSubscription,
  createOrganization,
  getOrganization,
  inviteMember,
  removeMember,
  updateMember,
  updateOrgPolicies,
  getSubscriptionPrice,
  updateSubscriptionPrice,
} from '../controllers/subscriptionController.js';

const router = express.Router();

// Public — feature list (no auth needed, used by pricing page)
router.get('/features', getAllFeatures);

// Public — get current subscription price
router.get('/price', asyncHandler(getSubscriptionPrice));

// All other routes require auth + subscription context
router.use(authenticateJWT, attachSubscription);

router.get('/me',     getMySubscription);
router.post('/upgrade', upgradeTier);
router.post('/cancel',  cancelSubscription);

// Admin — update subscription price
router.put('/price', isAdmin, asyncHandler(updateSubscriptionPrice));

// ── Enterprise org management ────────────────────────────────────────────────
router.post('/org',                          requireTier('enterprise'), createOrganization);
router.get('/org',                           requireTier('enterprise'), requireOrgAdmin, getOrganization);
router.post('/org/invite',                   requireTier('enterprise'), requireOrgAdmin, inviteMember);
router.delete('/org/members/:userId',        requireTier('enterprise'), requireOrgAdmin, removeMember);
router.put('/org/members/:userId',           requireTier('enterprise'), requireOrgAdmin, updateMember);
router.put('/org/policies',                  requireTier('enterprise'), requireOrgAdmin, updateOrgPolicies);

export default router;
