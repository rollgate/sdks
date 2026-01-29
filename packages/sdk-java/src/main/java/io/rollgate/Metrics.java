package io.rollgate;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * SDK metrics collection for monitoring and observability.
 */
public class Metrics {

    private final AtomicLong totalRequests = new AtomicLong(0);
    private final AtomicLong successfulRequests = new AtomicLong(0);
    private final AtomicLong failedRequests = new AtomicLong(0);
    private final AtomicLong cacheHits = new AtomicLong(0);
    private final AtomicLong cacheMisses = new AtomicLong(0);
    private final AtomicLong circuitOpens = new AtomicLong(0);
    private final AtomicLong circuitCloses = new AtomicLong(0);
    private final AtomicLong totalEvaluations = new AtomicLong(0);

    private final ConcurrentHashMap<String, AtomicLong> errorsByCategory = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, FlagStats> flagStats = new ConcurrentHashMap<>();

    private final List<Long> latencies = Collections.synchronizedList(new ArrayList<>());
    private static final int MAX_LATENCY_HISTORY = 1000;

    private final AtomicReference<CircuitBreaker.State> circuitState =
        new AtomicReference<>(CircuitBreaker.State.CLOSED);

    private final long startTime = System.currentTimeMillis();
    private final AtomicLong lastRequestAt = new AtomicLong(0);

    /**
     * Flag evaluation statistics.
     */
    public static class FlagStats {
        private final AtomicLong evaluations = new AtomicLong(0);
        private final AtomicLong trueCount = new AtomicLong(0);
        private final AtomicLong totalTimeMs = new AtomicLong(0);

        public void record(boolean result, long evaluationTimeMs) {
            evaluations.incrementAndGet();
            if (result) {
                trueCount.incrementAndGet();
            }
            totalTimeMs.addAndGet(evaluationTimeMs);
        }

        public long getEvaluations() { return evaluations.get(); }
        public long getTrueCount() { return trueCount.get(); }
        public long getFalseCount() { return evaluations.get() - trueCount.get(); }
        public double getTrueRate() {
            long total = evaluations.get();
            return total > 0 ? (double) trueCount.get() / total * 100 : 0;
        }
        public double getAvgEvaluationTimeMs() {
            long total = evaluations.get();
            return total > 0 ? (double) totalTimeMs.get() / total : 0;
        }
    }

    /**
     * Metrics snapshot.
     */
    public static class Snapshot {
        public final long totalRequests;
        public final long successfulRequests;
        public final long failedRequests;
        public final double successRate;
        public final double errorRate;

        public final double avgLatencyMs;
        public final long minLatencyMs;
        public final long maxLatencyMs;
        public final long p50LatencyMs;
        public final long p95LatencyMs;
        public final long p99LatencyMs;

        public final long cacheHits;
        public final long cacheMisses;
        public final double cacheHitRate;

        public final Map<String, Long> errorsByCategory;

        public final long circuitOpens;
        public final long circuitCloses;
        public final CircuitBreaker.State circuitState;

        public final long totalEvaluations;
        public final Map<String, FlagStats> flagStats;

        public final long uptimeMs;
        public final long lastRequestAt;

        Snapshot(Metrics m) {
            this.totalRequests = m.totalRequests.get();
            this.successfulRequests = m.successfulRequests.get();
            this.failedRequests = m.failedRequests.get();
            this.successRate = totalRequests > 0 ? (double) successfulRequests / totalRequests * 100 : 0;
            this.errorRate = totalRequests > 0 ? (double) failedRequests / totalRequests * 100 : 0;

            List<Long> sortedLatencies;
            synchronized (m.latencies) {
                sortedLatencies = new ArrayList<>(m.latencies);
            }
            Collections.sort(sortedLatencies);

            this.avgLatencyMs = calculateAverage(sortedLatencies);
            this.minLatencyMs = sortedLatencies.isEmpty() ? 0 : sortedLatencies.get(0);
            this.maxLatencyMs = sortedLatencies.isEmpty() ? 0 : sortedLatencies.get(sortedLatencies.size() - 1);
            this.p50LatencyMs = calculatePercentile(sortedLatencies, 50);
            this.p95LatencyMs = calculatePercentile(sortedLatencies, 95);
            this.p99LatencyMs = calculatePercentile(sortedLatencies, 99);

            this.cacheHits = m.cacheHits.get();
            this.cacheMisses = m.cacheMisses.get();
            long totalCache = cacheHits + cacheMisses;
            this.cacheHitRate = totalCache > 0 ? (double) cacheHits / totalCache * 100 : 0;

            this.errorsByCategory = new HashMap<>();
            m.errorsByCategory.forEach((k, v) -> this.errorsByCategory.put(k, v.get()));

            this.circuitOpens = m.circuitOpens.get();
            this.circuitCloses = m.circuitCloses.get();
            this.circuitState = m.circuitState.get();

            this.totalEvaluations = m.totalEvaluations.get();
            this.flagStats = new HashMap<>(m.flagStats);

            this.uptimeMs = System.currentTimeMillis() - m.startTime;
            this.lastRequestAt = m.lastRequestAt.get();
        }

        private static double calculateAverage(List<Long> values) {
            if (values.isEmpty()) return 0;
            return values.stream().mapToLong(Long::longValue).average().orElse(0);
        }

        private static long calculatePercentile(List<Long> sortedValues, int percentile) {
            if (sortedValues.isEmpty()) return 0;
            int index = (int) Math.ceil((percentile / 100.0) * sortedValues.size()) - 1;
            return sortedValues.get(Math.max(0, index));
        }
    }

    /**
     * Record a completed request.
     */
    public void recordRequest(int statusCode, long latencyMs, boolean cacheHit, String errorCategory) {
        totalRequests.incrementAndGet();
        lastRequestAt.set(System.currentTimeMillis());

        boolean success = statusCode >= 200 && statusCode < 400;
        if (success) {
            successfulRequests.incrementAndGet();
        } else {
            failedRequests.incrementAndGet();
        }

        if (cacheHit) {
            cacheHits.incrementAndGet();
        } else {
            cacheMisses.incrementAndGet();
        }

        synchronized (latencies) {
            latencies.add(latencyMs);
            while (latencies.size() > MAX_LATENCY_HISTORY) {
                latencies.remove(0);
            }
        }

        if (errorCategory != null && !errorCategory.isEmpty()) {
            errorsByCategory.computeIfAbsent(errorCategory, k -> new AtomicLong(0)).incrementAndGet();
        }
    }

    /**
     * Record a flag evaluation.
     */
    public void recordEvaluation(String flagKey, boolean result, long evaluationTimeMs) {
        totalEvaluations.incrementAndGet();
        flagStats.computeIfAbsent(flagKey, k -> new FlagStats()).record(result, evaluationTimeMs);
    }

    /**
     * Record circuit breaker state change.
     */
    public void recordCircuitStateChange(CircuitBreaker.State newState) {
        CircuitBreaker.State oldState = circuitState.getAndSet(newState);
        if (newState == CircuitBreaker.State.OPEN && oldState != CircuitBreaker.State.OPEN) {
            circuitOpens.incrementAndGet();
        } else if (newState == CircuitBreaker.State.CLOSED && oldState != CircuitBreaker.State.CLOSED) {
            circuitCloses.incrementAndGet();
        }
    }

    /**
     * Get a snapshot of all metrics.
     */
    public Snapshot snapshot() {
        return new Snapshot(this);
    }

    /**
     * Export metrics in Prometheus format.
     */
    public String toPrometheus(String prefix) {
        if (prefix == null) prefix = "rollgate_sdk";

        Snapshot snap = snapshot();
        StringBuilder sb = new StringBuilder();

        appendMetric(sb, prefix, "requests_total", snap.totalRequests, "Total number of requests", "counter");
        appendMetric(sb, prefix, "requests_success_total", snap.successfulRequests, "Total successful requests", "counter");
        appendMetric(sb, prefix, "requests_failed_total", snap.failedRequests, "Total failed requests", "counter");

        appendMetric(sb, prefix, "latency_avg_ms", snap.avgLatencyMs, "Average request latency in milliseconds", "gauge");
        appendMetric(sb, prefix, "latency_p50_ms", snap.p50LatencyMs, "50th percentile latency", "gauge");
        appendMetric(sb, prefix, "latency_p95_ms", snap.p95LatencyMs, "95th percentile latency", "gauge");
        appendMetric(sb, prefix, "latency_p99_ms", snap.p99LatencyMs, "99th percentile latency", "gauge");

        appendMetric(sb, prefix, "cache_hits_total", snap.cacheHits, "Total cache hits", "counter");
        appendMetric(sb, prefix, "cache_misses_total", snap.cacheMisses, "Total cache misses", "counter");
        appendMetric(sb, prefix, "cache_hit_rate", snap.cacheHitRate, "Cache hit rate percentage", "gauge");

        appendMetric(sb, prefix, "circuit_opens_total", snap.circuitOpens, "Total circuit breaker opens", "counter");
        double circuitStateValue = snap.circuitState == CircuitBreaker.State.CLOSED ? 0 :
                                   snap.circuitState == CircuitBreaker.State.OPEN ? 1 : 0.5;
        appendMetric(sb, prefix, "circuit_state", circuitStateValue, "Circuit breaker state (0=closed, 0.5=half-open, 1=open)", "gauge");

        appendMetric(sb, prefix, "evaluations_total", snap.totalEvaluations, "Total flag evaluations", "counter");
        appendMetric(sb, prefix, "uptime_seconds", snap.uptimeMs / 1000.0, "SDK uptime in seconds", "gauge");

        return sb.toString();
    }

    private void appendMetric(StringBuilder sb, String prefix, String name, double value, String help, String type) {
        String fullName = prefix + "_" + name;
        sb.append("# HELP ").append(fullName).append(" ").append(help).append("\n");
        sb.append("# TYPE ").append(fullName).append(" ").append(type).append("\n");
        sb.append(fullName).append(" ").append(value).append("\n");
    }

    /**
     * Reset all metrics.
     */
    public void reset() {
        totalRequests.set(0);
        successfulRequests.set(0);
        failedRequests.set(0);
        cacheHits.set(0);
        cacheMisses.set(0);
        circuitOpens.set(0);
        circuitCloses.set(0);
        totalEvaluations.set(0);
        errorsByCategory.clear();
        flagStats.clear();
        synchronized (latencies) {
            latencies.clear();
        }
        circuitState.set(CircuitBreaker.State.CLOSED);
        lastRequestAt.set(0);
    }
}
