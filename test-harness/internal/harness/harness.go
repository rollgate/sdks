// Package harness provides the main orchestrator for SDK contract tests.
package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
)

// TestService represents an SDK test service.
type TestService struct {
	Name    string // e.g., "sdk-node", "sdk-go"
	URL     string // e.g., "http://localhost:8001"
	client  *http.Client
}

// NewTestService creates a new test service client.
func NewTestService(name, url string) *TestService {
	return &TestService{
		Name: name,
		URL:  url,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Health checks if the service is available.
func (ts *TestService) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL, nil)
	if err != nil {
		return err
	}

	resp, err := ts.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check failed: status %d", resp.StatusCode)
	}

	return nil
}

// SendCommand sends a command to the test service.
func (ts *TestService) SendCommand(ctx context.Context, cmd protocol.Command) (protocol.Response, error) {
	data, err := json.Marshal(cmd)
	if err != nil {
		return protocol.Response{}, fmt.Errorf("marshal command: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL, bytes.NewReader(data))
	if err != nil {
		return protocol.Response{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := ts.client.Do(req)
	if err != nil {
		return protocol.Response{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return protocol.Response{}, fmt.Errorf("read response: %w", err)
	}

	var response protocol.Response
	if err := json.Unmarshal(body, &response); err != nil {
		return protocol.Response{}, fmt.Errorf("unmarshal response: %w (body: %s)", err, string(body))
	}

	return response, nil
}

// Cleanup sends DELETE to clean up the service.
func (ts *TestService) Cleanup(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, ts.URL, nil)
	if err != nil {
		return err
	}

	resp, err := ts.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	return nil
}

// Harness is the main test orchestrator.
type Harness struct {
	mockServer        *mock.Server
	httpServer        *http.Server
	mockURL           string
	apiKey            string
	services          []SDKService
	externalServerURL string // If set, use external server instead of mock
}

// Config contains harness configuration.
type Config struct {
	MockPort          int      // Port for mock server (default: 9000)
	APIKey            string   // API key for mock server (default: "test-api-key")
	Services          []string // Service URLs (e.g., ["http://localhost:8001", "http://localhost:8002"])
	ExternalServerURL string   // If set, use external server instead of mock (e.g., "http://localhost:3000")
}

// DefaultConfig returns the default configuration.
func DefaultConfig() Config {
	return Config{
		MockPort: 9000,
		APIKey:   "test-api-key",
		Services: []string{},
	}
}

// New creates a new test harness.
func New(cfg Config) *Harness {
	if cfg.MockPort == 0 {
		cfg.MockPort = 9000
	}
	if cfg.APIKey == "" {
		cfg.APIKey = "test-api-key"
	}

	h := &Harness{
		mockURL:           fmt.Sprintf("http://localhost:%d", cfg.MockPort),
		apiKey:            cfg.APIKey,
		services:          make([]SDKService, 0),
		externalServerURL: cfg.ExternalServerURL,
	}

	// Only create mock server if not using external server
	if cfg.ExternalServerURL == "" {
		h.mockServer = mock.NewServer(cfg.APIKey)
	}

	return h
}

// AddService adds a test service.
func (h *Harness) AddService(name, url string) {
	h.services = append(h.services, NewTestService(name, url))
}

// GetServices returns all registered test services.
func (h *Harness) GetServices() []SDKService {
	return h.services
}

// AddBrowserService adds a browser test service (LaunchDarkly protocol).
func (h *Harness) AddBrowserService(name, url string) {
	h.services = append(h.services, NewBrowserTestService(name, url))
}

// GetMockServer returns the mock server for configuration.
func (h *Harness) GetMockServer() *mock.Server {
	return h.mockServer
}

// GetMockURL returns the mock server URL.
func (h *Harness) GetMockURL() string {
	return h.mockURL
}

// GetAPIKey returns the API key.
func (h *Harness) GetAPIKey() string {
	return h.apiKey
}

// Start starts the mock server (or verifies external server is available).
func (h *Harness) Start(ctx context.Context) error {
	// If using external server, just verify it's reachable
	if h.externalServerURL != "" {
		fmt.Printf("Using external server: %s\n", h.externalServerURL)
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get(h.externalServerURL + "/health")
		if err != nil {
			return fmt.Errorf("external server not reachable: %w", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("external server health check failed: %d", resp.StatusCode)
		}
		return nil
	}

	listener, err := net.Listen("tcp", h.mockURL[7:]) // Remove "http://"
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}

	h.httpServer = &http.Server{
		Handler: h.mockServer,
	}

	go func() {
		if err := h.httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Printf("Mock server error: %v\n", err)
		}
	}()

	// Wait for server to be ready
	for i := 0; i < 50; i++ {
		conn, err := net.DialTimeout("tcp", listener.Addr().String(), 100*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}

	return fmt.Errorf("mock server failed to start")
}

// Stop stops the mock server.
func (h *Harness) Stop(ctx context.Context) error {
	if h.httpServer != nil {
		return h.httpServer.Shutdown(ctx)
	}
	return nil
}

// SetScenario sets a test scenario on the mock server.
func (h *Harness) SetScenario(scenario string) {
	if h.mockServer == nil {
		return
	}
	h.mockServer.SetScenario(scenario)
}

// SetFlag sets a single flag on the mock server.
func (h *Harness) SetFlag(flag *mock.FlagState) {
	if h.mockServer == nil {
		return
	}
	h.mockServer.SetFlag(flag)
}

// WaitForServices waits for all services to be healthy.
func (h *Harness) WaitForServices(ctx context.Context, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)

	for _, svc := range h.services {
		for {
			if time.Now().After(deadline) {
				return fmt.Errorf("timeout waiting for service %s", svc.GetName())
			}

			if err := svc.Health(ctx); err == nil {
				break
			}

			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(500 * time.Millisecond):
			}
		}
	}

	return nil
}

// InitSDKConfig creates a config for SDK initialization.
func (h *Harness) InitSDKConfig() protocol.Config {
	baseURL := h.mockURL
	if h.externalServerURL != "" {
		baseURL = h.externalServerURL
	}
	return protocol.Config{
		APIKey:          h.apiKey,
		BaseURL:         baseURL,
		RefreshInterval: 0, // Disable polling for tests
		EnableStreaming: false,
		Timeout:         5000,
	}
}

// ForEachService runs a function for each service.
func (h *Harness) ForEachService(ctx context.Context, fn func(svc SDKService) error) error {
	for _, svc := range h.services {
		if err := fn(svc); err != nil {
			return fmt.Errorf("%s: %w", svc.GetName(), err)
		}
	}
	return nil
}

// SetError configures error simulation on the mock server.
func (h *Harness) SetError(statusCode int, count int, retryAfter int, message string) {
	if h.mockServer == nil {
		return
	}
	h.mockServer.SetError(&mock.ErrorSimulation{
		StatusCode: statusCode,
		Count:      count,
		RetryAfter: retryAfter,
		Message:    message,
	})
}

// SetErrorWithDelay configures error simulation with delay.
func (h *Harness) SetErrorWithDelay(statusCode int, count int, delay time.Duration) {
	if h.mockServer == nil {
		return
	}
	h.mockServer.SetError(&mock.ErrorSimulation{
		StatusCode: statusCode,
		Count:      count,
		Delay:      delay,
	})
}

// ClearError removes error simulation.
func (h *Harness) ClearError() {
	if h.mockServer == nil {
		return
	}
	h.mockServer.ClearError()
}

// GetErrorCount returns how many errors have been simulated.
func (h *Harness) GetErrorCount() int {
	if h.mockServer == nil {
		return 0
	}
	return h.mockServer.GetErrorCount()
}

// ClearUserSessions clears all user sessions from mock server.
func (h *Harness) ClearUserSessions() {
	if h.mockServer == nil {
		return
	}
	h.mockServer.ClearUserSessions()
}

// GetSSEClientCount returns the count of connected SSE clients.
func (h *Harness) GetSSEClientCount() int {
	if h.mockServer == nil {
		return 0
	}
	return h.mockServer.GetSSEClientCount()
}

// SendSSEEvent sends a custom event to all SSE clients.
func (h *Harness) SendSSEEvent(data map[string]interface{}) int {
	if h.mockServer == nil {
		return 0
	}
	return h.mockServer.SendSSEEvent(data)
}

// DisconnectSSEClients disconnects all SSE clients.
func (h *Harness) DisconnectSSEClients() int {
	if h.mockServer == nil {
		return 0
	}
	return h.mockServer.DisconnectSSEClients()
}

// BroadcastFlagChange broadcasts a flag change to all SSE clients.
func (h *Harness) BroadcastFlagChange(flagKey string, enabled bool) {
	if h.mockServer == nil {
		return
	}
	h.mockServer.BroadcastFlagChange(flagKey, enabled)
}

// InitSDKConfigWithStreaming creates a config for SDK initialization with streaming enabled.
func (h *Harness) InitSDKConfigWithStreaming() protocol.Config {
	baseURL := h.mockURL
	if h.externalServerURL != "" {
		baseURL = h.externalServerURL
	}
	return protocol.Config{
		APIKey:          h.apiKey,
		BaseURL:         baseURL,
		RefreshInterval: 0, // Disable polling
		EnableStreaming: true,
		Timeout:         5000,
	}
}

// IsUsingExternalServer returns true if using an external server instead of mock.
func (h *Harness) IsUsingExternalServer() bool {
	return h.externalServerURL != ""
}

// GetServerURL returns the server URL (either mock or external).
func (h *Harness) GetServerURL() string {
	if h.externalServerURL != "" {
		return h.externalServerURL
	}
	return h.mockURL
}
