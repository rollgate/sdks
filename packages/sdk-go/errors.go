package rollgate

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ErrorCategory represents the type of error.
type ErrorCategory string

const (
	ErrorCategoryNone      ErrorCategory = ""
	ErrorCategoryNetwork   ErrorCategory = "network"
	ErrorCategoryAuth      ErrorCategory = "auth"
	ErrorCategoryRateLimit ErrorCategory = "rate_limit"
	ErrorCategoryValidation ErrorCategory = "validation"
	ErrorCategoryServer    ErrorCategory = "server"
	ErrorCategoryUnknown   ErrorCategory = "unknown"
)

// RollgateError is the base error type for all Rollgate SDK errors.
type RollgateError struct {
	Message    string
	Category   ErrorCategory
	StatusCode int
	Retryable  bool
	Cause      error
}

func (e *RollgateError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *RollgateError) Unwrap() error {
	return e.Cause
}

// NetworkError represents a network-level error.
type NetworkError struct {
	RollgateError
}

// AuthenticationError represents an authentication failure.
type AuthenticationError struct {
	RollgateError
}

// RateLimitError represents a rate limit error.
type RateLimitError struct {
	RollgateError
	RetryAfter int // seconds
}

// ValidationError represents a validation error.
type ValidationError struct {
	RollgateError
	Field string
}

// ServerError represents a server-side error.
type ServerError struct {
	RollgateError
}

// CircuitOpenError is returned when the circuit breaker is open.
type CircuitOpenError struct {
	RollgateError
}

// Common errors
var (
	ErrNotInitialized = errors.New("rollgate client not initialized")
	ErrInvalidAPIKey  = errors.New("invalid or missing API key")
	ErrCircuitOpen    = &CircuitOpenError{
		RollgateError: RollgateError{
			Message:   "circuit breaker is open",
			Category:  ErrorCategoryNetwork,
			Retryable: false,
		},
	}
)

// NewNetworkError creates a new network error.
func NewNetworkError(message string, cause error) *NetworkError {
	return &NetworkError{
		RollgateError: RollgateError{
			Message:   message,
			Category:  ErrorCategoryNetwork,
			Retryable: true,
			Cause:     cause,
		},
	}
}

// NewAuthenticationError creates a new authentication error.
func NewAuthenticationError(message string) *AuthenticationError {
	return &AuthenticationError{
		RollgateError: RollgateError{
			Message:    message,
			Category:   ErrorCategoryAuth,
			StatusCode: http.StatusUnauthorized,
			Retryable:  false,
		},
	}
}

// NewRateLimitError creates a new rate limit error.
func NewRateLimitError(retryAfter int) *RateLimitError {
	return &RateLimitError{
		RollgateError: RollgateError{
			Message:    "rate limit exceeded",
			Category:   ErrorCategoryRateLimit,
			StatusCode: http.StatusTooManyRequests,
			Retryable:  true,
		},
		RetryAfter: retryAfter,
	}
}

// NewServerError creates a new server error.
func NewServerError(statusCode int, message string) *ServerError {
	return &ServerError{
		RollgateError: RollgateError{
			Message:    message,
			Category:   ErrorCategoryServer,
			StatusCode: statusCode,
			Retryable:  statusCode >= 500,
		},
	}
}

// ClassifyError categorizes an error based on its characteristics.
func ClassifyError(err error) *RollgateError {
	if err == nil {
		return nil
	}

	// Already a RollgateError
	var rollgateErr *RollgateError
	if errors.As(err, &rollgateErr) {
		return rollgateErr
	}

	msg := err.Error()
	msgLower := strings.ToLower(msg)

	// Network errors
	networkPatterns := []string{
		"connection refused", "connection reset", "timeout",
		"no such host", "network is unreachable", "eof",
		"tls handshake", "certificate", "dial tcp",
	}
	for _, pattern := range networkPatterns {
		if strings.Contains(msgLower, pattern) {
			return &RollgateError{
				Message:   msg,
				Category:  ErrorCategoryNetwork,
				Retryable: true,
				Cause:     err,
			}
		}
	}

	return &RollgateError{
		Message:   msg,
		Category:  ErrorCategoryUnknown,
		Retryable: false,
		Cause:     err,
	}
}

// IsRetryable checks if an error should be retried.
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}

	var rollgateErr *RollgateError
	if errors.As(err, &rollgateErr) {
		return rollgateErr.Retryable
	}

	// Check for common retryable patterns
	msg := strings.ToLower(err.Error())
	retryablePatterns := []string{
		"timeout", "connection refused", "connection reset",
		"temporary failure", "try again", "503", "502", "504", "429",
		"service unavailable", "bad gateway", "gateway timeout", "too many requests",
	}

	for _, pattern := range retryablePatterns {
		if strings.Contains(msg, pattern) {
			return true
		}
	}

	return false
}
