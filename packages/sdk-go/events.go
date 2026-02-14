package rollgate

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// TrackEventOptions holds the data for a conversion event.
type TrackEventOptions struct {
	FlagKey     string         `json:"flagKey"`
	EventName   string         `json:"eventName"`
	UserID      string         `json:"userId"`
	VariationID string         `json:"variationId,omitempty"`
	Value       *float64       `json:"value,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// EventCollectorConfig configures the event collector.
type EventCollectorConfig struct {
	FlushIntervalMs int
	MaxBufferSize   int
	Enabled         bool
}

// DefaultEventCollectorConfig returns default event collector configuration.
func DefaultEventCollectorConfig() EventCollectorConfig {
	return EventCollectorConfig{
		FlushIntervalMs: 30000,
		MaxBufferSize:   100,
		Enabled:         true,
	}
}

type bufferedEvent struct {
	FlagKey     string         `json:"flagKey"`
	EventName   string         `json:"eventName"`
	UserID      string         `json:"userId"`
	VariationID string         `json:"variationId,omitempty"`
	Value       *float64       `json:"value,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	Timestamp   string         `json:"timestamp"`
}

// EventCollector buffers and batches conversion events.
type EventCollector struct {
	mu       sync.Mutex
	config   EventCollectorConfig
	endpoint string
	apiKey   string
	client   *http.Client
	buffer   []bufferedEvent
	stop     chan struct{}
	stopped  bool
}

// NewEventCollector creates a new event collector.
func NewEventCollector(endpoint, apiKey string, config EventCollectorConfig, httpClient *http.Client) *EventCollector {
	return &EventCollector{
		config:   config,
		endpoint: endpoint,
		apiKey:   apiKey,
		client:   httpClient,
		buffer:   make([]bufferedEvent, 0, config.MaxBufferSize),
		stop:     make(chan struct{}),
	}
}

// Start begins the periodic flush goroutine.
func (ec *EventCollector) Start() {
	if !ec.config.Enabled {
		return
	}
	go ec.flushLoop()
}

// Stop flushes remaining events and stops the collector.
func (ec *EventCollector) Stop() {
	ec.mu.Lock()
	if ec.stopped {
		ec.mu.Unlock()
		return
	}
	ec.stopped = true
	ec.mu.Unlock()

	close(ec.stop)
	// Best-effort final flush
	_ = ec.Flush()
}

// Track adds an event to the buffer.
func (ec *EventCollector) Track(opts TrackEventOptions) {
	if !ec.config.Enabled {
		return
	}

	event := bufferedEvent{
		FlagKey:     opts.FlagKey,
		EventName:   opts.EventName,
		UserID:      opts.UserID,
		VariationID: opts.VariationID,
		Value:       opts.Value,
		Metadata:    opts.Metadata,
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
	}

	ec.mu.Lock()
	ec.buffer = append(ec.buffer, event)
	shouldFlush := len(ec.buffer) >= ec.config.MaxBufferSize
	ec.mu.Unlock()

	if shouldFlush {
		go func() { _ = ec.Flush() }()
	}
}

// Flush sends all buffered events to the server.
func (ec *EventCollector) Flush() error {
	ec.mu.Lock()
	if len(ec.buffer) == 0 {
		ec.mu.Unlock()
		return nil
	}
	events := ec.buffer
	ec.buffer = make([]bufferedEvent, 0, ec.config.MaxBufferSize)
	ec.mu.Unlock()

	payload := map[string]any{"events": events}
	body, err := json.Marshal(payload)
	if err != nil {
		// Re-buffer on marshal error
		ec.reBuffer(events)
		return fmt.Errorf("failed to marshal events: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ec.endpoint, bytes.NewReader(body))
	if err != nil {
		ec.reBuffer(events)
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+ec.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := ec.client.Do(req)
	if err != nil {
		ec.reBuffer(events)
		return fmt.Errorf("failed to send events: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		ec.reBuffer(events)
		return fmt.Errorf("event flush failed with status %d", resp.StatusCode)
	}

	return nil
}

// GetBufferSize returns the current number of buffered events.
func (ec *EventCollector) GetBufferSize() int {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	return len(ec.buffer)
}

func (ec *EventCollector) reBuffer(events []bufferedEvent) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	// Prepend failed events, but respect max buffer size
	combined := append(events, ec.buffer...)
	if len(combined) > ec.config.MaxBufferSize*2 {
		combined = combined[len(combined)-ec.config.MaxBufferSize*2:]
	}
	ec.buffer = combined
}

func (ec *EventCollector) flushLoop() {
	ticker := time.NewTicker(time.Duration(ec.config.FlushIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ec.stop:
			return
		case <-ticker.C:
			_ = ec.Flush()
		}
	}
}
