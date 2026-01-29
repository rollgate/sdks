package rollgate

import (
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
)

// MetricsSnapshot holds a snapshot of SDK metrics.
type MetricsSnapshot struct {
	// Request metrics
	TotalRequests    int64
	SuccessfulRequests int64
	FailedRequests   int64

	// Latency metrics (in milliseconds)
	AverageLatency float64
	MinLatency     int64
	MaxLatency     int64
	P50Latency     int64
	P95Latency     int64
	P99Latency     int64

	// Cache metrics
	CacheHits      int64
	CacheMisses    int64
	CacheStaleHits int64
	CacheHitRate   float64

	// Circuit breaker metrics
	CircuitState         CircuitState
	CircuitOpenCount     int64
	CircuitHalfOpenCount int64

	// Evaluation metrics
	TotalEvaluations int64
	EvaluationTimeAvgMs float64

	// Error breakdown
	NetworkErrors    int64
	AuthErrors       int64
	RateLimitErrors  int64
	ServerErrors     int64
}

// SDKMetrics collects metrics about SDK operations.
type SDKMetrics struct {
	mu sync.RWMutex

	// Request counters
	totalRequests     int64
	successfulRequests int64
	failedRequests    int64

	// Latency tracking
	latencies []int64

	// Cache metrics
	cacheHits      int64
	cacheMisses    int64
	cacheStaleHits int64

	// Circuit breaker
	circuitState         CircuitState
	circuitOpenCount     int64
	circuitHalfOpenCount int64

	// Evaluations
	totalEvaluations  int64
	evaluationTimeSum int64

	// Errors
	networkErrors   int64
	authErrors      int64
	rateLimitErrors int64
	serverErrors    int64
}

// NewSDKMetrics creates a new SDKMetrics instance.
func NewSDKMetrics() *SDKMetrics {
	return &SDKMetrics{
		latencies:    make([]int64, 0, 1000),
		circuitState: CircuitStateClosed,
	}
}

// RecordRequest records a request with its latency and success status.
func (m *SDKMetrics) RecordRequest(latencyMs int64, success bool, errCategory ErrorCategory) {
	atomic.AddInt64(&m.totalRequests, 1)

	if success {
		atomic.AddInt64(&m.successfulRequests, 1)
	} else {
		atomic.AddInt64(&m.failedRequests, 1)

		switch errCategory {
		case ErrorCategoryNetwork:
			atomic.AddInt64(&m.networkErrors, 1)
		case ErrorCategoryAuth:
			atomic.AddInt64(&m.authErrors, 1)
		case ErrorCategoryRateLimit:
			atomic.AddInt64(&m.rateLimitErrors, 1)
		case ErrorCategoryServer:
			atomic.AddInt64(&m.serverErrors, 1)
		}
	}

	m.mu.Lock()
	m.latencies = append(m.latencies, latencyMs)
	// Keep only last 1000 latencies
	if len(m.latencies) > 1000 {
		m.latencies = m.latencies[len(m.latencies)-1000:]
	}
	m.mu.Unlock()
}

// RecordCacheHit records a cache hit.
func (m *SDKMetrics) RecordCacheHit(stale bool) {
	if stale {
		atomic.AddInt64(&m.cacheStaleHits, 1)
	} else {
		atomic.AddInt64(&m.cacheHits, 1)
	}
}

// RecordCacheMiss records a cache miss.
func (m *SDKMetrics) RecordCacheMiss() {
	atomic.AddInt64(&m.cacheMisses, 1)
}

// RecordCircuitStateChange records a circuit breaker state change.
func (m *SDKMetrics) RecordCircuitStateChange(state CircuitState) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.circuitState = state
	switch state {
	case CircuitStateOpen:
		m.circuitOpenCount++
	case CircuitStateHalfOpen:
		m.circuitHalfOpenCount++
	}
}

// RecordEvaluation records a flag evaluation with its duration.
func (m *SDKMetrics) RecordEvaluation(durationNs int64) {
	atomic.AddInt64(&m.totalEvaluations, 1)
	atomic.AddInt64(&m.evaluationTimeSum, durationNs/1000000) // Convert to ms
}

// Snapshot returns a snapshot of all metrics.
func (m *SDKMetrics) Snapshot() MetricsSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	snapshot := MetricsSnapshot{
		TotalRequests:      atomic.LoadInt64(&m.totalRequests),
		SuccessfulRequests: atomic.LoadInt64(&m.successfulRequests),
		FailedRequests:     atomic.LoadInt64(&m.failedRequests),

		CacheHits:      atomic.LoadInt64(&m.cacheHits),
		CacheMisses:    atomic.LoadInt64(&m.cacheMisses),
		CacheStaleHits: atomic.LoadInt64(&m.cacheStaleHits),

		CircuitState:         m.circuitState,
		CircuitOpenCount:     m.circuitOpenCount,
		CircuitHalfOpenCount: m.circuitHalfOpenCount,

		TotalEvaluations: atomic.LoadInt64(&m.totalEvaluations),

		NetworkErrors:   atomic.LoadInt64(&m.networkErrors),
		AuthErrors:      atomic.LoadInt64(&m.authErrors),
		RateLimitErrors: atomic.LoadInt64(&m.rateLimitErrors),
		ServerErrors:    atomic.LoadInt64(&m.serverErrors),
	}

	// Calculate cache hit rate
	totalCacheOps := snapshot.CacheHits + snapshot.CacheMisses + snapshot.CacheStaleHits
	if totalCacheOps > 0 {
		snapshot.CacheHitRate = float64(snapshot.CacheHits+snapshot.CacheStaleHits) / float64(totalCacheOps)
	}

	// Calculate latency stats
	if len(m.latencies) > 0 {
		snapshot.MinLatency, snapshot.MaxLatency, snapshot.AverageLatency = m.calculateLatencyStats()
		snapshot.P50Latency = m.percentile(50)
		snapshot.P95Latency = m.percentile(95)
		snapshot.P99Latency = m.percentile(99)
	}

	// Calculate evaluation time average
	if snapshot.TotalEvaluations > 0 {
		snapshot.EvaluationTimeAvgMs = float64(atomic.LoadInt64(&m.evaluationTimeSum)) / float64(snapshot.TotalEvaluations)
	}

	return snapshot
}

func (m *SDKMetrics) calculateLatencyStats() (min, max int64, avg float64) {
	if len(m.latencies) == 0 {
		return 0, 0, 0
	}

	min = m.latencies[0]
	max = m.latencies[0]
	var sum int64

	for _, l := range m.latencies {
		if l < min {
			min = l
		}
		if l > max {
			max = l
		}
		sum += l
	}

	avg = float64(sum) / float64(len(m.latencies))
	return
}

func (m *SDKMetrics) percentile(p int) int64 {
	if len(m.latencies) == 0 {
		return 0
	}

	// Simple percentile calculation (not perfectly accurate but good enough)
	sorted := make([]int64, len(m.latencies))
	copy(sorted, m.latencies)

	// Simple bubble sort for small arrays
	for i := 0; i < len(sorted)-1; i++ {
		for j := 0; j < len(sorted)-i-1; j++ {
			if sorted[j] > sorted[j+1] {
				sorted[j], sorted[j+1] = sorted[j+1], sorted[j]
			}
		}
	}

	idx := (p * len(sorted)) / 100
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}

	return sorted[idx]
}

// Reset clears all metrics.
func (m *SDKMetrics) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()

	atomic.StoreInt64(&m.totalRequests, 0)
	atomic.StoreInt64(&m.successfulRequests, 0)
	atomic.StoreInt64(&m.failedRequests, 0)
	m.latencies = make([]int64, 0, 1000)
	atomic.StoreInt64(&m.cacheHits, 0)
	atomic.StoreInt64(&m.cacheMisses, 0)
	atomic.StoreInt64(&m.cacheStaleHits, 0)
	m.circuitOpenCount = 0
	m.circuitHalfOpenCount = 0
	atomic.StoreInt64(&m.totalEvaluations, 0)
	atomic.StoreInt64(&m.evaluationTimeSum, 0)
	atomic.StoreInt64(&m.networkErrors, 0)
	atomic.StoreInt64(&m.authErrors, 0)
	atomic.StoreInt64(&m.rateLimitErrors, 0)
	atomic.StoreInt64(&m.serverErrors, 0)
}

// ToPrometheus exports metrics in Prometheus text format.
func (m *SDKMetrics) ToPrometheus(prefix string) string {
	snap := m.Snapshot()
	var b strings.Builder

	metric := func(name string, value interface{}, help, mtype string) {
		fullName := prefix + "_" + name
		if help != "" {
			b.WriteString("# HELP ")
			b.WriteString(fullName)
			b.WriteString(" ")
			b.WriteString(help)
			b.WriteString("\n")
		}
		if mtype != "" {
			b.WriteString("# TYPE ")
			b.WriteString(fullName)
			b.WriteString(" ")
			b.WriteString(mtype)
			b.WriteString("\n")
		}
		b.WriteString(fullName)
		b.WriteString(" ")
		switch v := value.(type) {
		case int64:
			b.WriteString(strconv.FormatInt(v, 10))
		case float64:
			b.WriteString(strconv.FormatFloat(v, 'f', 2, 64))
		}
		b.WriteString("\n")
	}

	// Request metrics
	metric("requests_total", snap.TotalRequests, "Total number of requests", "counter")
	metric("requests_success_total", snap.SuccessfulRequests, "Total successful requests", "counter")
	metric("requests_failed_total", snap.FailedRequests, "Total failed requests", "counter")

	// Latency metrics
	metric("latency_avg_ms", snap.AverageLatency, "Average request latency in milliseconds", "gauge")
	metric("latency_p50_ms", snap.P50Latency, "50th percentile latency", "gauge")
	metric("latency_p95_ms", snap.P95Latency, "95th percentile latency", "gauge")
	metric("latency_p99_ms", snap.P99Latency, "99th percentile latency", "gauge")

	// Cache metrics
	metric("cache_hits_total", snap.CacheHits, "Total cache hits", "counter")
	metric("cache_misses_total", snap.CacheMisses, "Total cache misses", "counter")
	metric("cache_hit_rate", snap.CacheHitRate, "Cache hit rate percentage", "gauge")

	// Circuit breaker metrics
	metric("circuit_opens_total", snap.CircuitOpenCount, "Total circuit breaker opens", "counter")
	var circuitValue float64
	switch snap.CircuitState {
	case CircuitStateClosed:
		circuitValue = 0
	case CircuitStateOpen:
		circuitValue = 1
	case CircuitStateHalfOpen:
		circuitValue = 0.5
	}
	metric("circuit_state", circuitValue, "Circuit breaker state (0=closed, 0.5=half-open, 1=open)", "gauge")

	// Evaluation metrics
	metric("evaluations_total", snap.TotalEvaluations, "Total flag evaluations", "counter")
	metric("evaluation_avg_time_ms", snap.EvaluationTimeAvgMs, "Average evaluation time in milliseconds", "gauge")

	// Error metrics
	metric("errors_network_total", snap.NetworkErrors, "Total network errors", "counter")
	metric("errors_auth_total", snap.AuthErrors, "Total authentication errors", "counter")
	metric("errors_ratelimit_total", snap.RateLimitErrors, "Total rate limit errors", "counter")
	metric("errors_server_total", snap.ServerErrors, "Total server errors", "counter")

	return b.String()
}
