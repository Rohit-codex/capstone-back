// server/controllers/subscriptionController.js
import asyncHandler from '../utils/asyncHandler.js';
import { AppError } from '../utils/errors.js';
import { Subscription, Organization } from '../models/Subscription.js';
import SubscriptionPrice, { TIER_DEFAULTS } from '../models/SubscriptionPrice.js';
import { FEATURES, TIER_META, TIERS, canAccess, getAccessibleFeatures } from '../config/featureFlags.js';
import mongoose from 'mongoose';

// ─── GET /api/subscription/price ── Public: fetch current subscription price
export const getSubscriptionPrice = asyncHandler(async (req, res) => {
  const docs = await SubscriptionPrice.find().lean();
  const docMap = {};
  docs.forEach(doc => {
    docMap[doc.tier] = doc;
  });

  const prices = Object.keys(TIER_DEFAULTS).map(tier => {
    const dbConfig = docMap[tier];
    return {
      tier,
      amount: dbConfig ? dbConfig.amount : TIER_DEFAULTS[tier].amount,
      messageLimit: dbConfig ? dbConfig.messageLimit : TIER_DEFAULTS[tier].messageLimit,
      updatedAt: dbConfig?.updatedAt
    };
  });

  res.json({ success: true, prices });
});

// ─── PUT /api/subscription/price ── Admin: update subscription price
export const updateSubscriptionPrice = asyncHandler(async (req, res) => {
  const { tier, amount, messageLimit } = req.body;
  if (!tier) {
    throw new AppError('Tier is required', 400);
  }
  const normalizedTier = tier.toLowerCase().trim();
  const validTiers = Object.keys(TIER_DEFAULTS);
  if (!validTiers.includes(normalizedTier)) {
    throw new AppError(`Invalid tier: ${tier}`, 400);
  }
  if (amount == null || isNaN(Number(amount)) || Number(amount) < 0) {
    throw new AppError('Invalid amount', 400);
  }
  if (messageLimit == null || isNaN(Number(messageLimit)) || Number(messageLimit) < -1) {
    throw new AppError('Invalid message limit', 400);
  }

  const userId = req.user?._id;
  const priceDoc = await SubscriptionPrice.findOneAndUpdate(
    { tier: normalizedTier },
    { amount: Number(amount), messageLimit: Number(messageLimit), updatedBy: userId },
    { new: true, upsert: true }
  );
  res.json({ success: true, price: priceDoc });
});



// ─── GET /api/subscriptions/me ── Current user's subscription + accessible features
export const getMySubscription = asyncHandler(async (req, res) => {
  const sub = req.subscription; // attached by attachSubscription middleware
  const accessible = getAccessibleFeatures(sub.tier);

  res.json({
    success: true,
    subscription: {
      tier: sub.tier,
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodEnd: sub.currentPeriodEnd,
      designation: sub.designation,
      clearanceLevel: sub.clearanceLevel,
      orgId: sub.orgId,
    },
    tierMeta: TIER_META[sub.tier],
    accessibleFeatures: accessible.map(f => f.key),
    featureDetails: accessible,
  });
});

// ─── GET /api/subscriptions/features ── All feature definitions (for frontend)
export const getAllFeatures = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    features: FEATURES,
    tierMeta: TIER_META,
  });
});

// ─── POST /api/subscriptions/upgrade ── Upgrade tier (called after payment success)
// In production wire this to your Razorpay/Stripe webhook instead.
export const upgradeTier = asyncHandler(async (req, res) => {
  const { tier, externalSubscriptionId, paymentProvider, periodEndDate } = req.body;

  if (!Object.values(TIERS).includes(tier)) {
    throw new AppError('Invalid subscription tier.', 400);
  }

  const sub = await Subscription.findOneAndUpdate(
    { userId: req.user._id },
    {
      tier,
      status: 'active',
      externalSubscriptionId: externalSubscriptionId || null,
      paymentProvider: paymentProvider || null,
      currentPeriodStart: new Date(),
      currentPeriodEnd: periodEndDate ? new Date(periodEndDate) : null,
    },
    { new: true, upsert: true }
  );

  res.json({ success: true, subscription: sub });
});

// ─── POST /api/subscriptions/cancel ─────────────────────────────────────────
export const cancelSubscription = asyncHandler(async (req, res) => {
  const sub = await Subscription.findOneAndUpdate(
    { userId: req.user._id },
    { status: 'cancelled' },
    { new: true }
  );
  if (!sub) throw new AppError('No subscription found.', 404);
  res.json({ success: true, message: 'Subscription cancelled. Access continues until period end.' });
});

// ════════════════════════════════════════════════════════════════════════════
// ─── ENTERPRISE / ORG MANAGEMENT ────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// ─── POST /api/subscriptions/org ── Create organization (Enterprise admin)
export const createOrganization = asyncHandler(async (req, res) => {
  const { name, maxMembers } = req.body;
  if (!name?.trim()) throw new AppError('Organization name is required.', 400);

  const existing = await Organization.findOne({ adminUserId: req.user._id });
  if (existing) throw new AppError('You already have an organization.', 409);

  const org = await Organization.create({
    name: name.trim(),
    adminUserId: req.user._id,
    maxMembers: maxMembers || 50,
  });

  // Attach org to admin's subscription
  await Subscription.findOneAndUpdate(
    { userId: req.user._id },
    { userId: req.user._id, orgId: org._id },
    { upsert: true }
  );

  res.status(201).json({ success: true, organization: org });
});

// ─── GET /api/subscriptions/org ── Get org details + member list
export const getOrganization = asyncHandler(async (req, res) => {
  const org = req.organization; // attached by requireOrgAdmin
  const members = await Subscription.find({ orgId: org._id })
    .populate('userId', 'name email')
    .lean();

  res.json({ success: true, organization: org, members });
});

// ─── POST /api/subscriptions/org/invite ── Add member to org
export const inviteMember = asyncHandler(async (req, res) => {
  const { userId, designation, clearanceLevel } = req.body;
  const org = req.organization;

  if (!mongoose.Types.ObjectId.isValid(userId)) throw new AppError('Invalid user ID.', 400);
  if (org.memberCount >= org.maxMembers) {
    throw new AppError(`Organization has reached its member limit of ${org.maxMembers}.`, 400);
  }

  const memberSub = await Subscription.findOneAndUpdate(
    { userId },
    {
      tier: TIERS.ENTERPRISE,
      orgId: org._id,
      designation: designation?.trim() || null,
      clearanceLevel: clearanceLevel || 1,
      status: 'active',
    },
    { new: true, upsert: true }
  );

  await Organization.findByIdAndUpdate(org._id, { $inc: { memberCount: 1 } });

  res.json({ success: true, member: memberSub });
});

// ─── DELETE /api/subscriptions/org/members/:userId ── Remove member
export const removeMember = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const org = req.organization;

  const removed = await Subscription.findOneAndUpdate(
    { userId, orgId: org._id },
    { tier: TIERS.FREE, orgId: null, designation: null, clearanceLevel: 1 }
  );
  if (removed) {
    await Organization.findByIdAndUpdate(org._id, { $inc: { memberCount: -1 } });
  }

  res.json({ success: true, message: removed ? 'Member removed from organization.' : 'Member was not in this organization.' });
});

// ─── PUT /api/subscriptions/org/members/:userId ── Update designation + clearance
export const updateMember = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { designation, clearanceLevel, allowedFeatures, deniedFeatures } = req.body;
  const org = req.organization;

  const updates = {};
  if (designation !== undefined) updates.designation = designation.trim();
  if (clearanceLevel !== undefined) updates.clearanceLevel = clearanceLevel;
  if (allowedFeatures !== undefined) updates['featureOverrides.allowed'] = allowedFeatures;
  if (deniedFeatures  !== undefined) updates['featureOverrides.denied']  = deniedFeatures;

  const sub = await Subscription.findOneAndUpdate(
    { userId, orgId: org._id },
    updates,
    { new: true }
  );
  if (!sub) throw new AppError('Member not found in this organization.', 404);

  res.json({ success: true, member: sub });
});

// ─── PUT /api/subscriptions/org/policies ── Set designation-level feature policies
export const updateOrgPolicies = asyncHandler(async (req, res) => {
  const { featurePolicies, orgAllowedFeatures, orgDeniedFeatures } = req.body;
  const org = req.organization;

  const updates = {};
  if (featurePolicies)    updates.featurePolicies    = featurePolicies;
  if (orgAllowedFeatures) updates.orgAllowedFeatures = orgAllowedFeatures;
  if (orgDeniedFeatures)  updates.orgDeniedFeatures  = orgDeniedFeatures;
  
  const updated = await Organization.findByIdAndUpdate(org._id, updates, { new: true });
  res.json({ success: true, organization: updated });
});
