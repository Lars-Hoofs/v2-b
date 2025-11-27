import { prisma } from './prisma';
import { Prisma } from '@prisma/client';
import logger from './logger';

/**
 * Execute a function within a database transaction
 * Automatically rolls back on error
 */
export async function withTransaction<T>(
  fn: (tx: typeof prisma) => Promise<T>,
  options?: {
    maxWait?: number;
    timeout?: number;
    isolationLevel?: Prisma.TransactionIsolationLevel;
  }
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        return await fn(tx as typeof prisma);
      },
      {
        maxWait: options?.maxWait ?? 5000, // 5 seconds
        timeout: options?.timeout ?? 10000, // 10 seconds
        isolationLevel: options?.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
      }
    );
    
    const duration = Date.now() - startTime;
    logger.debug('Transaction completed', { duration });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Transaction failed', { duration, error });
    throw error;
  }
}

/**
 * Execute multiple operations in a transaction with automatic retry
 */
export async function withRetryTransaction<T>(
  fn: (tx: typeof prisma) => Promise<T>,
  options?: {
    maxRetries?: number;
    retryDelay?: number;
  }
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const retryDelay = options?.retryDelay ?? 100;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await withTransaction(fn);
    } catch (error: any) {
      // Retry on serialization errors or deadlocks
      const shouldRetry = 
        error.code === 'P2034' || // Transaction conflict
        error.code === 'P2024' || // Timeout
        error.message?.includes('deadlock') ||
        error.message?.includes('serialization');
      
      if (!shouldRetry || attempt === maxRetries) {
        throw error;
      }
      
      logger.warn('Transaction failed, retrying', { 
        attempt, 
        maxRetries, 
        error: error.message 
      });
      
      // Exponential backoff
      await new Promise(resolve => 
        setTimeout(resolve, retryDelay * Math.pow(2, attempt - 1))
      );
    }
  }
  
  throw new Error('Transaction retry limit exceeded');
}
