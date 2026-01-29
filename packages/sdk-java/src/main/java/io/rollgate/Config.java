package io.rollgate;

import java.time.Duration;

/**
 * Configuration for Rollgate client.
 */
public class Config {
    private final String apiKey;
    private String baseUrl = "https://api.rollgate.io";
    private Duration timeout = Duration.ofSeconds(5);
    private Duration refreshInterval = Duration.ofSeconds(30);
    private boolean enableStreaming = false;
    private String sseUrl = null;
    private RetryConfig retry = new RetryConfig();
    private CircuitBreakerConfig circuitBreaker = new CircuitBreakerConfig();
    private CacheConfig cache = new CacheConfig();

    public Config(String apiKey) {
        if (apiKey == null || apiKey.isEmpty()) {
            throw new IllegalArgumentException("API key is required");
        }
        this.apiKey = apiKey;
    }

    public String getApiKey() {
        return apiKey;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public Config setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
        return this;
    }

    public Duration getTimeout() {
        return timeout;
    }

    public Config setTimeout(Duration timeout) {
        this.timeout = timeout;
        return this;
    }

    public Duration getRefreshInterval() {
        return refreshInterval;
    }

    public Config setRefreshInterval(Duration refreshInterval) {
        this.refreshInterval = refreshInterval;
        return this;
    }

    public boolean isEnableStreaming() {
        return enableStreaming;
    }

    public Config setEnableStreaming(boolean enableStreaming) {
        this.enableStreaming = enableStreaming;
        return this;
    }

    public String getSseUrl() {
        return sseUrl != null ? sseUrl : baseUrl;
    }

    public Config setSseUrl(String sseUrl) {
        this.sseUrl = sseUrl;
        return this;
    }

    public RetryConfig getRetry() {
        return retry;
    }

    public Config setRetry(RetryConfig retry) {
        this.retry = retry;
        return this;
    }

    public CircuitBreakerConfig getCircuitBreaker() {
        return circuitBreaker;
    }

    public Config setCircuitBreaker(CircuitBreakerConfig circuitBreaker) {
        this.circuitBreaker = circuitBreaker;
        return this;
    }

    public CacheConfig getCache() {
        return cache;
    }

    public Config setCache(CacheConfig cache) {
        this.cache = cache;
        return this;
    }

    /**
     * Retry configuration.
     */
    public static class RetryConfig {
        private int maxRetries = 3;
        private Duration baseDelay = Duration.ofMillis(100);
        private Duration maxDelay = Duration.ofSeconds(10);
        private double jitterFactor = 0.1;

        public int getMaxRetries() {
            return maxRetries;
        }

        public RetryConfig setMaxRetries(int maxRetries) {
            this.maxRetries = maxRetries;
            return this;
        }

        public Duration getBaseDelay() {
            return baseDelay;
        }

        public RetryConfig setBaseDelay(Duration baseDelay) {
            this.baseDelay = baseDelay;
            return this;
        }

        public Duration getMaxDelay() {
            return maxDelay;
        }

        public RetryConfig setMaxDelay(Duration maxDelay) {
            this.maxDelay = maxDelay;
            return this;
        }

        public double getJitterFactor() {
            return jitterFactor;
        }

        public RetryConfig setJitterFactor(double jitterFactor) {
            this.jitterFactor = jitterFactor;
            return this;
        }
    }

    /**
     * Circuit breaker configuration.
     */
    public static class CircuitBreakerConfig {
        private int failureThreshold = 5;
        private Duration recoveryTimeout = Duration.ofSeconds(30);
        private Duration monitoringWindow = Duration.ofSeconds(60);
        private int successThreshold = 3;

        public int getFailureThreshold() {
            return failureThreshold;
        }

        public CircuitBreakerConfig setFailureThreshold(int failureThreshold) {
            this.failureThreshold = failureThreshold;
            return this;
        }

        public Duration getRecoveryTimeout() {
            return recoveryTimeout;
        }

        public CircuitBreakerConfig setRecoveryTimeout(Duration recoveryTimeout) {
            this.recoveryTimeout = recoveryTimeout;
            return this;
        }

        public Duration getMonitoringWindow() {
            return monitoringWindow;
        }

        public CircuitBreakerConfig setMonitoringWindow(Duration monitoringWindow) {
            this.monitoringWindow = monitoringWindow;
            return this;
        }

        public int getSuccessThreshold() {
            return successThreshold;
        }

        public CircuitBreakerConfig setSuccessThreshold(int successThreshold) {
            this.successThreshold = successThreshold;
            return this;
        }
    }

    /**
     * Cache configuration.
     */
    public static class CacheConfig {
        private Duration ttl = Duration.ofMinutes(5);
        private Duration staleTtl = Duration.ofHours(1);
        private boolean enabled = true;

        public Duration getTtl() {
            return ttl;
        }

        public CacheConfig setTtl(Duration ttl) {
            this.ttl = ttl;
            return this;
        }

        public Duration getStaleTtl() {
            return staleTtl;
        }

        public CacheConfig setStaleTtl(Duration staleTtl) {
            this.staleTtl = staleTtl;
            return this;
        }

        public boolean isEnabled() {
            return enabled;
        }

        public CacheConfig setEnabled(boolean enabled) {
            this.enabled = enabled;
            return this;
        }
    }
}
