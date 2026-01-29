/**
 * Circuit Breaker States
 */
export enum CircuitState {
  /** Normal operation, requests pass through */
  CLOSED = "closed",
  /** Circuit is open, requests fail fast */
  OPEN = "open",
  /** Testing if service has recovered */
  HALF_OPEN = "half_open",
}

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time to wait before attempting recovery (default: 30000ms) */
  recoveryTimeout: number;
  /** Window for counting failures (default: 60000ms) */
  monitoringWindow: number;
  /** Number of successful requests in half-open to close circuit (default: 3) */
  successThreshold: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeout: 30000,
  monitoringWindow: 60000,
  successThreshold: 3,
};

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(message: string = "Circuit breaker is open") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

/** Event data for circuit breaker events */
interface CircuitEventData {
  state?: CircuitState;
  previousState?: CircuitState;
  failures?: number;
  timeUntilRetry?: number;
  from?: CircuitState;
  to?: CircuitState;
  lastFailureTime?: number;
  successes?: number;
}

type CircuitEventHandler = (data?: CircuitEventData) => void;

/**
 * Circuit Breaker implementation
 *
 * Prevents cascading failures by failing fast when a service is down.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = [];
  private lastFailureTime: number = 0;
  private halfOpenSuccesses: number = 0;
  private config: CircuitBreakerConfig;
  private eventHandlers: Map<string, CircuitEventHandler[]> = new Map();

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Add event listener
   */
  on(event: string, handler: CircuitEventHandler): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  /**
   * Emit event
   */
  private emit(event: string, data?: CircuitEventData): void {
    const handlers = this.eventHandlers.get(event) || [];
    handlers.forEach((handler) => handler(data));
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitOpenError(
          `Circuit breaker is open. Will retry after ${this.getTimeUntilRetry()}ms`,
        );
      }
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

  /**
   * Handle successful request
   */
  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.halfOpenSuccesses++;
      this.emit("half-open-success", { successes: this.halfOpenSuccesses });

      if (this.halfOpenSuccesses >= this.config.successThreshold) {
        this.reset();
      }
    }

    // Clean up old failures outside monitoring window
    this.cleanupOldFailures();
  }

  /**
   * Handle failed request
   */
  private onFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.lastFailureTime = now;

    // If in HALF_OPEN, immediately open the circuit
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
      this.halfOpenSuccesses = 0;
      return;
    }

    // Clean up old failures and check threshold
    this.cleanupOldFailures();

    if (this.failures.length >= this.config.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  /**
   * Remove failures outside the monitoring window
   */
  private cleanupOldFailures(): void {
    const cutoff = Date.now() - this.config.monitoringWindow;
    this.failures = this.failures.filter((t) => t > cutoff);
  }

  /**
   * Check if enough time has passed to attempt reset
   */
  private shouldAttemptReset(): boolean {
    return Date.now() - this.lastFailureTime >= this.config.recoveryTimeout;
  }

  /**
   * Get time until next retry attempt is allowed
   */
  private getTimeUntilRetry(): number {
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.config.recoveryTimeout - elapsed);
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    this.emit("state-change", { from: oldState, to: newState });

    if (newState === CircuitState.OPEN) {
      this.emit("circuit-open", {
        failures: this.failures.length,
        lastFailureTime: this.lastFailureTime,
      });
    } else if (newState === CircuitState.CLOSED) {
      this.emit("circuit-closed");
    } else if (newState === CircuitState.HALF_OPEN) {
      this.emit("circuit-half-open");
    }
  }

  /**
   * Reset the circuit breaker to closed state
   */
  private reset(): void {
    this.failures = [];
    this.halfOpenSuccesses = 0;
    this.transitionTo(CircuitState.CLOSED);
  }

  /**
   * Force reset the circuit breaker
   */
  forceReset(): void {
    this.reset();
  }

  /**
   * Force open the circuit breaker
   */
  forceOpen(): void {
    this.lastFailureTime = Date.now();
    this.transitionTo(CircuitState.OPEN);
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get circuit breaker stats
   */
  getStats(): {
    state: CircuitState;
    failures: number;
    lastFailureTime: number | null;
    halfOpenSuccesses: number;
  } {
    return {
      state: this.state,
      failures: this.failures.length,
      lastFailureTime: this.lastFailureTime || null,
      halfOpenSuccesses: this.halfOpenSuccesses,
    };
  }

  /**
   * Check if circuit is allowing requests
   */
  isAllowingRequests(): boolean {
    if (this.state === CircuitState.CLOSED) return true;
    if (this.state === CircuitState.HALF_OPEN) return true;
    if (this.state === CircuitState.OPEN && this.shouldAttemptReset())
      return true;
    return false;
  }
}
