import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  calculateBackoff,
  isRetryableError,
  fetchWithRetry,
} from './retry';

describe('retry module', () => {
  describe('DEFAULT_RETRY_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.baseDelayMs).toBe(100);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(10000);
      expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBe(0.1);
    });
  });

  describe('calculateBackoff', () => {
    const config: RetryConfig = {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 10000,
      jitterFactor: 0,
    };

    it('should calculate exponential backoff', () => {
      expect(calculateBackoff(0, config)).toBe(100);
      expect(calculateBackoff(1, config)).toBe(200);
      expect(calculateBackoff(2, config)).toBe(400);
      expect(calculateBackoff(3, config)).toBe(800);
    });

    it('should cap at maxDelayMs', () => {
      const shortMaxConfig: RetryConfig = {
        ...config,
        maxDelayMs: 300,
      };

      expect(calculateBackoff(2, shortMaxConfig)).toBe(300);
      expect(calculateBackoff(5, shortMaxConfig)).toBe(300);
    });

    it('should add jitter when jitterFactor > 0', () => {
      const jitterConfig: RetryConfig = {
        ...config,
        jitterFactor: 0.5,
      };

      const results = new Set<number>();
      for (let i = 0; i < 20; i++) {
        results.add(calculateBackoff(0, jitterConfig));
      }

      expect(results.size).toBeGreaterThan(1);

      for (const result of results) {
        expect(result).toBeGreaterThanOrEqual(50);
        expect(result).toBeLessThanOrEqual(150);
      }
    });

    it('should never return negative values', () => {
      const extremeJitterConfig: RetryConfig = {
        ...config,
        jitterFactor: 1,
      };

      for (let i = 0; i < 100; i++) {
        expect(calculateBackoff(0, extremeJitterConfig)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('isRetryableError', () => {
    it('should return true for network errors', () => {
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true);
      expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true);
      expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
      expect(isRetryableError(new Error('network error'))).toBe(true);
      expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    });

    it('should return true for server errors (5xx)', () => {
      expect(isRetryableError(new Error('500 Internal Server Error'))).toBe(true);
      expect(isRetryableError(new Error('502 Bad Gateway'))).toBe(true);
      expect(isRetryableError(new Error('503 Service Unavailable'))).toBe(true);
      expect(isRetryableError(new Error('504 Gateway Timeout'))).toBe(true);
    });

    it('should return true for rate limiting (429)', () => {
      expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
      expect(isRetryableError(new Error('too many requests'))).toBe(true);
    });

    it('should return false for client errors (4xx)', () => {
      expect(isRetryableError(new Error('400 Bad Request'))).toBe(false);
      expect(isRetryableError(new Error('401 Unauthorized'))).toBe(false);
      expect(isRetryableError(new Error('403 Forbidden'))).toBe(false);
      expect(isRetryableError(new Error('404 Not Found'))).toBe(false);
    });

    it('should return false for non-Error objects', () => {
      expect(isRetryableError('string error')).toBe(false);
      expect(isRetryableError(123)).toBe(false);
      expect(isRetryableError(null)).toBe(false);
      expect(isRetryableError(undefined)).toBe(false);
    });
  });

  describe('fetchWithRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const resultPromise = fetchWithRetry(fn);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValue('success');

      const resultPromise = fetchWithRetry(fn, { maxRetries: 3, baseDelayMs: 10, jitterFactor: 0 });

      await vi.advanceTimersByTimeAsync(100);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.data).toBe('success');
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));

      const result = await fetchWithRetry(fn);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('401 Unauthorized');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries and fail', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));

      const resultPromise = fetchWithRetry(fn, { maxRetries: 2, baseDelayMs: 10, jitterFactor: 0 });

      await vi.advanceTimersByTimeAsync(1000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('503 Service Unavailable');
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});
