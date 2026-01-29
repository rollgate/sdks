package rollgate

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRetryConfig_Defaults(t *testing.T) {
	config := DefaultRetryConfig()

	if config.MaxRetries != 3 {
		t.Errorf("expected MaxRetries 3, got %d", config.MaxRetries)
	}
	if config.BaseDelay != 100*time.Millisecond {
		t.Errorf("expected BaseDelay 100ms, got %v", config.BaseDelay)
	}
	if config.MaxDelay != 10*time.Second {
		t.Errorf("expected MaxDelay 10s, got %v", config.MaxDelay)
	}
	if config.JitterFactor != 0.1 {
		t.Errorf("expected JitterFactor 0.1, got %f", config.JitterFactor)
	}
}

func TestCalculateBackoff(t *testing.T) {
	config := RetryConfig{
		MaxRetries:   3,
		BaseDelay:    100 * time.Millisecond,
		MaxDelay:     10 * time.Second,
		JitterFactor: 0,
	}

	t.Run("should calculate exponential backoff", func(t *testing.T) {
		// 100ms * 2^0 = 100ms
		if CalculateBackoff(0, config) != 100*time.Millisecond {
			t.Errorf("expected 100ms, got %v", CalculateBackoff(0, config))
		}
		// 100ms * 2^1 = 200ms
		if CalculateBackoff(1, config) != 200*time.Millisecond {
			t.Errorf("expected 200ms, got %v", CalculateBackoff(1, config))
		}
		// 100ms * 2^2 = 400ms
		if CalculateBackoff(2, config) != 400*time.Millisecond {
			t.Errorf("expected 400ms, got %v", CalculateBackoff(2, config))
		}
	})

	t.Run("should cap at maxDelay", func(t *testing.T) {
		shortConfig := config
		shortConfig.MaxDelay = 300 * time.Millisecond

		delay := CalculateBackoff(2, shortConfig)
		if delay != 300*time.Millisecond {
			t.Errorf("expected 300ms (capped), got %v", delay)
		}
	})

	t.Run("should add jitter", func(t *testing.T) {
		jitterConfig := config
		jitterConfig.JitterFactor = 0.5

		results := make(map[time.Duration]bool)
		for i := 0; i < 20; i++ {
			results[CalculateBackoff(0, jitterConfig)] = true
		}

		if len(results) < 2 {
			t.Error("expected jitter to produce different values")
		}
	})
}

func TestRetryer_Do(t *testing.T) {
	t.Run("should succeed on first attempt", func(t *testing.T) {
		retryer := NewRetryer(DefaultRetryConfig())
		callCount := 0

		result := retryer.Do(context.Background(), func() error {
			callCount++
			return nil
		})

		if !result.Success {
			t.Error("expected success")
		}
		if result.Attempts != 1 {
			t.Errorf("expected 1 attempt, got %d", result.Attempts)
		}
		if callCount != 1 {
			t.Errorf("expected function called once, got %d", callCount)
		}
	})

	t.Run("should retry on retryable error", func(t *testing.T) {
		config := RetryConfig{
			MaxRetries:   3,
			BaseDelay:    1 * time.Millisecond,
			MaxDelay:     10 * time.Millisecond,
			JitterFactor: 0,
		}
		retryer := NewRetryer(config)
		callCount := 0

		result := retryer.Do(context.Background(), func() error {
			callCount++
			if callCount < 3 {
				return errors.New("503 Service Unavailable")
			}
			return nil
		})

		if !result.Success {
			t.Errorf("expected success, got error: %v", result.Error)
		}
		if result.Attempts != 3 {
			t.Errorf("expected 3 attempts, got %d", result.Attempts)
		}
	})

	t.Run("should not retry on non-retryable error", func(t *testing.T) {
		retryer := NewRetryer(DefaultRetryConfig())
		callCount := 0

		result := retryer.Do(context.Background(), func() error {
			callCount++
			return errors.New("401 Unauthorized")
		})

		if result.Success {
			t.Error("expected failure")
		}
		if result.Attempts != 1 {
			t.Errorf("expected 1 attempt, got %d", result.Attempts)
		}
		if callCount != 1 {
			t.Errorf("expected function called once, got %d", callCount)
		}
	})

	t.Run("should exhaust retries", func(t *testing.T) {
		config := RetryConfig{
			MaxRetries:   2,
			BaseDelay:    1 * time.Millisecond,
			MaxDelay:     10 * time.Millisecond,
			JitterFactor: 0,
		}
		retryer := NewRetryer(config)
		callCount := 0

		result := retryer.Do(context.Background(), func() error {
			callCount++
			return errors.New("503 Service Unavailable")
		})

		if result.Success {
			t.Error("expected failure")
		}
		if result.Attempts != 3 { // 1 initial + 2 retries
			t.Errorf("expected 3 attempts, got %d", result.Attempts)
		}
		if callCount != 3 {
			t.Errorf("expected function called 3 times, got %d", callCount)
		}
	})

	t.Run("should respect context cancellation", func(t *testing.T) {
		config := RetryConfig{
			MaxRetries:   10,
			BaseDelay:    100 * time.Millisecond,
			MaxDelay:     1 * time.Second,
			JitterFactor: 0,
		}
		retryer := NewRetryer(config)

		ctx, cancel := context.WithCancel(context.Background())
		callCount := 0

		go func() {
			time.Sleep(50 * time.Millisecond)
			cancel()
		}()

		result := retryer.Do(ctx, func() error {
			callCount++
			return errors.New("503 Service Unavailable")
		})

		if result.Success {
			t.Error("expected failure due to context cancellation")
		}
		if result.Error != context.Canceled {
			t.Errorf("expected context.Canceled error, got %v", result.Error)
		}
	})
}

func TestIsRetryableError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"network timeout", errors.New("connection timeout"), true},
		{"connection refused", errors.New("connection refused"), true},
		{"503 error", errors.New("503 Service Unavailable"), true},
		{"502 error", errors.New("502 Bad Gateway"), true},
		{"504 error", errors.New("504 Gateway Timeout"), true},
		{"429 error", errors.New("429 Too Many Requests"), true},
		{"401 error", errors.New("401 Unauthorized"), false},
		{"403 error", errors.New("403 Forbidden"), false},
		{"404 error", errors.New("404 Not Found"), false},
		{"generic error", errors.New("something went wrong"), false},
		{"nil error", nil, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := IsRetryable(tt.err)
			if result != tt.expected {
				t.Errorf("expected %v, got %v", tt.expected, result)
			}
		})
	}
}
