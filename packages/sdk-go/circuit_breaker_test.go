package rollgate

import (
	"errors"
	"testing"
	"time"
)

func TestCircuitBreaker_InitialState(t *testing.T) {
	cb := NewCircuitBreaker(DefaultCircuitBreakerConfig())

	if cb.GetState() != CircuitStateClosed {
		t.Errorf("expected initial state to be closed, got %s", cb.GetState())
	}

	if !cb.IsAllowingRequests() {
		t.Error("expected to allow requests initially")
	}

	stats := cb.GetStats()
	if stats.Failures != 0 {
		t.Errorf("expected 0 failures, got %d", stats.Failures)
	}
}

func TestCircuitBreaker_Execute(t *testing.T) {
	t.Run("should pass through successful requests", func(t *testing.T) {
		cb := NewCircuitBreaker(DefaultCircuitBreakerConfig())
		called := false

		err := cb.Execute(func() error {
			called = true
			return nil
		})

		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}
		if !called {
			t.Error("expected function to be called")
		}
		if cb.GetState() != CircuitStateClosed {
			t.Error("expected state to remain closed")
		}
	})

	t.Run("should pass through and rethrow errors", func(t *testing.T) {
		cb := NewCircuitBreaker(DefaultCircuitBreakerConfig())
		expectedErr := errors.New("test error")

		err := cb.Execute(func() error {
			return expectedErr
		})

		if err != expectedErr {
			t.Errorf("expected error %v, got %v", expectedErr, err)
		}
	})

	t.Run("should track failures", func(t *testing.T) {
		cb := NewCircuitBreaker(DefaultCircuitBreakerConfig())

		_ = cb.Execute(func() error {
			return errors.New("failure")
		})

		stats := cb.GetStats()
		if stats.Failures != 1 {
			t.Errorf("expected 1 failure, got %d", stats.Failures)
		}
	})
}

func TestCircuitBreaker_Opening(t *testing.T) {
	t.Run("should open after reaching failure threshold", func(t *testing.T) {
		config := DefaultCircuitBreakerConfig()
		config.FailureThreshold = 3
		cb := NewCircuitBreaker(config)

		for i := 0; i < 3; i++ {
			_ = cb.Execute(func() error {
				return errors.New("failure")
			})
		}

		if cb.GetState() != CircuitStateOpen {
			t.Errorf("expected state to be open, got %s", cb.GetState())
		}
	})

	t.Run("should throw CircuitOpenError when open", func(t *testing.T) {
		config := DefaultCircuitBreakerConfig()
		config.FailureThreshold = 1
		config.RecoveryTimeout = 1 * time.Hour
		cb := NewCircuitBreaker(config)

		_ = cb.Execute(func() error {
			return errors.New("failure")
		})

		if cb.GetState() != CircuitStateOpen {
			t.Errorf("expected state to be open, got %s", cb.GetState())
		}

		err := cb.Execute(func() error {
			return nil
		})

		if err != ErrCircuitOpen {
			t.Errorf("expected ErrCircuitOpen, got %v", err)
		}
	})
}

func TestCircuitBreaker_MonitoringWindow(t *testing.T) {
	config := DefaultCircuitBreakerConfig()
	config.FailureThreshold = 3
	config.MonitoringWindow = 50 * time.Millisecond
	cb := NewCircuitBreaker(config)

	// First failure
	_ = cb.Execute(func() error {
		return errors.New("failure")
	})

	stats := cb.GetStats()
	if stats.Failures != 1 {
		t.Errorf("expected 1 failure, got %d", stats.Failures)
	}

	// Wait for monitoring window to expire
	time.Sleep(60 * time.Millisecond)

	// Second failure (first should be expired)
	_ = cb.Execute(func() error {
		return errors.New("failure")
	})

	stats = cb.GetStats()
	if stats.Failures != 1 {
		t.Errorf("expected 1 failure after window expiry, got %d", stats.Failures)
	}

	// Circuit should still be closed
	if cb.GetState() != CircuitStateClosed {
		t.Error("expected state to remain closed")
	}
}

func TestCircuitBreaker_Recovery(t *testing.T) {
	t.Run("should transition to half-open after recovery timeout", func(t *testing.T) {
		config := DefaultCircuitBreakerConfig()
		config.FailureThreshold = 1
		config.RecoveryTimeout = 20 * time.Millisecond
		cb := NewCircuitBreaker(config)

		_ = cb.Execute(func() error {
			return errors.New("failure")
		})

		if cb.GetState() != CircuitStateOpen {
			t.Error("expected state to be open")
		}

		// Wait for recovery timeout
		time.Sleep(25 * time.Millisecond)

		if !cb.IsAllowingRequests() {
			t.Error("expected to allow requests after recovery timeout")
		}
	})

	t.Run("should close circuit after success in half-open", func(t *testing.T) {
		config := DefaultCircuitBreakerConfig()
		config.FailureThreshold = 1
		config.RecoveryTimeout = 10 * time.Millisecond
		config.SuccessThreshold = 1
		cb := NewCircuitBreaker(config)

		_ = cb.Execute(func() error {
			return errors.New("failure")
		})

		time.Sleep(15 * time.Millisecond)

		err := cb.Execute(func() error {
			return nil
		})

		if err != nil {
			t.Errorf("expected no error, got %v", err)
		}
		if cb.GetState() != CircuitStateClosed {
			t.Errorf("expected state to be closed, got %s", cb.GetState())
		}
	})

	t.Run("should reopen on failure in half-open", func(t *testing.T) {
		config := DefaultCircuitBreakerConfig()
		config.FailureThreshold = 1
		config.RecoveryTimeout = 10 * time.Millisecond
		config.SuccessThreshold = 3
		cb := NewCircuitBreaker(config)

		_ = cb.Execute(func() error {
			return errors.New("failure")
		})

		time.Sleep(15 * time.Millisecond)

		_ = cb.Execute(func() error {
			return errors.New("failure again")
		})

		if cb.GetState() != CircuitStateOpen {
			t.Errorf("expected state to be open, got %s", cb.GetState())
		}
	})
}

func TestCircuitBreaker_ForceReset(t *testing.T) {
	config := DefaultCircuitBreakerConfig()
	config.FailureThreshold = 1
	cb := NewCircuitBreaker(config)

	_ = cb.Execute(func() error {
		return errors.New("failure")
	})

	if cb.GetState() != CircuitStateOpen {
		t.Error("expected state to be open")
	}

	cb.ForceReset()

	if cb.GetState() != CircuitStateClosed {
		t.Errorf("expected state to be closed after reset, got %s", cb.GetState())
	}

	stats := cb.GetStats()
	if stats.Failures != 0 {
		t.Errorf("expected 0 failures after reset, got %d", stats.Failures)
	}
}

func TestCircuitBreaker_ForceOpen(t *testing.T) {
	cb := NewCircuitBreaker(DefaultCircuitBreakerConfig())

	cb.ForceOpen()

	if cb.GetState() != CircuitStateOpen {
		t.Errorf("expected state to be open, got %s", cb.GetState())
	}
}

func TestCircuitBreaker_StateChangeCallback(t *testing.T) {
	config := DefaultCircuitBreakerConfig()
	config.FailureThreshold = 1
	cb := NewCircuitBreaker(config)

	var fromState, toState CircuitState
	cb.OnStateChange(func(from, to CircuitState) {
		fromState = from
		toState = to
	})

	_ = cb.Execute(func() error {
		return errors.New("failure")
	})

	if fromState != CircuitStateClosed {
		t.Errorf("expected from state to be closed, got %s", fromState)
	}
	if toState != CircuitStateOpen {
		t.Errorf("expected to state to be open, got %s", toState)
	}
}
