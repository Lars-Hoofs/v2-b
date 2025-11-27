import { redis } from './redis';
import { nanoid } from 'nanoid';
import logger from './logger';

export class RedisLock {
  private lockKey: string;
  private lockValue: string;
  private ttl: number;

  constructor(resource: string, ttlSeconds: number = 30) {
    this.lockKey = `lock:${resource}`;
    this.lockValue = nanoid();
    this.ttl = ttlSeconds;
  }

  /**
   * Try to acquire the lock
   * Returns true if lock was acquired, false if already locked
   */
  async acquire(): Promise<boolean> {
    try {
      const result = await redis.set(
        this.lockKey,
        this.lockValue,
        'EX',
        this.ttl,
        'NX'
      );
      
      if (result === 'OK') {
        logger.debug('Lock acquired', { lockKey: this.lockKey });
        return true;
      }
      
      logger.debug('Lock already held', { lockKey: this.lockKey });
      return false;
    } catch (error) {
      logger.error('Failed to acquire lock', { lockKey: this.lockKey, error });
      return false;
    }
  }

  /**
   * Release the lock (only if we own it)
   */
  async release(): Promise<void> {
    try {
      // Lua script ensures atomicity: only delete if we own the lock
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await redis.eval(script, 1, this.lockKey, this.lockValue);
      
      if (result === 1) {
        logger.debug('Lock released', { lockKey: this.lockKey });
      } else {
        logger.warn('Lock was not owned or already expired', { lockKey: this.lockKey });
      }
    } catch (error) {
      logger.error('Failed to release lock', { lockKey: this.lockKey, error });
    }
  }

  /**
   * Extend the lock TTL (only if we own it)
   */
  async extend(additionalSeconds: number): Promise<boolean> {
    try {
      const newTTL = this.ttl + additionalSeconds;
      
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("expire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      
      const result = await redis.eval(
        script,
        1,
        this.lockKey,
        this.lockValue,
        newTTL
      );
      
      if (result === 1) {
        this.ttl = newTTL;
        logger.debug('Lock extended', { lockKey: this.lockKey, newTTL });
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Failed to extend lock', { lockKey: this.lockKey, error });
      return false;
    }
  }

  /**
   * Helper to run a function with automatic lock acquisition and release
   */
  static async withLock<T>(
    resource: string,
    fn: () => Promise<T>,
    options: { ttl?: number; waitMs?: number; retries?: number } = {}
  ): Promise<T> {
    const { ttl = 30, waitMs = 100, retries = 3 } = options;
    const lock = new RedisLock(resource, ttl);
    
    // Try to acquire lock with retries
    let acquired = false;
    for (let i = 0; i < retries; i++) {
      acquired = await lock.acquire();
      if (acquired) break;
      
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, waitMs * (i + 1)));
      }
    }
    
    if (!acquired) {
      throw new Error(`Failed to acquire lock for resource: ${resource}`);
    }

    try {
      return await fn();
    } finally {
      await lock.release();
    }
  }
}
