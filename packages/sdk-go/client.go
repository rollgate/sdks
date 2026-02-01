package rollgate

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// UserContext holds user information for flag targeting.
type UserContext struct {
	ID         string
	Email      string
	Attributes map[string]any
}

// Client is the Rollgate SDK client.
type Client struct {
	mu sync.RWMutex

	config Config
	client *http.Client

	flags    map[string]bool
	user     *UserContext
	lastETag string

	circuitBreaker *CircuitBreaker
	cache          *FlagCache
	retryer        *Retryer
	dedup          *RequestDeduplicator
	metrics        *SDKMetrics
	sseClient      *SSEClient

	stopPolling chan struct{}
	ready       bool
	streaming   bool
}

// flagsResponse represents the API response for flags.
type flagsResponse struct {
	Flags map[string]bool `json:"flags"`
}

// NewClient creates a new Rollgate client with the given config.
func NewClient(config Config) (*Client, error) {
	if config.APIKey == "" {
		return nil, ErrInvalidAPIKey
	}

	// Apply defaults for zero values
	if config.BaseURL == "" {
		config.BaseURL = "https://api.rollgate.io"
	}
	if config.Timeout == 0 {
		config.Timeout = 5 * time.Second
	}
	if config.RefreshInterval == 0 {
		config.RefreshInterval = 30 * time.Second
	}
	if config.Retry.MaxRetries == 0 {
		config.Retry = DefaultRetryConfig()
	}
	if config.CircuitBreaker.FailureThreshold == 0 {
		config.CircuitBreaker = DefaultCircuitBreakerConfig()
	}
	if config.Cache.TTL == 0 {
		config.Cache = DefaultCacheConfig()
	}

	c := &Client{
		config:         config,
		client:         &http.Client{Timeout: config.Timeout},
		flags:          make(map[string]bool),
		circuitBreaker: NewCircuitBreaker(config.CircuitBreaker),
		cache:          NewFlagCache(config.Cache),
		retryer:        NewRetryer(config.Retry),
		dedup:          NewRequestDeduplicator(),
		metrics:        NewSDKMetrics(),
		stopPolling:    make(chan struct{}),
	}

	// Set up circuit breaker state change tracking
	c.circuitBreaker.OnStateChange(func(from, to CircuitState) {
		c.metrics.RecordCircuitStateChange(to)
		if c.config.Logger != nil {
			c.config.Logger.Info("circuit breaker state changed", "from", from, "to", to)
		}
	})

	return c, nil
}

// Initialize fetches the initial flags and starts background polling.
func (c *Client) Initialize(ctx context.Context) error {
	// Try to load from cache first
	if c.config.Cache.Enabled {
		cached := c.cache.Get()
		if cached.Found {
			c.mu.Lock()
			c.flags = cached.Flags
			c.mu.Unlock()
			c.metrics.RecordCacheHit(cached.Stale)
		}
	}

	// If streaming is enabled, set up SSE
	if c.config.EnableStreaming {
		return c.initializeWithSSE(ctx)
	}

	// Fetch fresh flags via HTTP
	if err := c.Refresh(ctx); err != nil {
		// If we have cached data, we can continue
		if c.cache.HasAny() {
			if c.config.Logger != nil {
				c.config.Logger.Warn("failed to fetch fresh flags, using cache", "error", err)
			}
		} else {
			return fmt.Errorf("failed to initialize: %w", err)
		}
	}

	c.mu.Lock()
	c.ready = true
	c.mu.Unlock()

	// Start background polling if interval > 0
	if c.config.RefreshInterval > 0 {
		go c.startPolling()
	}

	return nil
}

func (c *Client) initializeWithSSE(ctx context.Context) error {
	// First, fetch flags via HTTP to have them immediately available
	if err := c.Refresh(ctx); err != nil {
		// If we have cached data, we can continue
		if !c.cache.HasAny() {
			return fmt.Errorf("failed to initialize: %w", err)
		}
		if c.config.Logger != nil {
			c.config.Logger.Warn("failed to fetch fresh flags, using cache", "error", err)
		}
	}

	c.mu.Lock()
	c.ready = true
	c.mu.Unlock()

	// Now set up SSE for real-time updates
	sseConfig := c.config
	if c.config.SSEURL != "" {
		sseConfig.BaseURL = c.config.SSEURL
	}

	c.sseClient = NewSSEClient(sseConfig)
	c.sseClient.SetUser(c.user)

	// Set up flag update handler
	c.sseClient.OnFlags(func(flags map[string]bool) {
		c.mu.Lock()
		// Merge flags (for single flag updates) or replace (for full updates)
		if len(flags) == 1 {
			for k, v := range flags {
				c.flags[k] = v
			}
		} else {
			c.flags = flags
			// Update cache
			if c.config.Cache.Enabled {
				c.cache.Set(flags)
			}
		}
		c.mu.Unlock()
	})

	c.sseClient.OnError(func(err error) {
		if c.config.Logger != nil {
			c.config.Logger.Warn("SSE error", "error", err)
		}
	})

	c.sseClient.OnConnect(func() {
		if c.config.Logger != nil {
			c.config.Logger.Info("SSE connected")
		}
	})

	c.mu.Lock()
	c.streaming = true
	c.mu.Unlock()

	// Start SSE in background for updates (non-blocking)
	return c.sseClient.Connect(ctx)
}

// IsEnabled checks if a flag is enabled for the current user.
func (c *Client) IsEnabled(flagKey string, defaultValue bool) bool {
	start := time.Now()
	defer func() {
		c.metrics.RecordEvaluation(time.Since(start).Nanoseconds())
	}()

	c.mu.RLock()
	defer c.mu.RUnlock()

	if value, ok := c.flags[flagKey]; ok {
		return value
	}
	return defaultValue
}

// GetAllFlags returns all current flag values.
func (c *Client) GetAllFlags() map[string]bool {
	c.mu.RLock()
	defer c.mu.RUnlock()

	result := make(map[string]bool, len(c.flags))
	for k, v := range c.flags {
		result[k] = v
	}
	return result
}

// GetString returns a string flag value, or defaultValue if not found.
// Note: Currently the API only supports boolean flags. String flags will be
// added in a future version. For now, this always returns the default value.
func (c *Client) GetString(flagKey string, defaultValue string) string {
	// TODO: Implement when API supports typed flags
	return defaultValue
}

// GetNumber returns a numeric flag value, or defaultValue if not found.
// Note: Currently the API only supports boolean flags. Number flags will be
// added in a future version. For now, this always returns the default value.
func (c *Client) GetNumber(flagKey string, defaultValue float64) float64 {
	// TODO: Implement when API supports typed flags
	return defaultValue
}

// GetJSON returns a JSON flag value, or defaultValue if not found.
// Note: Currently the API only supports boolean flags. JSON flags will be
// added in a future version. For now, this always returns the default value.
func (c *Client) GetJSON(flagKey string, defaultValue interface{}) interface{} {
	// TODO: Implement when API supports typed flags
	return defaultValue
}

// Identify sets the user context for flag targeting.
func (c *Client) Identify(ctx context.Context, user *UserContext) error {
	c.mu.Lock()
	c.user = user
	c.mu.Unlock()

	// Send identify request to server with user attributes
	if user != nil && user.ID != "" {
		if err := c.sendIdentify(ctx, user); err != nil {
			// Log but don't fail - refresh will still work with user_id param
			if c.config.Logger != nil {
				c.config.Logger.Warn("failed to send identify", "error", err)
			}
		}
	}

	return c.Refresh(ctx)
}

// sendIdentify sends user context to the server for server-side evaluation.
func (c *Client) sendIdentify(ctx context.Context, user *UserContext) error {
	u := c.config.BaseURL + "/api/v1/sdk/identify"

	body := map[string]interface{}{
		"user": map[string]interface{}{
			"id":         user.ID,
			"email":      user.Email,
			"attributes": user.Attributes,
		},
	}

	jsonBody, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, io.NopCloser(
		&bytesReader{data: jsonBody},
	))
	if err != nil {
		return err
	}

	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("identify failed with status %d", resp.StatusCode)
	}

	return nil
}

// bytesReader wraps a byte slice to implement io.Reader.
type bytesReader struct {
	data []byte
	pos  int
}

func (r *bytesReader) Read(p []byte) (n int, err error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n = copy(p, r.data[r.pos:])
	r.pos += n
	return n, nil
}

// Reset clears the user context.
func (c *Client) Reset(ctx context.Context) error {
	c.mu.Lock()
	oldUser := c.user
	c.user = nil
	c.mu.Unlock()

	// Clear user session on server
	if oldUser != nil && oldUser.ID != "" {
		_ = c.sendIdentify(ctx, &UserContext{ID: oldUser.ID}) // Send empty attributes
	}

	return c.Refresh(ctx)
}

// Refresh forces a refresh of flag values from the server.
func (c *Client) Refresh(ctx context.Context) error {
	result, err := c.dedup.Dedupe("fetch-flags", func() (any, error) {
		return nil, c.fetchFlags(ctx)
	})
	_ = result
	return err
}

// GetMetrics returns a snapshot of SDK metrics.
func (c *Client) GetMetrics() MetricsSnapshot {
	return c.metrics.Snapshot()
}

// GetCircuitState returns the current circuit breaker state.
func (c *Client) GetCircuitState() CircuitState {
	return c.circuitBreaker.GetState()
}

// IsReady returns true if the client has been initialized.
func (c *Client) IsReady() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.ready
}

// Close stops background polling/streaming and releases resources.
func (c *Client) Close() {
	close(c.stopPolling)
	if c.sseClient != nil {
		c.sseClient.Close()
	}
}

// IsStreaming returns true if the client is using SSE streaming.
func (c *Client) IsStreaming() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.streaming
}

func (c *Client) fetchFlags(ctx context.Context) error {
	// Check circuit breaker
	if !c.circuitBreaker.IsAllowingRequests() {
		if c.config.Logger != nil {
			c.config.Logger.Warn("circuit breaker is open, using cached flags")
		}
		c.useCachedFallback()
		return ErrCircuitOpen
	}

	startTime := time.Now()
	var statusCode int
	var errCategory ErrorCategory

	err := c.circuitBreaker.Execute(func() error {
		result := c.retryer.Do(ctx, func() error {
			return c.doFetchRequest(ctx, &statusCode)
		})

		if !result.Success {
			return result.Error
		}
		return nil
	})

	latencyMs := time.Since(startTime).Milliseconds()

	if err != nil {
		classified := ClassifyError(err)
		errCategory = classified.Category
		c.metrics.RecordRequest(latencyMs, false, errCategory)
		c.useCachedFallback()
		return err
	}

	c.metrics.RecordRequest(latencyMs, true, "")
	return nil
}

func (c *Client) doFetchRequest(ctx context.Context, statusCode *int) error {
	u, err := url.Parse(c.config.BaseURL + "/api/v1/sdk/flags")
	if err != nil {
		return NewNetworkError("invalid URL", err)
	}

	c.mu.RLock()
	if c.user != nil && c.user.ID != "" {
		q := u.Query()
		q.Set("user_id", c.user.ID)
		u.RawQuery = q.Encode()
	}
	c.mu.RUnlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return NewNetworkError("failed to create request", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-SDK-Name", "rollgate-go")
	req.Header.Set("X-SDK-Version", "0.1.0")

	c.mu.RLock()
	if c.lastETag != "" {
		req.Header.Set("If-None-Match", c.lastETag)
	}
	c.mu.RUnlock()

	resp, err := c.client.Do(req)
	if err != nil {
		return NewNetworkError("request failed", err)
	}
	defer resp.Body.Close()

	*statusCode = resp.StatusCode

	// Handle 304 Not Modified
	if resp.StatusCode == http.StatusNotModified {
		return nil
	}

	// Handle errors
	if resp.StatusCode != http.StatusOK {
		return c.handleErrorResponse(resp)
	}

	// Store ETag
	if etag := resp.Header.Get("ETag"); etag != "" {
		c.mu.Lock()
		c.lastETag = etag
		c.mu.Unlock()
	}

	// Parse response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return NewNetworkError("failed to read response", err)
	}

	var flagsResp flagsResponse
	if err := json.Unmarshal(body, &flagsResp); err != nil {
		return NewNetworkError("failed to parse response", err)
	}

	// Update flags
	c.mu.Lock()
	c.flags = flagsResp.Flags
	c.mu.Unlock()

	// Update cache
	if c.config.Cache.Enabled {
		c.cache.Set(flagsResp.Flags)
	}

	return nil
}

func (c *Client) handleErrorResponse(resp *http.Response) error {
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return NewAuthenticationError("invalid API key")
	case http.StatusForbidden:
		return NewAuthenticationError("access denied")
	case http.StatusTooManyRequests:
		retryAfter := 60
		if ra := resp.Header.Get("Retry-After"); ra != "" {
			if v, err := strconv.Atoi(ra); err == nil {
				retryAfter = v
			}
		}
		return NewRateLimitError(retryAfter)
	case http.StatusBadRequest:
		return &ValidationError{
			RollgateError: RollgateError{
				Message:    "bad request",
				Category:   ErrorCategoryValidation,
				StatusCode: resp.StatusCode,
				Retryable:  false,
			},
		}
	default:
		if resp.StatusCode >= 500 {
			return NewServerError(resp.StatusCode, fmt.Sprintf("server error: %d", resp.StatusCode))
		}
		return &RollgateError{
			Message:    fmt.Sprintf("unexpected status code: %d", resp.StatusCode),
			Category:   ErrorCategoryUnknown,
			StatusCode: resp.StatusCode,
			Retryable:  false,
		}
	}
}

func (c *Client) useCachedFallback() {
	if !c.config.Cache.Enabled {
		return
	}

	cached := c.cache.Get()
	if cached.Found {
		c.mu.Lock()
		c.flags = cached.Flags
		c.mu.Unlock()
		c.metrics.RecordCacheHit(cached.Stale)
	} else {
		c.metrics.RecordCacheMiss()
	}
}

func (c *Client) startPolling() {
	ticker := time.NewTicker(c.config.RefreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-c.stopPolling:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), c.config.Timeout)
			if err := c.Refresh(ctx); err != nil {
				if c.config.Logger != nil {
					c.config.Logger.Warn("failed to refresh flags", "error", err)
				}
			}
			cancel()
		}
	}
}
