import FeatureAccess from '../models/FeatureAccess.js';
import redis from '../utils/redisClient.js';

export function requireFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const userTier = req.user?.userTier || 'basic';
      
      
      let matrix;
      try {
        const cached = await redis.get('feature_access_matrix');
        if (cached) {
          matrix = JSON.parse(cached);
        }
      } catch (_) {}

      if (!matrix) {
        const doc = await FeatureAccess.getMatrix();
        matrix = doc.features;
        try {
          await redis.set('feature_access_matrix', JSON.stringify(matrix), 'EX', 60);
        } catch (_) {}
      }

      const feature = matrix.find(f => f.featureKey === featureKey);
      if (!feature) {
        
        return next();
      }

      const tierConfig = feature[userTier];
      if (!tierConfig?.enabled) {
        return res.status(403).json({
          success: false,
          message: `This feature is not available on the ${userTier} plan. Please upgrade.`,
          featureKey,
          requiredTier: getMinimumTier(feature),
          currentTier: userTier,
        });
      }

      
      req.featureLimit = tierConfig.limit;
      req.featureTier = userTier;

      next();
    } catch (error) {
      console.error('Feature access check failed:', error);
      
      next();
    }
  };
}

function getMinimumTier(feature) {
  if (feature.basic?.enabled) return 'basic';
  if (feature.pro?.enabled) return 'pro';
  if (feature.premium?.enabled) return 'premium';
  return 'premium';
}

export async function getUserFeatureConfig(userTier = 'basic') {
  let matrix;
  try {
    const cached = await redis.get('feature_access_matrix');
    if (cached) matrix = JSON.parse(cached);
  } catch (_) {}

  if (!matrix) {
    const doc = await FeatureAccess.getMatrix();
    matrix = doc.features;
    try {
      await redis.set('feature_access_matrix', JSON.stringify(matrix), 'EX', 60);
    } catch (_) {}
  }

  const config = {};
  for (const feature of matrix) {
    const tierConfig = feature[userTier];
    config[feature.featureKey] = {
      enabled: tierConfig?.enabled ?? false,
      limit: tierConfig?.limit ?? null,
      label: feature.featureLabel,
      category: feature.category,
    };
  }
  return config;
}
