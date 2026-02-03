package io.rollgate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;

import java.io.IOException;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.ReentrantReadWriteLock;

/**
 * Rollgate SDK client for feature flags.
 */
public class RollgateClient implements AutoCloseable {

    private static final String SDK_NAME = "rollgate-java";
    private static final String SDK_VERSION = "0.1.0";

    private final Config config;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    private final CircuitBreaker circuitBreaker;
    private final FlagCache cache;
    private final Retry retry;

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
    private Map<String, Boolean> flags = new HashMap<>();
    private Map<String, EvaluationReason> flagReasons = new HashMap<>();
    private UserContext user;
    private String lastETag;

    private final AtomicBoolean ready = new AtomicBoolean(false);
    private final ScheduledExecutorService scheduler;
    private ScheduledFuture<?> pollingTask;

    // Request deduplication
    private final ConcurrentHashMap<String, CompletableFuture<Void>> inflightRequests = new ConcurrentHashMap<>();

    public RollgateClient(Config config) {
        this.config = config;
        this.objectMapper = new ObjectMapper();

        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(config.getTimeout())
            .readTimeout(config.getTimeout())
            .writeTimeout(config.getTimeout())
            .build();

        this.circuitBreaker = new CircuitBreaker(config.getCircuitBreaker());
        this.cache = new FlagCache(config.getCache());
        this.retry = new Retry(config.getRetry());

        this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "rollgate-poller");
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * Initialize the client and fetch flags.
     */
    public void initialize() throws RollgateException {
        // Try cache first
        if (config.getCache().isEnabled()) {
            cache.get().ifPresent(result -> {
                lock.writeLock().lock();
                try {
                    flags = new HashMap<>(result.getFlags());
                } finally {
                    lock.writeLock().unlock();
                }
            });
        }

        // Fetch fresh flags
        try {
            refresh();
        } catch (RollgateException e) {
            if (cache.hasAny()) {
                // We have cache, continue
            } else {
                throw e;
            }
        }

        ready.set(true);

        // Start polling
        if (config.getRefreshInterval().toMillis() > 0) {
            startPolling();
        }
    }

    /**
     * Check if a flag is enabled.
     */
    public boolean isEnabled(String flagKey, boolean defaultValue) {
        return isEnabledDetail(flagKey, defaultValue).getValue();
    }

    /**
     * Check if a flag is enabled with evaluation reason.
     *
     * @param flagKey      The flag key to check
     * @param defaultValue Default value if flag not found
     * @return EvaluationDetail containing the value and reason
     */
    public EvaluationDetail<Boolean> isEnabledDetail(String flagKey, boolean defaultValue) {
        // Check if client is ready
        if (!ready.get()) {
            return new EvaluationDetail<>(defaultValue,
                EvaluationReason.error(EvaluationReason.ErrorKind.CLIENT_NOT_READY));
        }

        lock.readLock().lock();
        try {
            // Check if flag exists
            if (!flags.containsKey(flagKey)) {
                return new EvaluationDetail<>(defaultValue, EvaluationReason.unknown());
            }

            boolean value = flags.get(flagKey);
            // Use stored reason from server, or FALLTHROUGH as default
            EvaluationReason reason = flagReasons.get(flagKey);
            if (reason == null) {
                reason = EvaluationReason.fallthrough(value);
            }
            return new EvaluationDetail<>(value, reason);
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * Alias for isEnabledDetail for LaunchDarkly compatibility.
     *
     * @param flagKey      The flag key to check
     * @param defaultValue Default value if flag not found
     * @return EvaluationDetail containing the value and reason
     */
    public EvaluationDetail<Boolean> boolVariationDetail(String flagKey, boolean defaultValue) {
        return isEnabledDetail(flagKey, defaultValue);
    }

    /**
     * Get all flags.
     */
    public Map<String, Boolean> getAllFlags() {
        lock.readLock().lock();
        try {
            return Collections.unmodifiableMap(new HashMap<>(flags));
        } finally {
            lock.readLock().unlock();
        }
    }

    /**
     * Set user context for targeting.
     */
    public void identify(UserContext user) throws RollgateException {
        lock.writeLock().lock();
        try {
            this.user = user;
        } finally {
            lock.writeLock().unlock();
        }
        refresh();
    }

    /**
     * Clear user context.
     */
    public void reset() throws RollgateException {
        lock.writeLock().lock();
        try {
            this.user = null;
        } finally {
            lock.writeLock().unlock();
        }
        refresh();
    }

    /**
     * Force refresh flags.
     */
    public void refresh() throws RollgateException {
        // Deduplicate concurrent requests
        CompletableFuture<Void> existing = inflightRequests.get("fetch-flags");
        if (existing != null) {
            try {
                existing.get(config.getTimeout().toMillis(), TimeUnit.MILLISECONDS);
                return;
            } catch (Exception e) {
                // Continue with new request
            }
        }

        CompletableFuture<Void> future = new CompletableFuture<>();
        CompletableFuture<Void> previous = inflightRequests.putIfAbsent("fetch-flags", future);
        if (previous != null) {
            try {
                previous.get(config.getTimeout().toMillis(), TimeUnit.MILLISECONDS);
                return;
            } catch (Exception e) {
                // Continue with new request
            }
        }

        try {
            fetchFlags();
            future.complete(null);
        } catch (RollgateException e) {
            future.completeExceptionally(e);
            throw e;
        } finally {
            inflightRequests.remove("fetch-flags");
        }
    }

    /**
     * Check if client is ready.
     */
    public boolean isReady() {
        return ready.get();
    }

    /**
     * Get circuit breaker state.
     */
    public CircuitBreaker.State getCircuitState() {
        return circuitBreaker.getState();
    }

    /**
     * Get cache statistics.
     */
    public FlagCache.CacheStats getCacheStats() {
        return cache.getStats();
    }

    @Override
    public void close() {
        if (pollingTask != null) {
            pollingTask.cancel(true);
        }

        // Shutdown scheduler
        scheduler.shutdown();
        try {
            if (!scheduler.awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS)) {
                scheduler.shutdownNow();
            }
        } catch (InterruptedException e) {
            scheduler.shutdownNow();
            Thread.currentThread().interrupt();
        }

        // Shutdown HTTP client dispatcher
        httpClient.dispatcher().executorService().shutdown();
        try {
            if (!httpClient.dispatcher().executorService().awaitTermination(5, java.util.concurrent.TimeUnit.SECONDS)) {
                httpClient.dispatcher().executorService().shutdownNow();
            }
        } catch (InterruptedException e) {
            httpClient.dispatcher().executorService().shutdownNow();
            Thread.currentThread().interrupt();
        }

        // Evict all connections
        httpClient.connectionPool().evictAll();
    }

    private void fetchFlags() throws RollgateException {
        if (!circuitBreaker.isAllowingRequests()) {
            useCachedFallback();
            throw new RollgateException("Circuit breaker is open");
        }

        try {
            circuitBreaker.execute(() -> {
                Retry.RetryResult<Void> result = retry.execute(() -> {
                    doFetchRequest();
                    return null;
                });

                if (!result.isSuccess()) {
                    throw new RuntimeException(result.getError());
                }
                return null;
            });
        } catch (CircuitBreaker.CircuitOpenException e) {
            useCachedFallback();
            throw new RollgateException("Circuit breaker is open", e);
        } catch (Exception e) {
            useCachedFallback();
            throw new RollgateException("Failed to fetch flags", e);
        }
    }

    private void doFetchRequest() throws IOException, RollgateException {
        HttpUrl.Builder urlBuilder = HttpUrl.parse(config.getBaseUrl() + "/api/v1/sdk/flags").newBuilder();

        lock.readLock().lock();
        try {
            if (user != null && user.getId() != null) {
                urlBuilder.addQueryParameter("user_id", user.getId());
            }
        } finally {
            lock.readLock().unlock();
        }
        // Request evaluation reasons from server
        urlBuilder.addQueryParameter("withReasons", "true");

        Request.Builder requestBuilder = new Request.Builder()
            .url(urlBuilder.build())
            .addHeader("Authorization", "Bearer " + config.getApiKey())
            .addHeader("Content-Type", "application/json")
            .addHeader("X-SDK-Name", SDK_NAME)
            .addHeader("X-SDK-Version", SDK_VERSION);

        if (lastETag != null) {
            requestBuilder.addHeader("If-None-Match", lastETag);
        }

        try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
            if (response.code() == 304) {
                // Not modified
                return;
            }

            if (!response.isSuccessful()) {
                handleErrorResponse(response);
                return;
            }

            String etag = response.header("ETag");
            if (etag != null) {
                lastETag = etag;
            }

            ResponseBody body = response.body();
            if (body != null) {
                JsonNode json = objectMapper.readTree(body.string());
                JsonNode flagsNode = json.get("flags");

                if (flagsNode != null && flagsNode.isObject()) {
                    Map<String, Boolean> newFlags = new HashMap<>();
                    flagsNode.fields().forEachRemaining(entry -> {
                        newFlags.put(entry.getKey(), entry.getValue().asBoolean());
                    });

                    // Parse reasons if present
                    Map<String, EvaluationReason> newReasons = new HashMap<>();
                    JsonNode reasonsNode = json.get("reasons");
                    if (reasonsNode != null && reasonsNode.isObject()) {
                        reasonsNode.fields().forEachRemaining(entry -> {
                            JsonNode r = entry.getValue();
                            String kind = r.has("kind") ? r.get("kind").asText() : "UNKNOWN";
                            String ruleId = r.has("ruleId") ? r.get("ruleId").asText() : null;
                            Integer ruleIndex = r.has("ruleIndex") ? r.get("ruleIndex").asInt() : null;
                            Boolean inRollout = r.has("inRollout") ? r.get("inRollout").asBoolean() : null;
                            String errorKind = r.has("errorKind") ? r.get("errorKind").asText() : null;
                            newReasons.put(entry.getKey(), EvaluationReason.fromStrings(kind, ruleId, ruleIndex, inRollout, errorKind));
                        });
                    }

                    lock.writeLock().lock();
                    try {
                        flags = newFlags;
                        flagReasons = newReasons;
                    } finally {
                        lock.writeLock().unlock();
                    }

                    if (config.getCache().isEnabled()) {
                        cache.set(newFlags);
                    }
                }
            }
        }
    }

    private void handleErrorResponse(Response response) throws RollgateException {
        int code = response.code();
        switch (code) {
            case 401:
            case 403:
                throw new RollgateException("Authentication failed: " + code);
            case 429:
                throw new RollgateException("Rate limit exceeded");
            default:
                if (code >= 500) {
                    throw new RollgateException("Server error: " + code);
                }
                throw new RollgateException("Request failed: " + code);
        }
    }

    private void useCachedFallback() {
        if (!config.getCache().isEnabled()) {
            return;
        }

        cache.get().ifPresent(result -> {
            lock.writeLock().lock();
            try {
                flags = new HashMap<>(result.getFlags());
            } finally {
                lock.writeLock().unlock();
            }
        });
    }

    private void startPolling() {
        long intervalMs = config.getRefreshInterval().toMillis();
        pollingTask = scheduler.scheduleAtFixedRate(() -> {
            try {
                refresh();
            } catch (Exception e) {
                // Log but don't crash
            }
        }, intervalMs, intervalMs, TimeUnit.MILLISECONDS);
    }

    /**
     * Rollgate SDK exception.
     */
    public static class RollgateException extends Exception {
        public RollgateException(String message) {
            super(message);
        }

        public RollgateException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
