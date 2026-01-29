package io.rollgate;

/**
 * Typed error classes for Rollgate SDK.
 */
public class Errors {

    /**
     * Error categories for classification.
     */
    public enum ErrorCategory {
        NETWORK,
        AUTHENTICATION,
        VALIDATION,
        RATE_LIMIT,
        SERVER,
        UNKNOWN
    }

    /**
     * Base exception for all Rollgate SDK errors.
     */
    public static class RollgateError extends RuntimeException {
        private final ErrorCategory category;
        private final boolean retryable;

        public RollgateError(String message, ErrorCategory category, boolean retryable) {
            super(message);
            this.category = category;
            this.retryable = retryable;
        }

        public RollgateError(String message, Throwable cause, ErrorCategory category, boolean retryable) {
            super(message, cause);
            this.category = category;
            this.retryable = retryable;
        }

        public ErrorCategory getCategory() {
            return category;
        }

        public boolean isRetryable() {
            return retryable;
        }
    }

    /**
     * Authentication errors (401, 403).
     */
    public static class AuthenticationError extends RollgateError {
        public AuthenticationError(String message) {
            super(message, ErrorCategory.AUTHENTICATION, false);
        }

        public AuthenticationError(String message, Throwable cause) {
            super(message, cause, ErrorCategory.AUTHENTICATION, false);
        }
    }

    /**
     * Network/connection errors.
     */
    public static class NetworkError extends RollgateError {
        public NetworkError(String message) {
            super(message, ErrorCategory.NETWORK, true);
        }

        public NetworkError(String message, Throwable cause) {
            super(message, cause, ErrorCategory.NETWORK, true);
        }
    }

    /**
     * Rate limit errors (429).
     */
    public static class RateLimitError extends RollgateError {
        private final long retryAfterMs;

        public RateLimitError(String message, long retryAfterMs) {
            super(message, ErrorCategory.RATE_LIMIT, true);
            this.retryAfterMs = retryAfterMs;
        }

        public long getRetryAfterMs() {
            return retryAfterMs;
        }
    }

    /**
     * Validation errors (400).
     */
    public static class ValidationError extends RollgateError {
        public ValidationError(String message) {
            super(message, ErrorCategory.VALIDATION, false);
        }
    }

    /**
     * Server errors (5xx).
     */
    public static class ServerError extends RollgateError {
        private final int statusCode;

        public ServerError(String message, int statusCode) {
            super(message, ErrorCategory.SERVER, true);
            this.statusCode = statusCode;
        }

        public int getStatusCode() {
            return statusCode;
        }
    }

    /**
     * Circuit breaker open error.
     */
    public static class CircuitOpenError extends RollgateError {
        public CircuitOpenError(String message) {
            super(message, ErrorCategory.NETWORK, true);
        }
    }

    /**
     * Determine if an error is retryable.
     */
    public static boolean isRetryable(Throwable error) {
        if (error instanceof RollgateError) {
            return ((RollgateError) error).isRetryable();
        }
        // Network errors are generally retryable
        if (error instanceof java.net.SocketTimeoutException ||
            error instanceof java.net.ConnectException ||
            error instanceof java.io.IOException) {
            return true;
        }
        return false;
    }

    /**
     * Create appropriate error from HTTP status code.
     */
    public static RollgateError fromStatusCode(int statusCode, String message) {
        switch (statusCode) {
            case 400:
                return new ValidationError(message);
            case 401:
            case 403:
                return new AuthenticationError(message);
            case 429:
                return new RateLimitError(message, 1000);
            default:
                if (statusCode >= 500) {
                    return new ServerError(message, statusCode);
                }
                return new RollgateError(message, ErrorCategory.UNKNOWN, false);
        }
    }
}
