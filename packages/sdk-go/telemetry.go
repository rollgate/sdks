package rollgate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// TelemetryConfig holds configuration for telemetry collection.
type TelemetryConfig struct {
	// FlushIntervalMs is the interval between automatic flushes (default: 60000ms)
	FlushIntervalMs int

	// MaxBufferSize is the maximum evaluations to buffer before forcing a flush (default: 1000)
	MaxBufferSize int

	// Enabled controls whether telemetry collection is active (default: true)
	Enabled bool
}

// DefaultTelemetryConfig returns default telemetry settings.
func DefaultTelemetryConfig() TelemetryConfig {
	return TelemetryConfig{
		FlushIntervalMs: 60000,
		MaxBufferSize:   1000,
		Enabled:         true,
	}
}

// TelemetryEvalStats tracks evaluation statistics for a single flag.
type TelemetryEvalStats struct {
	Total int `json:"total"`
	True  int `json:"true"`
	False int `json:"false"`
}

type telemetryPayload struct {
	Evaluations map[string]TelemetryEvalStats `json:"evaluations"`
	PeriodMs    int64                         `json:"period_ms"`
}

// TelemetryCollector tracks flag evaluations and sends them to the server in batches.
type TelemetryCollector struct {
	mu            sync.Mutex
	config        TelemetryConfig
	endpoint      string
	apiKey        string
	httpClient    *http.Client
	evaluations   map[string]*TelemetryEvalStats
	totalBuffered int
	lastFlushTime time.Time
	isFlushing    bool
	stopCh        chan struct{}
	stopped       bool
}

// NewTelemetryCollector creates a new telemetry collector.
func NewTelemetryCollector(endpoint, apiKey string, config TelemetryConfig, httpClient *http.Client) *TelemetryCollector {
	return &TelemetryCollector{
		config:        config,
		endpoint:      endpoint,
		apiKey:        apiKey,
		httpClient:    httpClient,
		evaluations:   make(map[string]*TelemetryEvalStats),
		lastFlushTime: time.Now(),
		stopCh:        make(chan struct{}),
	}
}

// Start begins periodic flushing.
func (tc *TelemetryCollector) Start() {
	if !tc.config.Enabled || tc.endpoint == "" || tc.apiKey == "" {
		return
	}

	interval := time.Duration(tc.config.FlushIntervalMs) * time.Millisecond
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-tc.stopCh:
				return
			case <-ticker.C:
				_ = tc.Flush()
			}
		}
	}()
}

// Stop stops the telemetry collector and performs a final flush.
func (tc *TelemetryCollector) Stop() {
	tc.mu.Lock()
	if tc.stopped {
		tc.mu.Unlock()
		return
	}
	tc.stopped = true
	tc.mu.Unlock()

	close(tc.stopCh)
	_ = tc.Flush()
}

// RecordEvaluation records a single flag evaluation.
func (tc *TelemetryCollector) RecordEvaluation(flagKey string, result bool) {
	if !tc.config.Enabled {
		return
	}

	tc.mu.Lock()
	stats, ok := tc.evaluations[flagKey]
	if !ok {
		stats = &TelemetryEvalStats{}
		tc.evaluations[flagKey] = stats
	}

	stats.Total++
	if result {
		stats.True++
	} else {
		stats.False++
	}
	tc.totalBuffered++
	shouldFlush := tc.totalBuffered >= tc.config.MaxBufferSize
	tc.mu.Unlock()

	if shouldFlush {
		_ = tc.Flush()
	}
}

// Flush sends buffered evaluations to the server.
func (tc *TelemetryCollector) Flush() error {
	tc.mu.Lock()
	if tc.isFlushing || len(tc.evaluations) == 0 {
		tc.mu.Unlock()
		return nil
	}
	if tc.endpoint == "" || tc.apiKey == "" {
		tc.mu.Unlock()
		return nil
	}

	tc.isFlushing = true

	// Capture current data and reset buffer
	evaluationsToSend := make(map[string]TelemetryEvalStats, len(tc.evaluations))
	for key, stats := range tc.evaluations {
		evaluationsToSend[key] = *stats
	}
	periodMs := time.Since(tc.lastFlushTime).Milliseconds()
	tc.evaluations = make(map[string]*TelemetryEvalStats)
	tc.totalBuffered = 0
	tc.lastFlushTime = time.Now()
	tc.mu.Unlock()

	payload := telemetryPayload{
		Evaluations: evaluationsToSend,
		PeriodMs:    periodMs,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		tc.restoreBuffer(evaluationsToSend)
		tc.mu.Lock()
		tc.isFlushing = false
		tc.mu.Unlock()
		return fmt.Errorf("marshal telemetry: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, tc.endpoint, bytes.NewReader(body))
	if err != nil {
		tc.restoreBuffer(evaluationsToSend)
		tc.mu.Lock()
		tc.isFlushing = false
		tc.mu.Unlock()
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tc.apiKey)

	resp, err := tc.httpClient.Do(req)
	if err != nil {
		tc.restoreBuffer(evaluationsToSend)
		tc.mu.Lock()
		tc.isFlushing = false
		tc.mu.Unlock()
		return fmt.Errorf("send telemetry: %w", err)
	}
	defer resp.Body.Close()

	tc.mu.Lock()
	tc.isFlushing = false
	tc.mu.Unlock()

	if resp.StatusCode != http.StatusOK {
		tc.restoreBuffer(evaluationsToSend)
		return fmt.Errorf("telemetry request failed: %d", resp.StatusCode)
	}

	return nil
}

// GetBufferStats returns current buffer statistics.
func (tc *TelemetryCollector) GetBufferStats() (flagCount, evaluationCount int) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	return len(tc.evaluations), tc.totalBuffered
}

func (tc *TelemetryCollector) restoreBuffer(data map[string]TelemetryEvalStats) {
	tc.mu.Lock()
	defer tc.mu.Unlock()
	for key, stats := range data {
		existing, ok := tc.evaluations[key]
		if ok {
			existing.Total += stats.Total
			existing.True += stats.True
			existing.False += stats.False
		} else {
			s := stats
			tc.evaluations[key] = &s
		}
		tc.totalBuffered += stats.Total
	}
}
