// server/middleware/subscription.js
// ─── Drop-in middleware for any route that needs feature gating ───────────────
//
// Usage:
//   import { requireFeature, attachSubscription } from '../middleware/subscription.js';
//
//   router.post('/counter-affidavit', authenticateJWT, requireFeature('COUNTER_AFFIDAVIT'), handler);
//   router.post('/drafts',            authenticateJWT, requireFeature('DRAFT_GENERATION'),  handler);
//
// The middleware also attaches req.subscription and req.shouldWatermark
// so controllers can apply watermarks conditionally.

import { Subscription, Organization } from '../models/Subscription.js';
import { FEATURES, TIER_RANK, canAccess, shouldWatermark, TIERS } from '../config/featureFlags.js';
import { AppError } from '../utils/errors.js';

// ─── 1. attachSubscription ────────────────────────────────────────────────────
// Always run after authenticateJWT. Attaches req.subscription with resolved
// effective tier + feature overrides from org policy if enterprise.
export const attachSubscription = async (req, _res, next) => {
  try {
    let sub = await Subscription.findOne({ userId: req.user._id }).lean();

    // Auto-create free subscription if none exists
    if (!sub) {
      sub = await Subscription.create({ userId: req.user._id, tier: TIERS.FREE });
      sub = sub.toObject();
    }

    // If subscription expired, downgrade to free for this request
    if (sub.status === 'expired' || sub.status === 'cancelled') {
      sub.tier = TIERS.FREE;
    }

    // If trial period ended, downgrade
    if (sub.status === 'trial' && sub.trialEndsAt && new Date() > sub.trialEndsAt) {
      sub.tier = TIERS.FREE;
      // Async update — don't block request
      Subscription.findByIdAndUpdate(sub._id, { tier: TIERS.FREE, status: 'expired' }).catch(() => {});
    }

    // Enterprise: resolve org-level + designation-level overrides
    let orgPolicy = null;
    if (sub.tier === TIERS.ENTERPRISE && sub.orgId) {
      const org = await Organization.findById(sub.orgId).lean();
      if (org) {
        // Find matching designation policy
        const desigPolicy = org.featurePolicies?.find(
          p => p.designation === sub.designation &&
               p.clearanceLevel <= sub.clearanceLevel
        );
        orgPolicy = {
          orgAllowed: org.orgAllowedFeatures || [],
          orgDenied:  org.orgDeniedFeatures  || [],
          desigAllowed: desigPolicy?.allowedFeatures || [],
          desigDenied:  desigPolicy?.deniedFeatures  || [],
        };
      }
    }

    req.subscription = { ...sub, orgPolicy };
    next();
  } catch (err) {
    next(err);
  }
};

// ─── 2. requireFeature ───────────────────────────────────────────────────────
// Factory — returns middleware that blocks access if user can't use featureKey.
// Also sets req.shouldWatermark = true/false for the controller to use.
export const requireFeature = (featureKey) => async (req, _res, next) => {
  // attachSubscription must have run first
  if (!req.subscription) {
    return next(new AppError('Subscription context missing. Ensure attachSubscription runs first.', 500));
  }

  const { tier, featureOverrides, orgPolicy } = req.subscription;
  const feature = FEATURES[featureKey];

  if (!feature) {
    return next(new AppError(`Unknown feature key: ${featureKey}`, 500));
  }

  // ── Enterprise override resolution (most specific wins) ───────────────────
  if (tier === TIERS.ENTERPRISE && orgPolicy) {
    const denied = [
      ...orgPolicy.orgDenied,
      ...orgPolicy.desigDenied,
      ...(featureOverrides?.denied || []),
    ];
    const allowed = [
      ...orgPolicy.orgAllowed,
      ...orgPolicy.desigAllowed,
      ...(featureOverrides?.allowed || []),
    ];

    if (denied.includes(featureKey)) {
      return next(new AppError(
        `Your organization has restricted access to "${feature.label}". Contact your admin.`,
        403,
        { featureKey, requiredTier: feature.minTier, currentTier: tier, blockedByOrg: true }
      ));
    }

    // If explicitly allowed by org/designation, pass through
    if (allowed.includes(featureKey)) {
      req.shouldWatermark = false;
      return next();
    }
  }

  // ── User-level explicit overrides (for non-enterprise) ────────────────────
  if (featureOverrides?.denied?.includes(featureKey)) {
    return next(new AppError(
      `Access to "${feature.label}" has been restricted on your account.`,
      403,
      { featureKey, requiredTier: feature.minTier, currentTier: tier }
    ));
  }

  // ── Standard tier check ───────────────────────────────────────────────────
  if (!canAccess(tier, featureKey)) {
    return next(new AppError(
      `"${feature.label}" requires a ${feature.minTier.charAt(0).toUpperCase() + feature.minTier.slice(1)} subscription or higher.`,
      403,
      {
        featureKey,
        featureLabel: feature.label,
        requiredTier: feature.minTier,
        currentTier: tier,
        upgradeRequired: true,
      }
    ));
  }

  // ── Watermark check ───────────────────────────────────────────────────────
  req.shouldWatermark = shouldWatermark(tier, featureKey);
  next();
};

// ─── 3. requireTier ──────────────────────────────────────────────────────────
// Simpler check — require a minimum tier without a specific feature key.
export const requireTier = (minTier) => async (req, _res, next) => {
  if (!req.subscription) {
    return next(new AppError('Subscription context missing.', 500));
  }
  const { tier } = req.subscription;
  if (TIER_RANK[tier] < TIER_RANK[minTier]) {
    return next(new AppError(
      `This feature requires a ${minTier.charAt(0).toUpperCase() + minTier.slice(1)} plan or higher.`,
      403,
      { requiredTier: minTier, currentTier: tier, upgradeRequired: true }
    ));
  }
  next();
};

// ─── 4. requireOrgAdmin ──────────────────────────────────────────────────────
// Enterprise only: ensures the requesting user is the org admin.
export const requireOrgAdmin = async (req, _res, next) => {
  if (!req.subscription) return next(new AppError('Subscription context missing.', 500));
  const { tier, orgId } = req.subscription;

  if (tier !== TIERS.ENTERPRISE) {
    return next(new AppError('Organization management requires an Enterprise plan.', 403));
  }

  const org = await Organization.findById(orgId).lean();
  if (!org) return next(new AppError('Organization not found.', 404));

  if (org.adminUserId.toString() !== req.user._id.toString()) {
    return next(new AppError('Only the organization admin can perform this action.', 403));
  }

  req.organization = org;
  next();
};
