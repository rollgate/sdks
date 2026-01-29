package rollgate

import (
	"sync"
	"time"
)

// CircuitState represents the state of the circuit breaker.
type CircuitState string

const (
	CircuitStateClosed   CircuitState = "closed"
	CircuitStateOpen     CircuitState = "open"
	CircuitStateHalfOpen CircuitState = "half_open"
)

// CircuitBreaker implements the circuit breaker pattern.
type CircuitBreaker struct {
	mu sync.RWMutex

	config           CircuitBreakerConfig
	state            CircuitState
	failures         []time.Time
	lastFailureTime  time.Time
	openedAt         time.Time
	halfOpenSuccesses int

	// Callbacks for state changes
	onStateChange func(from, to CircuitState)
}

// CircuitBreakerStats holds statistics about the circuit breaker.
type CircuitBreakerStats struct {
	State             CircuitState
	Failures          int
	LastFailureTime   time.Time
	HalfOpenSuccesses int
}

// NewCircuitBreaker creates a new circuit breaker with the given config.
func NewCircuitBreaker(config CircuitBreakerConfig) *CircuitBreaker {
	return &CircuitBreaker{
		config:   config,
		state:    CircuitStateClosed,
		failures: make([]time.Time, 0),
	}
}

// Execute runs the given function through the circuit breaker.
func (cb *CircuitBreaker) Execute(fn func() error) error {
	if !cb.IsAllowingRequests() {
		return ErrCircuitOpen
	}

	cb.mu.Lock()
	if cb.state == CircuitStateOpen {
		// Transition to half-open for this test request
		cb.transitionTo(CircuitStateHalfOpen)
	}
	cb.mu.Unlock()

	err := fn()

	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		cb.recordFailure()
		return err
	}

	cb.recordSuccess()
	return nil
}

// IsAllowingRequests returns true if requests are allowed.
func (cb *CircuitBreaker) IsAllowingRequests() bool {
	cb.mu.RLock()
	defer cb.mu.RUnlock()

	switch cb.state {
	case CircuitStateClosed:
		return true
	case CircuitStateHalfOpen:
		return true
	case CircuitStateOpen:
		// Check if recovery timeout has passed
		if time.Since(cb.openedAt) >= cb.config.RecoveryTimeout {
			return true
		}
		return false
	}
	return true
}

// GetState returns the current circuit state.
func (cb *CircuitBreaker) GetState() CircuitState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

// GetStats returns current statistics.
func (cb *CircuitBreaker) GetStats() CircuitBreakerStats {
	cb.mu.RLock()
	defer cb.mu.RUnlock()

	return CircuitBreakerStats{
		State:             cb.state,
		Failures:          cb.countRecentFailures(),
		LastFailureTime:   cb.lastFailureTime,
		HalfOpenSuccesses: cb.halfOpenSuccesses,
	}
}

// ForceOpen forces the circuit to open state.
func (cb *CircuitBreaker) ForceOpen() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.transitionTo(CircuitStateOpen)
}

// ForceReset resets the circuit to closed state.
func (cb *CircuitBreaker) ForceReset() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failures = make([]time.Time, 0)
	cb.halfOpenSuccesses = 0
	cb.transitionTo(CircuitStateClosed)
}

// OnStateChange sets a callback for state changes.
func (cb *CircuitBreaker) OnStateChange(fn func(from, to CircuitState)) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.onStateChange = fn
}

func (cb *CircuitBreaker) recordFailure() {
	now := time.Now()
	cb.failures = append(cb.failures, now)
	cb.lastFailureTime = now

	// Clean old failures outside monitoring window
	cb.cleanOldFailures()

	if cb.state == CircuitStateHalfOpen {
		// Any failure in half-open goes back to open
		cb.transitionTo(CircuitStateOpen)
		return
	}

	// Check if we should open the circuit
	if cb.countRecentFailures() >= cb.config.FailureThreshold {
		cb.transitionTo(CircuitStateOpen)
	}
}

func (cb *CircuitBreaker) recordSuccess() {
	if cb.state == CircuitStateHalfOpen {
		cb.halfOpenSuccesses++
		if cb.halfOpenSuccesses >= cb.config.SuccessThreshold {
			cb.transitionTo(CircuitStateClosed)
		}
	}
}

func (cb *CircuitBreaker) transitionTo(newState CircuitState) {
	if cb.state == newState {
		return
	}

	oldState := cb.state
	cb.state = newState

	if newState == CircuitStateOpen {
		cb.openedAt = time.Now()
	}

	if newState == CircuitStateClosed {
		cb.failures = make([]time.Time, 0)
		cb.halfOpenSuccesses = 0
	}

	if newState == CircuitStateHalfOpen {
		cb.halfOpenSuccesses = 0
	}

	if cb.onStateChange != nil {
		cb.onStateChange(oldState, newState)
	}
}

func (cb *CircuitBreaker) cleanOldFailures() {
	cutoff := time.Now().Add(-cb.config.MonitoringWindow)
	newFailures := make([]time.Time, 0, len(cb.failures))

	for _, f := range cb.failures {
		if f.After(cutoff) {
			newFailures = append(newFailures, f)
		}
	}

	cb.failures = newFailures
}

func (cb *CircuitBreaker) countRecentFailures() int {
	cutoff := time.Now().Add(-cb.config.MonitoringWindow)
	count := 0

	for _, f := range cb.failures {
		if f.After(cutoff) {
			count++
		}
	}

	return count
}
