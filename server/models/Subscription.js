import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tier: {
    type: String,
    enum: ['free', 'basic', 'pro', 'premium', 'standard', 'departmental', 'enterprise'],
    default: 'free'
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'expired'],
    default: 'active'
  },
  trialEndsAt: {
    type: Date
  },
  currentPeriodStart: {
    type: Date
  },
  currentPeriodEnd: {
    type: Date
  },
  externalSubscriptionId: {
    type: String
  },
  paymentProvider: {
    type: String
  },
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization'
  },
  designation: {
    type: String
  },
  clearanceLevel: {
    type: Number,
    default: 1
  },
  featureOverrides: {
    allowed: [String],
    denied: [String]
  }
}, {
  timestamps: true
});

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  adminUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  maxMembers: {
    type: Number,
    default: 50
  },
  memberCount: {
    type: Number,
    default: 1
  },
  featurePolicies: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  orgAllowedFeatures: [String],
  orgDeniedFeatures: [String]
}, {
  timestamps: true
});

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
export const Organization = mongoose.model('Organization', organizationSchema);
