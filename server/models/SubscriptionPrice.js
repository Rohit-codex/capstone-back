import mongoose from 'mongoose';
import MessageCount from './MessageCount.js';

export const TIER_DEFAULTS = {
  free: { amount: 0, messageLimit: 5 },
  basic: { amount: 99900, messageLimit: 20 },
  standard: { amount: 199900, messageLimit: 50 },
  premium: { amount: 299900, messageLimit: -1 },
  pro: { amount: 299900, messageLimit: -1 },
  departmental: { amount: 499900, messageLimit: -1 },
  enterprise: { amount: 999900, messageLimit: -1 }
};

const subscriptionPriceSchema = new mongoose.Schema({
  tier: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    enum: ['free', 'basic', 'pro', 'premium', 'standard', 'departmental', 'enterprise']
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  messageLimit: {
    type: Number,
    required: true,
    default: -1
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

const SubscriptionPrice = mongoose.model('SubscriptionPrice', subscriptionPriceSchema);

const tierLimitCache = new Map();

// Clear cached limit when a tier's configuration is modified
subscriptionPriceSchema.post('save', function(doc) {
  if (doc.tier) {
    const key = doc.tier.toLowerCase().trim();
    tierLimitCache.delete(key);
    console.log(`🧹 In-memory subscription cache cleared for tier: ${key}`);
  }
});

export async function getMessageLimitForTier(tier) {
  if (!tier) return 5; // default to free limit
  const normalizedTier = tier.toLowerCase().trim();
  
  if (tierLimitCache.has(normalizedTier)) {
    return tierLimitCache.get(normalizedTier);
  }

  const config = await SubscriptionPrice.findOne({ tier: normalizedTier }).lean();
  let limit;
  if (config && config.messageLimit !== undefined) {
    limit = config.messageLimit;
  } else {
    limit = TIER_DEFAULTS[normalizedTier]?.messageLimit ?? -1;
  }

  tierLimitCache.set(normalizedTier, limit);
  return limit;
}

export async function getRemainingMessages(userId, tier) {
  const limit = await getMessageLimitForTier(tier);
  if (limit === -1) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const mc = await MessageCount.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    date: today
  }).lean();
  const count = mc ? mc.count : 0;
  return Math.max(0, limit - count);
}

export default SubscriptionPrice; 