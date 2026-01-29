package io.rollgate;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

class MetricsTest {

    private Metrics metrics;

    @BeforeEach
    void setUp() {
        metrics = new Metrics();
    }

    @Test
    void testRecordRequestSuccess() {
        metrics.recordRequest(200, 50L, false, null);

        Metrics.Snapshot snap = metrics.snapshot();
        assertEquals(1, snap.totalRequests);
        assertEquals(1, snap.successfulRequests);
        assertEquals(0, snap.failedRequests);
    }

    @Test
    void testRecordRequestFailure() {
        metrics.recordRequest(500, 100L, false, "SERVER");

        Metrics.Snapshot snap = metrics.snapshot();
        assertEquals(1, snap.totalRequests);
        assertEquals(0, snap.successfulRequests);
        assertEquals(1, snap.failedRequests);
        assertEquals(1, snap.errorsByCategory.getOrDefault("SERVER", 0L).longValue());
    }

    @Test
    void testLatencyStats() {
        metrics.recordRequest(200, 100L, false, null);
        metrics.recordRequest(200, 200L, false, null);
        metrics.recordRequest(200, 300L, false, null);

        Metrics.Snapshot snap = metrics.snapshot();
        assertEquals(100, snap.minLatencyMs);
        assertEquals(300, snap.maxLatencyMs);
        assertEquals(200.0, snap.avgLatencyMs, 0.1);
    }

    @Test
    void testCacheMetrics() {
        metrics.recordRequest(200, 10L, true, null);  // cache hit
        metrics.recordRequest(200, 10L, true, null);  // cache hit
        metrics.recordRequest(200, 50L, false, null); // cache miss

        Metrics.Snapshot snap = metrics.snapshot();
        assertEquals(2, snap.cacheHits);
        assertEquals(1, snap.cacheMisses);
        assertEquals(66.6, snap.cacheHitRate, 1.0);
    }

    @Test
    void testCircuitBreakerMetrics() {
        metrics.recordCircuitStateChange(CircuitBreaker.State.OPEN);
        metrics.recordCircuitStateChange(CircuitBreaker.State.HALF_OPEN);
        metrics.recordCircuitStateChange(CircuitBreaker.State.CLOSED);
        metrics.recordCircuitStateChange(CircuitBreaker.State.OPEN);

        Metrics.Snapshot snap = metrics.snapshot();
        assertEquals(2, snap.circuitOpens);
        assertEquals(1, snap.circuitCloses);
        assertEquals(CircuitBreaker.State.OPEN, snap.circuitState);
    }

    @Test
    void testEvaluationMetrics() {
        metrics.recordEvaluation("flag-1", true, 1L);
        metrics.recordEvaluation("flag-1", true, 2L);
        metrics.recordEvaluation("flag-1", false, 1L);
        metrics.recordEvaluation("flag-2", true, 1L);

        Metrics.Snapshot snap = metrics.snapshot();
        assertEquals(4, snap.totalEvaluations);

        Metrics.FlagStats flagStats = snap.flagStats.get("flag-1");
        assertNotNull(flagStats);
        assertEquals(3, flagStats.getEvaluations());
        assertEquals(2, flagStats.getTrueCount());
        assertEquals(1, flagStats.getFalseCount());
    }

    @Test
    void testToPrometheus() {
        metrics.recordRequest(200, 50L, false, null);
        metrics.recordEvaluation("flag-1", true, 1L);

        String output = metrics.toPrometheus("rollgate_sdk");

        assertTrue(output.contains("rollgate_sdk_requests_total"));
        assertTrue(output.contains("rollgate_sdk_evaluations_total"));
        assertTrue(output.contains("# HELP"));
        assertTrue(output.contains("# TYPE"));
    }

    @Test
    void testReset() {
        metrics.recordRequest(200, 50L, false, null);
        metrics.recordEvaluation("flag-1", true, 1L);

        metrics.reset();

        Metrics.Snapshot snap = metrics.snapshot();
        assertEquals(0, snap.totalRequests);
        assertEquals(0, snap.totalEvaluations);
    }

    @Test
    void testSuccessErrorRates() {
        for (int i = 0; i < 7; i++) {
            metrics.recordRequest(200, 10L, false, null);
        }
        for (int i = 0; i < 3; i++) {
            metrics.recordRequest(500, 10L, false, "SERVER");
        }

        Metrics.Snapshot snap = metrics.snapshot();
        assertEquals(70.0, snap.successRate, 0.1);
        assertEquals(30.0, snap.errorRate, 0.1);
    }
}
