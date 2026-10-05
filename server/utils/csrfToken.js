import crypto from 'crypto';
import redis from './redisClient.js';

const DEFAULT_TTL = 60 * 60 * 24 * 7;

export const generateCsrfToken = async (userId, ttl = DEFAULT_TTL) => {
  const token = crypto.randomBytes(32).toString('hex');
  await redis.set(`csrf:${userId}`, token, 'EX', ttl);
  return token;
};

export const verifyCsrfToken = async (userId, token) => {
  if (!userId || !token) return false;
  const stored = await redis.get(`csrf:${userId}`);
  return stored && stored === token;
};
