import logger from './logger';

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  name?: string;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailTime = 0;
  private nextAttemptTime = 0;
  
  private failureThreshold: number;
  private successThreshold: number;
  private timeout: number;
  private name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.successThreshold = options.successThreshold ?? 2;
    this.timeout = options.timeout ?? 60000; // 60 seconds
    this.name = options.name ?? 'circuit-breaker';
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        logger.warn('Circuit breaker is OPEN', {
          name: this.name,
          failures: this.failures,
          nextAttempt: new Date(this.nextAttemptTime).toISOString(),
        });
        throw new CircuitBreakerError(
          `Circuit breaker "${this.name}" is OPEN. Too many failures.`
        );
      }
      
      // Transition to HALF_OPEN to test the service
      this.state = CircuitState.HALF_OPEN;
      this.successes = 0;
      logger.info('Circuit breaker transitioning to HALF_OPEN', { name: this.name });
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      
      if (this.successes >= this.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successes = 0;
        logger.info('Circuit breaker CLOSED (service recovered)', {
          name: this.name,
        });
      }
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediate open on failure in HALF_OPEN state
      this.openCircuit();
      return;
    }

    if (this.failures >= this.failureThreshold) {
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = Date.now() + this.timeout;
    
    logger.error('Circuit breaker OPENED', {
      name: this.name,
      failures: this.failures,
      nextAttempt: new Date(this.nextAttemptTime).toISOString(),
    });
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailTime: this.lastFailTime ? new Date(this.lastFailTime).toISOString() : null,
      nextAttemptTime: this.nextAttemptTime ? new Date(this.nextAttemptTime).toISOString() : null,
    };
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailTime = 0;
    this.nextAttemptTime = 0;
    logger.info('Circuit breaker manually reset', { name: this.name });
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}
