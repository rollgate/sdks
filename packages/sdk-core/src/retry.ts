/**
 * Retry utility with exponential backoff and jitter
 */

export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds (default: 100) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs: number;
  /** Jitter factor 0-1 to randomize delays (default: 0.1) */
  jitterFactor: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  jitterFactor: 0.1,
};

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate backoff delay with exponential increase and jitter
 */
export function calculateBackoff(attempt: number, config: RetryConfig): number {
  // Exponential: baseDelay * 2^attempt
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter: random value between -jitter and +jitter
  const jitter = cappedDelay * config.jitterFactor * (Math.random() * 2 - 1);

  return Math.max(0, cappedDelay + jitter);
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  // Check if error has explicit retryable property (e.g., RollgateError)
  if ("retryable" in error && typeof error.retryable === "boolean") {
    return error.retryable;
  }

  const message = error.message.toLowerCase();

  // Network errors (always retry)
  if (message.includes("econnrefused")) return true;
  if (message.includes("etimedout")) return true;
  if (message.includes("enotfound")) return true;
  if (message.includes("econnreset")) return true;
  if (message.includes("network")) return true;
  if (message.includes("fetch failed")) return true;
  if (message.includes("aborted")) return true;

  // HTTP 5xx errors (server issues, retry)
  if (message.includes("500")) return true;
  if (message.includes("502")) return true; // Bad Gateway
  if (message.includes("503")) return true; // Service Unavailable
  if (message.includes("504")) return true; // Gateway Timeout

  // Rate limiting (retry with backoff)
  if (message.includes("429")) return true;
  if (message.includes("too many requests")) return true;

  // HTTP 4xx errors (client errors, don't retry)
  if (message.includes("400")) return false;
  if (message.includes("401")) return false;
  if (message.includes("403")) return false;
  if (message.includes("404")) return false;

  return false;
}

/**
 * Execute a function with retry logic and exponential backoff
 */
export async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<RetryResult<T>> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      const data = await fn();
      return {
        success: true,
        data,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry non-retryable errors
      if (!isRetryableError(lastError)) {
        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
        };
      }

      // Don't sleep after the last attempt
      if (attempt < fullConfig.maxRetries) {
        const delay = calculateBackoff(attempt, fullConfig);
        await sleep(delay);
      }
    }
  }

  return {
    success: false,
    error: lastError || new Error("Retry exhausted"),
    attempts: fullConfig.maxRetries + 1,
  };
}
