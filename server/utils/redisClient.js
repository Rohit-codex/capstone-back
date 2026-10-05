import Redis from 'ioredis';

const baseConfig = {
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  connectTimeout: 10000,
  commandTimeout: 5000,
  enableOfflineQueue: true,
  retryStrategy: (attempt) => Math.min(1000 * attempt, 5000),
  reconnectOnError: (err) => {
    const msg = err && err.message ? err.message : '';
    return (
      msg.includes('READONLY') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('write EPIPE')
    );
  },
};

const REDIS_URL = process.env.REDIS_URL;
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_PORT = process.env.REDIS_PORT;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

const REDIS_TLS_ENV = String(process.env.REDIS_TLS || '').toLowerCase();
const isExplicitTls = REDIS_TLS_ENV === 'true' || REDIS_TLS_ENV === 'false';
let urlImpliesTls = false;
try {
  if (REDIS_URL) {
    const scheme = new URL(REDIS_URL).protocol.replace(':', '');
    urlImpliesTls = scheme === 'rediss';
  }
} catch {}
const REDIS_TLS = isExplicitTls ? (REDIS_TLS_ENV === 'true') : urlImpliesTls;

let connectionDescriptor = 'localhost:6379';
let redisInstanceFactory = () => new Redis({
  host: 'localhost',
  port: 6379,
  ...baseConfig,
});

if (REDIS_URL) {
  connectionDescriptor = REDIS_URL;
  const tlsOptions = REDIS_TLS ? { tls: { rejectUnauthorized: false } } : {};
  redisInstanceFactory = () => new Redis(REDIS_URL, { ...baseConfig, ...tlsOptions });
} else if (REDIS_HOST || REDIS_PORT || REDIS_PASSWORD) {
  const host = REDIS_HOST || 'localhost';
  const port = Number(REDIS_PORT || 6379);
  const password = REDIS_PASSWORD || undefined;
  connectionDescriptor = `${host}:${port}`;
  const tlsOptions = REDIS_TLS ? { tls: { rejectUnauthorized: false } } : {};
  redisInstanceFactory = () => new Redis({ host, port, password, ...baseConfig, ...tlsOptions });
}

let redis;

const disableRedis = String(process.env.REDIS_DISABLE || '').toLowerCase() === 'true';
if (!disableRedis) {
  try {
    redis = redisInstanceFactory();
  } catch (e) {
    console.error('Redis constructor failed, switching to minimal in-memory shim:', e?.message || e);
  }
}

if (redis && typeof redis.on === 'function') {
  redis.on('connect', () => {
    console.log('Redis connected successfully to', connectionDescriptor, REDIS_TLS ? '(TLS)' : '(plain)');
  });
  redis.on('error', (err) => {
    console.error('Redis connection error:', err && err.message ? err.message : err);
  });
  redis.on('close', () => {
    console.log('Redis connection closed');
  });
}

// In-memory shim when Redis is disabled or unavailable
if (!redis) {
  const memoryStore = new Map();
  redis = {
    async set(key, value, mode, ttlSeconds) {
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
      memoryStore.set(key, { value, expiresAt });
    },
    async get(key) {
      const entry = memoryStore.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        memoryStore.delete(key);
        return null;
      }
      return entry.value;
    },
    async del(key) {
      memoryStore.delete(key);
    },
    async incr(key) {
      const entry = memoryStore.get(key);
      // Treat as expired/reset if TTL has passed
      const expired = entry?.expiresAt && entry.expiresAt < Date.now();
      if (expired) memoryStore.delete(key);
      const current = (!expired && entry) ? (Number(entry.value) || 0) : 0;
      const next = current + 1;
      // Preserve existing expiresAt so that expire() called after incr sticks
      memoryStore.set(key, { value: String(next), expiresAt: expired ? undefined : entry?.expiresAt });
      return next;
    },
    async expire(key, ttlSeconds) {
      const entry = memoryStore.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
      memoryStore.set(key, entry);
      return 1;
    },
    on() {},
  };
  console.log('Using in-memory Redis shim', disableRedis ? '(REDIS_DISABLE=true)' : '(constructor failed)');
}

export default redis;