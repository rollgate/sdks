package rollgate

import "time"

// Config holds the configuration for the Rollgate client.
type Config struct {
	// APIKey is your Rollgate API key (required)
	APIKey string

	// BaseURL is the base URL for Rollgate API (default: https://api.rollgate.io)
	BaseURL string

	// Timeout is the request timeout (default: 5s)
	Timeout time.Duration

	// RefreshInterval is the interval for polling flag updates (default: 30s)
	// Set to 0 to disable polling (ignored when EnableStreaming is true)
	RefreshInterval time.Duration

	// EnableStreaming enables SSE streaming for real-time updates (default: false)
	// When enabled, polling is disabled and updates are received via SSE
	EnableStreaming bool

	// SSEURL is the URL for SSE streaming (default: same as BaseURL)
	SSEURL string

	// Retry configuration
	Retry RetryConfig

	// CircuitBreaker configuration
	CircuitBreaker CircuitBreakerConfig

	// Cache configuration
	Cache CacheConfig

	// Logger for debug output (optional)
	Logger Logger
}

// RetryConfig holds retry settings.
type RetryConfig struct {
	// MaxRetries is the maximum number of retry attempts (default: 3)
	MaxRetries int

	// BaseDelay is the initial delay between retries (default: 100ms)
	BaseDelay time.Duration

	// MaxDelay is the maximum delay between retries (default: 10s)
	MaxDelay time.Duration

	// JitterFactor adds randomness to delays (default: 0.1, range 0-1)
	JitterFactor float64
}

// CircuitBreakerConfig holds circuit breaker settings.
type CircuitBreakerConfig struct {
	// FailureThreshold is the number of failures before opening (default: 5)
	FailureThreshold int

	// RecoveryTimeout is how long to wait before half-open (default: 30s)
	RecoveryTimeout time.Duration

	// MonitoringWindow is the time window for counting failures (default: 60s)
	MonitoringWindow time.Duration

	// SuccessThreshold is successes needed to close from half-open (default: 3)
	SuccessThreshold int
}

// CacheConfig holds cache settings.
type CacheConfig struct {
	// TTL is how long cached flags are considered fresh (default: 5m)
	TTL time.Duration

	// StaleTTL is how long stale flags can be used as fallback (default: 1h)
	StaleTTL time.Duration

	// Enabled controls whether caching is enabled (default: true)
	Enabled bool
}

// Logger interface for custom logging.
type Logger interface {
	Debug(msg string, args ...any)
	Info(msg string, args ...any)
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
}

// DefaultConfig returns a Config with sensible defaults.
func DefaultConfig(apiKey string) Config {
	return Config{
		APIKey:          apiKey,
		BaseURL:         "https://api.rollgate.io",
		Timeout:         5 * time.Second,
		RefreshInterval: 30 * time.Second,
		Retry:           DefaultRetryConfig(),
		CircuitBreaker:  DefaultCircuitBreakerConfig(),
		Cache:           DefaultCacheConfig(),
	}
}

// DefaultRetryConfig returns default retry settings.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:   3,
		BaseDelay:    100 * time.Millisecond,
		MaxDelay:     10 * time.Second,
		JitterFactor: 0.1,
	}
}

// DefaultCircuitBreakerConfig returns default circuit breaker settings.
func DefaultCircuitBreakerConfig() CircuitBreakerConfig {
	return CircuitBreakerConfig{
		FailureThreshold: 5,
		RecoveryTimeout:  30 * time.Second,
		MonitoringWindow: 60 * time.Second,
		SuccessThreshold: 3,
	}
}

// DefaultCacheConfig returns default cache settings.
func DefaultCacheConfig() CacheConfig {
	return CacheConfig{
		TTL:      5 * time.Minute,
		StaleTTL: 1 * time.Hour,
		Enabled:  true,
	}
}
