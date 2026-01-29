package io.rollgate;

import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Retry utilities with exponential backoff.
 */
public class Retry {

    private final Config.RetryConfig config;

    public Retry() {
        this(new Config.RetryConfig());
    }

    public Retry(Config.RetryConfig config) {
        this.config = config;
    }

    public <T> RetryResult<T> execute(Callable<T> action) {
        Exception lastError = null;
        int attempts = 0;

        while (attempts <= config.getMaxRetries()) {
            attempts++;

            try {
                T result = action.call();
                return new RetryResult<>(true, result, null, attempts);
            } catch (Exception e) {
                lastError = e;

                if (!isRetryable(e)) {
                    return new RetryResult<>(false, null, e, attempts);
                }

                if (attempts > config.getMaxRetries()) {
                    break;
                }

                Duration delay = calculateBackoff(attempts - 1);
                try {
                    Thread.sleep(delay.toMillis());
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    return new RetryResult<>(false, null, e, attempts);
                }
            }
        }

        return new RetryResult<>(false, null, lastError, attempts);
    }

    public Duration calculateBackoff(int attempt) {
        long baseMs = config.getBaseDelay().toMillis();
        long delayMs = (long) (baseMs * Math.pow(2, attempt));

        // Apply jitter
        if (config.getJitterFactor() > 0) {
            double jitter = delayMs * config.getJitterFactor();
            delayMs += (long) (ThreadLocalRandom.current().nextDouble(-jitter, jitter));
        }

        // Ensure non-negative
        delayMs = Math.max(0, delayMs);

        // Cap at max delay
        long maxMs = config.getMaxDelay().toMillis();
        delayMs = Math.min(delayMs, maxMs);

        return Duration.ofMillis(delayMs);
    }

    public static boolean isRetryable(Exception e) {
        if (e == null) {
            return false;
        }

        String message = e.getMessage();
        if (message == null) {
            return false;
        }

        String msgLower = message.toLowerCase();

        // Network errors
        String[] networkPatterns = {
            "timeout", "timed out", "connection refused", "connection reset",
            "no route to host", "network is unreachable", "socket"
        };

        for (String pattern : networkPatterns) {
            if (msgLower.contains(pattern)) {
                return true;
            }
        }

        // Server errors (5xx)
        String[] serverPatterns = {"503", "502", "504", "500", "429"};
        for (String pattern : serverPatterns) {
            if (msgLower.contains(pattern)) {
                return true;
            }
        }

        // Rate limiting
        if (msgLower.contains("too many requests")) {
            return true;
        }

        return false;
    }

    /**
     * Result of a retry operation.
     */
    public static class RetryResult<T> {
        private final boolean success;
        private final T data;
        private final Exception error;
        private final int attempts;

        public RetryResult(boolean success, T data, Exception error, int attempts) {
            this.success = success;
            this.data = data;
            this.error = error;
            this.attempts = attempts;
        }

        public boolean isSuccess() {
            return success;
        }

        public T getData() {
            return data;
        }

        public Exception getError() {
            return error;
        }

        public int getAttempts() {
            return attempts;
        }
    }
}
