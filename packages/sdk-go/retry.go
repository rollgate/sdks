package rollgate

import (
	"context"
	"math"
	"math/rand"
	"time"
)

// RetryResult holds the result of a retry operation.
type RetryResult struct {
	Success  bool
	Attempts int
	Error    error
}

// Retryer handles retry logic with exponential backoff.
type Retryer struct {
	config RetryConfig
}

// NewRetryer creates a new Retryer with the given config.
func NewRetryer(config RetryConfig) *Retryer {
	return &Retryer{config: config}
}

// Do executes the function with retry logic.
func (r *Retryer) Do(ctx context.Context, fn func() error) RetryResult {
	var lastErr error
	attempts := 0

	for attempts <= r.config.MaxRetries {
		attempts++

		err := fn()
		if err == nil {
			return RetryResult{
				Success:  true,
				Attempts: attempts,
			}
		}

		lastErr = err

		// Don't retry non-retryable errors
		if !IsRetryable(err) {
			return RetryResult{
				Success:  false,
				Attempts: attempts,
				Error:    lastErr,
			}
		}

		// Don't retry if we've exhausted attempts
		if attempts > r.config.MaxRetries {
			break
		}

		// Calculate backoff delay
		delay := r.calculateBackoff(attempts - 1)

		// Wait with context cancellation support
		select {
		case <-ctx.Done():
			return RetryResult{
				Success:  false,
				Attempts: attempts,
				Error:    ctx.Err(),
			}
		case <-time.After(delay):
			// Continue to next attempt
		}
	}

	return RetryResult{
		Success:  false,
		Attempts: attempts,
		Error:    lastErr,
	}
}

// DoWithResult executes the function with retry logic and returns a result.
func (r *Retryer) DoWithResult(ctx context.Context, fn func() (any, error)) (any, RetryResult) {
	var result any
	var lastErr error
	attempts := 0

	for attempts <= r.config.MaxRetries {
		attempts++

		res, err := fn()
		if err == nil {
			return res, RetryResult{
				Success:  true,
				Attempts: attempts,
			}
		}

		lastErr = err

		// Don't retry non-retryable errors
		if !IsRetryable(err) {
			return nil, RetryResult{
				Success:  false,
				Attempts: attempts,
				Error:    lastErr,
			}
		}

		// Don't retry if we've exhausted attempts
		if attempts > r.config.MaxRetries {
			break
		}

		// Calculate backoff delay
		delay := r.calculateBackoff(attempts - 1)

		// Wait with context cancellation support
		select {
		case <-ctx.Done():
			return nil, RetryResult{
				Success:  false,
				Attempts: attempts,
				Error:    ctx.Err(),
			}
		case <-time.After(delay):
			// Continue to next attempt
		}
	}

	return result, RetryResult{
		Success:  false,
		Attempts: attempts,
		Error:    lastErr,
	}
}

// calculateBackoff calculates the delay for the given attempt using exponential backoff.
func (r *Retryer) calculateBackoff(attempt int) time.Duration {
	// Exponential backoff: baseDelay * 2^attempt
	delay := float64(r.config.BaseDelay) * math.Pow(2, float64(attempt))

	// Apply jitter
	if r.config.JitterFactor > 0 {
		jitter := delay * r.config.JitterFactor * (rand.Float64()*2 - 1)
		delay += jitter
	}

	// Ensure delay is not negative
	if delay < 0 {
		delay = 0
	}

	// Cap at max delay
	if delay > float64(r.config.MaxDelay) {
		delay = float64(r.config.MaxDelay)
	}

	return time.Duration(delay)
}

// CalculateBackoff calculates backoff delay for testing/external use.
func CalculateBackoff(attempt int, config RetryConfig) time.Duration {
	r := NewRetryer(config)
	return r.calculateBackoff(attempt)
}
