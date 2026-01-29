package rollgate

import (
	"sync"
)

// RequestDeduplicator prevents duplicate concurrent requests.
type RequestDeduplicator struct {
	mu       sync.Mutex
	inflight map[string]*inflightRequest
}

type inflightRequest struct {
	done   chan struct{}
	result any
	err    error
}

// NewRequestDeduplicator creates a new RequestDeduplicator.
func NewRequestDeduplicator() *RequestDeduplicator {
	return &RequestDeduplicator{
		inflight: make(map[string]*inflightRequest),
	}
}

// Dedupe ensures only one request with the given key runs at a time.
// Concurrent calls with the same key will wait for and share the result.
func (d *RequestDeduplicator) Dedupe(key string, fn func() (any, error)) (any, error) {
	d.mu.Lock()

	// Check if there's already an in-flight request
	if req, ok := d.inflight[key]; ok {
		d.mu.Unlock()
		// Wait for the in-flight request to complete
		<-req.done
		return req.result, req.err
	}

	// Create a new in-flight request
	req := &inflightRequest{
		done: make(chan struct{}),
	}
	d.inflight[key] = req
	d.mu.Unlock()

	// Execute the function
	result, err := fn()

	// Store the result
	req.result = result
	req.err = err

	// Signal completion
	close(req.done)

	// Clean up
	d.mu.Lock()
	delete(d.inflight, key)
	d.mu.Unlock()

	return result, err
}

// IsInflight returns true if there's an in-flight request for the key.
func (d *RequestDeduplicator) IsInflight(key string) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	_, ok := d.inflight[key]
	return ok
}

// Clear removes all in-flight tracking (does not cancel requests).
func (d *RequestDeduplicator) Clear() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.inflight = make(map[string]*inflightRequest)
}
