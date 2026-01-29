package rollgate

import (
	"strings"
	"testing"
)

func TestSDKMetrics_RecordRequest(t *testing.T) {
	m := NewSDKMetrics()

	m.RecordRequest(100, true, ErrorCategoryNone)
	m.RecordRequest(200, true, ErrorCategoryNone)
	m.RecordRequest(150, false, ErrorCategoryNetwork)

	snap := m.Snapshot()

	if snap.TotalRequests != 3 {
		t.Errorf("Expected 3 total requests, got %d", snap.TotalRequests)
	}

	if snap.SuccessfulRequests != 2 {
		t.Errorf("Expected 2 successful requests, got %d", snap.SuccessfulRequests)
	}

	if snap.FailedRequests != 1 {
		t.Errorf("Expected 1 failed request, got %d", snap.FailedRequests)
	}

	if snap.NetworkErrors != 1 {
		t.Errorf("Expected 1 network error, got %d", snap.NetworkErrors)
	}
}

func TestSDKMetrics_LatencyStats(t *testing.T) {
	m := NewSDKMetrics()

	m.RecordRequest(100, true, ErrorCategoryNone)
	m.RecordRequest(200, true, ErrorCategoryNone)
	m.RecordRequest(300, true, ErrorCategoryNone)

	snap := m.Snapshot()

	if snap.MinLatency != 100 {
		t.Errorf("Expected min latency 100, got %d", snap.MinLatency)
	}

	if snap.MaxLatency != 300 {
		t.Errorf("Expected max latency 300, got %d", snap.MaxLatency)
	}

	expectedAvg := 200.0
	if snap.AverageLatency != expectedAvg {
		t.Errorf("Expected average latency %.2f, got %.2f", expectedAvg, snap.AverageLatency)
	}
}

func TestSDKMetrics_CacheMetrics(t *testing.T) {
	m := NewSDKMetrics()

	m.RecordCacheHit(false)
	m.RecordCacheHit(false)
	m.RecordCacheHit(true) // stale
	m.RecordCacheMiss()

	snap := m.Snapshot()

	if snap.CacheHits != 2 {
		t.Errorf("Expected 2 cache hits, got %d", snap.CacheHits)
	}

	if snap.CacheStaleHits != 1 {
		t.Errorf("Expected 1 stale cache hit, got %d", snap.CacheStaleHits)
	}

	if snap.CacheMisses != 1 {
		t.Errorf("Expected 1 cache miss, got %d", snap.CacheMisses)
	}

	// Hit rate should be (2 + 1) / 4 = 0.75
	if snap.CacheHitRate < 0.74 || snap.CacheHitRate > 0.76 {
		t.Errorf("Expected cache hit rate ~0.75, got %.2f", snap.CacheHitRate)
	}
}

func TestSDKMetrics_CircuitBreaker(t *testing.T) {
	m := NewSDKMetrics()

	m.RecordCircuitStateChange(CircuitStateOpen)
	m.RecordCircuitStateChange(CircuitStateHalfOpen)
	m.RecordCircuitStateChange(CircuitStateClosed)
	m.RecordCircuitStateChange(CircuitStateOpen)

	snap := m.Snapshot()

	if snap.CircuitOpenCount != 2 {
		t.Errorf("Expected 2 circuit opens, got %d", snap.CircuitOpenCount)
	}

	if snap.CircuitHalfOpenCount != 1 {
		t.Errorf("Expected 1 half-open, got %d", snap.CircuitHalfOpenCount)
	}

	if snap.CircuitState != CircuitStateOpen {
		t.Errorf("Expected circuit state OPEN, got %v", snap.CircuitState)
	}
}

func TestSDKMetrics_Evaluations(t *testing.T) {
	m := NewSDKMetrics()

	m.RecordEvaluation(1000000)  // 1ms in nanoseconds
	m.RecordEvaluation(2000000)  // 2ms
	m.RecordEvaluation(3000000)  // 3ms

	snap := m.Snapshot()

	if snap.TotalEvaluations != 3 {
		t.Errorf("Expected 3 evaluations, got %d", snap.TotalEvaluations)
	}

	// Average should be 2ms
	if snap.EvaluationTimeAvgMs < 1.9 || snap.EvaluationTimeAvgMs > 2.1 {
		t.Errorf("Expected avg evaluation time ~2ms, got %.2f", snap.EvaluationTimeAvgMs)
	}
}

func TestSDKMetrics_ErrorCategories(t *testing.T) {
	m := NewSDKMetrics()

	m.RecordRequest(100, false, ErrorCategoryNetwork)
	m.RecordRequest(100, false, ErrorCategoryNetwork)
	m.RecordRequest(100, false, ErrorCategoryAuth)
	m.RecordRequest(100, false, ErrorCategoryRateLimit)
	m.RecordRequest(100, false, ErrorCategoryServer)
	m.RecordRequest(100, false, ErrorCategoryServer)
	m.RecordRequest(100, false, ErrorCategoryServer)

	snap := m.Snapshot()

	if snap.NetworkErrors != 2 {
		t.Errorf("Expected 2 network errors, got %d", snap.NetworkErrors)
	}
	if snap.AuthErrors != 1 {
		t.Errorf("Expected 1 auth error, got %d", snap.AuthErrors)
	}
	if snap.RateLimitErrors != 1 {
		t.Errorf("Expected 1 rate limit error, got %d", snap.RateLimitErrors)
	}
	if snap.ServerErrors != 3 {
		t.Errorf("Expected 3 server errors, got %d", snap.ServerErrors)
	}
}

func TestSDKMetrics_Reset(t *testing.T) {
	m := NewSDKMetrics()

	m.RecordRequest(100, true, ErrorCategoryNone)
	m.RecordCacheHit(false)
	m.RecordEvaluation(1000000)

	m.Reset()

	snap := m.Snapshot()

	if snap.TotalRequests != 0 {
		t.Error("Expected 0 requests after reset")
	}
	if snap.CacheHits != 0 {
		t.Error("Expected 0 cache hits after reset")
	}
	if snap.TotalEvaluations != 0 {
		t.Error("Expected 0 evaluations after reset")
	}
}

func TestSDKMetrics_ToPrometheus(t *testing.T) {
	m := NewSDKMetrics()

	m.RecordRequest(100, true, ErrorCategoryNone)
	m.RecordRequest(200, false, ErrorCategoryNetwork)
	m.RecordCacheHit(false)
	m.RecordEvaluation(1000000)

	output := m.ToPrometheus("rollgate_sdk")

	// Check that expected metrics are present
	expectedMetrics := []string{
		"rollgate_sdk_requests_total",
		"rollgate_sdk_requests_success_total",
		"rollgate_sdk_requests_failed_total",
		"rollgate_sdk_latency_avg_ms",
		"rollgate_sdk_cache_hits_total",
		"rollgate_sdk_circuit_state",
		"rollgate_sdk_evaluations_total",
	}

	for _, metric := range expectedMetrics {
		if !strings.Contains(output, metric) {
			t.Errorf("Expected metric %s in Prometheus output", metric)
		}
	}

	// Check for HELP and TYPE comments
	if !strings.Contains(output, "# HELP") {
		t.Error("Expected HELP comments in Prometheus output")
	}
	if !strings.Contains(output, "# TYPE") {
		t.Error("Expected TYPE comments in Prometheus output")
	}
}

func TestSDKMetrics_Percentiles(t *testing.T) {
	m := NewSDKMetrics()

	// Add 100 requests with latencies 1-100ms
	for i := 1; i <= 100; i++ {
		m.RecordRequest(int64(i), true, ErrorCategoryNone)
	}

	snap := m.Snapshot()

	// P50 should be around 50
	if snap.P50Latency < 45 || snap.P50Latency > 55 {
		t.Errorf("Expected P50 ~50, got %d", snap.P50Latency)
	}

	// P95 should be around 95
	if snap.P95Latency < 90 || snap.P95Latency > 100 {
		t.Errorf("Expected P95 ~95, got %d", snap.P95Latency)
	}

	// P99 should be around 99
	if snap.P99Latency < 95 || snap.P99Latency > 100 {
		t.Errorf("Expected P99 ~99, got %d", snap.P99Latency)
	}
}
