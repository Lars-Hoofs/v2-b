import rateLimit from 'express-rate-limit';
import { redis } from '../lib/redis';
import type { Options, Store } from 'express-rate-limit';

// Custom Redis store that works with ioredis
class IORedisStore implements Store {
  prefix: string;
  windowMs: number;

  constructor(options: { prefix: string; windowMs: number }) {
    this.prefix = options.prefix;
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const fullKey = this.prefix + key;
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Remove old entries
    await redis.zremrangebyscore(fullKey, 0, windowStart);

    // Add current request
    await redis.zadd(fullKey, now, `${now}-${Math.random()}`);

    // Set expiry
    await redis.pexpire(fullKey, this.windowMs);

    // Count requests in window
    const totalHits = await redis.zcard(fullKey);

    return {
      totalHits,
      resetTime: new Date(now + this.windowMs),
    };
  }

  async decrement(key: string): Promise<void> {
    const fullKey = this.prefix + key;
    const members = await redis.zrange(fullKey, 0, 0);
    if (members.length > 0) {
      await redis.zrem(fullKey, members[0]);
    }
  }

  async resetKey(key: string): Promise<void> {
    const fullKey = this.prefix + key;
    await redis.del(fullKey);
  }
}

// API rate limiting - general endpoints
const apiWindowMs = 1 * 60 * 1000; // 1 minute
export const apiLimiter = rateLimit({
  store: new IORedisStore({
    prefix: 'rl:api:',
    windowMs: apiWindowMs,
  }),
  windowMs: apiWindowMs,
  max: 60,
  message: { error: 'Too many requests from this IP, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth rate limiting - stricter for authentication endpoints
const authWindowMs = 15 * 60 * 1000; // 15 minutes
export const authLimiter = rateLimit({
  store: new IORedisStore({
    prefix: 'rl:auth:',
    windowMs: authWindowMs,
  }),
  windowMs: authWindowMs,
  max: 100,
  message: { error: 'Too many authentication attempts. Please try again later.' },
  skipSuccessfulRequests: false,
  standardHeaders: true,
  legacyHeaders: false,
});

// Chat message rate limiting - CRITICAL to prevent OpenAI cost explosion
const chatWindowMs = 1 * 60 * 1000; // 1 minute
export const chatLimiter = rateLimit({
  store: new IORedisStore({
    prefix: 'rl:chat:',
    windowMs: chatWindowMs,
  }),
  windowMs: chatWindowMs,
  max: 20, // 20 messages per minute
  message: { error: 'Too many messages. Please wait before sending more.' },
  keyGenerator: (req) => {
    // Rate limit by conversation ID + IP (not by user auth)
    const conversationId = req.body?.conversationId || 'unknown';
    return `${conversationId}:${req.ip}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Workflow execution limit
const workflowWindowMs = 5 * 60 * 1000; // 5 minutes
export const workflowLimiter = rateLimit({
  store: new IORedisStore({
    prefix: 'rl:workflow:',
    windowMs: workflowWindowMs,
  }),
  windowMs: workflowWindowMs,
  max: 100, // 100 workflow actions per 5min
  message: { error: 'Workflow rate limit exceeded. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Scraping rate limiters
const scrapingWindowMs = 60 * 60 * 1000; // 1 hour
export const scrapingLimiter = rateLimit({
  store: new IORedisStore({
    prefix: 'rl:scrape:',
    windowMs: scrapingWindowMs,
  }),
  windowMs: scrapingWindowMs,
  max: 10,
  message: { error: 'Too many scraping requests. Limit: 10 per hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const singlePageWindowMs = 60 * 60 * 1000; // 1 hour
export const singlePageScrapeLimiter = rateLimit({
  store: new IORedisStore({
    prefix: 'rl:scrape-single:',
    windowMs: singlePageWindowMs,
  }),
  windowMs: singlePageWindowMs,
  max: 100,
  message: { error: 'Too many single page scrapes. Limit: 100 per hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});
