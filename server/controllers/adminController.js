import User from '../models/User.js';
import { Subscription } from '../models/Subscription.js';
import FeatureAccess from '../models/FeatureAccess.js';
import redis from '../utils/redisClient.js';
import { AppError } from '../utils/errors.js';
import Setting from '../models/Setting.js';


export const users = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    // Admin panel can request up to 1000 users in one shot
    const limit = Math.min(1000, parseInt(req.query.limit) || 1000);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find({})
        .select('firstName lastName email isActive isAdmin isVerified createdAt lastLogin subscriptionStatus userTier profileImage')
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments({})
    ]);

    await redis.del('admin:financialStats');

    res.json({
      success: true,
      data: users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    throw new AppError(error.message || 'Error fetching users', 500);
  }
};
  

export const removeUser = async (req, res) => {
    try {
      const userId = req.params.id;
      const user = await User.findByIdAndDelete(userId).lean();
      if (!user) {
        throw new AppError('User not found', 404);
      }
      
      await redis.del('admin:financialStats');
      res.json({ message: 'User removed successfully' });
    } catch (error) {
      throw new AppError(error.message || 'Error removing user', 500);
    }
};
  

export const financialStats = async (req, res) => {
    try {
      
      const cachedStats = await redis.get('admin:financialStats');
      if (cachedStats) {
        return res.json(JSON.parse(cachedStats));
      }
      
      const totalUsers = await User.countDocuments({ isActive: true });
      const premiumUsers = await User.countDocuments({ subscriptionStatus: 'premium' });
      const totalRevenue = await Subscription.aggregate([
        { $group: { _id: null, total: { $sum: '$amount' } } },
        { $project: { _id: 0, total: 1 } }
      ]);
      const stats = {
        totalUsers,
        premiumUsers,
        totalRevenue: totalRevenue[0]?.total || 0
      };
      
      await redis.set('admin:financialStats', JSON.stringify(stats), 'EX', 20);
      res.json(stats);
    } catch (error) {
      throw new AppError(error.message || 'Error fetching financial statistics', 500);
    }
};
  

export const updateSubscriptionPricing = async (req, res) => {
    try {
      const { amount } = req.body;
      
      if (!amount || amount <= 0) {
        throw new AppError('Invalid subscription amount', 400);
      }
      
      
      
      await Subscription.updateMany({}, { $set: { defaultAmount: amount } });
      
      res.json({ message: 'Subscription pricing updated successfully' });
    } catch (error) {
      throw new AppError(error.message || 'Error updating subscription pricing', 500);
    }
};


export const getFreeMessageLimit = async (req, res) => {
  try {
    const cached = await redis.get('admin:settings:freeMessageLimit').catch(() => null);
    if (cached) return res.json({ value: Number(cached) });

    const doc = await Setting.findOne({ key: 'freeMessageLimit' }).lean();
    const value = doc?.value ?? 5;
    await redis.set('admin:settings:freeMessageLimit', String(value), 'EX', 60).catch(() => {});
    return res.json({ value: Number(value) });
  } catch (error) {
    throw new AppError(error.message || 'Error fetching free message limit', 500);
  }
};

export const setFreeMessageLimit = async (req, res) => {
  try {
    const { value } = req.body;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new AppError('Invalid value', 400);
    }
    await Setting.updateOne(
      { key: 'freeMessageLimit' },
      { $set: { value: parsed } },
      { upsert: true }
    );
    await redis.del('admin:settings:freeMessageLimit').catch(() => {});
    return res.json({ success: true, value: parsed });
  } catch (error) {
    throw new AppError(error.message || 'Error updating free message limit', 500);
  }
};



export const getFeatureAccessMatrix = async (req, res) => {
  try {
    const matrix = await FeatureAccess.getMatrix();
    res.json({ success: true, features: matrix.features, updatedAt: matrix.updatedAt });
  } catch (error) {
    throw new AppError(error.message || 'Error fetching feature access matrix', 500);
  }
};

export const updateFeatureAccessMatrix = async (req, res) => {
  try {
    const { features } = req.body;
    if (!Array.isArray(features)) {
      throw new AppError('features must be an array', 400);
    }

    
    for (const f of features) {
      if (!f.featureKey || !f.featureLabel) {
        throw new AppError(`Each feature must have featureKey and featureLabel`, 400);
      }
    }

    const updated = await FeatureAccess.updateMatrix(features, req.user.id);
    
    await redis.del('feature_access_matrix').catch(() => {});

    res.json({ success: true, features: updated.features, updatedAt: updated.updatedAt });
  } catch (error) {
    throw new AppError(error.message || 'Error updating feature access matrix', 500);
  }
};



export const updateUserTier = async (req, res) => {
  try {
    const { id } = req.params;
    const { tier } = req.body;

    if (!['free', 'basic', 'pro', 'premium', 'standard', 'departmental'].includes(tier)) {
      throw new AppError('Tier must be standard, pro, or departmental', 400);
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { userTier: tier, subscriptionStatus: tier } },
      { new: true, runValidators: true }
    ).select('firstName lastName email userTier subscriptionStatus');

    if (!user) throw new AppError('User not found', 404);

    res.json({ success: true, user });
  } catch (error) {
    throw new AppError(error.message || 'Error updating user tier', 500);
  }
};
