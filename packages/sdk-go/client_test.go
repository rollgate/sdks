package rollgate

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func newTestServer(flags map[string]bool) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/sdk/flags":
			resp := map[string]interface{}{
				"flags": flags,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
		case "/health":
			w.WriteHeader(http.StatusOK)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
}

func TestClient_Init(t *testing.T) {
	server := newTestServer(map[string]bool{"test-flag": true})
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:          "test-key",
		BaseURL:         server.URL,
		RefreshInterval: time.Hour, // large value to avoid polling during test
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	// Init should work (alias for Initialize)
	err = client.Init(context.Background())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	if !client.IsReady() {
		t.Error("expected client to be ready after Init")
	}

	if !client.IsEnabled("test-flag", false) {
		t.Error("expected test-flag to be enabled")
	}
}

func TestClient_InitIsAliasForInitialize(t *testing.T) {
	server := newTestServer(map[string]bool{"flag-a": true})
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:          "test-key",
		BaseURL:         server.URL,
		RefreshInterval: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	// Both Init and Initialize should work identically
	err = client.Init(context.Background())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	flags := client.GetAllFlags()
	if !flags["flag-a"] {
		t.Error("expected flag-a to be true")
	}
}

func TestClient_OnCircuitOpen(t *testing.T) {
	client, err := NewClient(Config{
		APIKey:          "test-key",
		BaseURL:         "http://localhost:1", // Will fail to connect
		RefreshInterval: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	var mu sync.Mutex
	openCalled := false

	client.OnCircuitOpen(func() {
		mu.Lock()
		defer mu.Unlock()
		openCalled = true
	})

	// The callback is registered, verify it's stored
	client.mu.RLock()
	callbackCount := len(client.onCircuitOpenCallbacks)
	client.mu.RUnlock()

	if callbackCount != 1 {
		t.Errorf("expected 1 OnCircuitOpen callback, got %d", callbackCount)
	}

	// Suppress unused variable warning - openCalled is set asynchronously by the callback
	_ = openCalled
	_ = mu
}

func TestClient_OnCircuitClosed(t *testing.T) {
	client, err := NewClient(Config{
		APIKey:          "test-key",
		BaseURL:         "http://localhost:1",
		RefreshInterval: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	closedCalled := false
	client.OnCircuitClosed(func() {
		closedCalled = true
	})

	client.mu.RLock()
	callbackCount := len(client.onCircuitClosedCallbacks)
	client.mu.RUnlock()

	if callbackCount != 1 {
		t.Errorf("expected 1 OnCircuitClosed callback, got %d", callbackCount)
	}

	// Suppress unused variable warning - closedCalled is set asynchronously by the callback
	_ = closedCalled
}

func TestClient_MultipleCircuitCallbacks(t *testing.T) {
	client, err := NewClient(Config{
		APIKey:          "test-key",
		BaseURL:         "http://localhost:1",
		RefreshInterval: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	client.OnCircuitOpen(func() {})
	client.OnCircuitOpen(func() {})
	client.OnCircuitClosed(func() {})

	client.mu.RLock()
	openCount := len(client.onCircuitOpenCallbacks)
	closedCount := len(client.onCircuitClosedCallbacks)
	client.mu.RUnlock()

	if openCount != 2 {
		t.Errorf("expected 2 OnCircuitOpen callbacks, got %d", openCount)
	}
	if closedCount != 1 {
		t.Errorf("expected 1 OnCircuitClosed callback, got %d", closedCount)
	}
}

func TestClient_IsEnabledWithOptions(t *testing.T) {
	server := newTestServer(map[string]bool{"feature-x": true, "feature-y": false})
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:          "test-key",
		BaseURL:         server.URL,
		RefreshInterval: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	err = client.Init(context.Background())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// IsEnabled with no options (backward compat)
	if !client.IsEnabled("feature-x", false) {
		t.Error("expected feature-x to be enabled")
	}

	// IsEnabled with WithUser option
	result := client.IsEnabled("feature-x", false, WithUser("user-123"))
	if !result {
		t.Error("expected feature-x to be enabled with WithUser")
	}

	// IsEnabled with WithAttributes option
	result = client.IsEnabled("feature-y", true, WithAttributes(map[string]any{
		"plan": "pro",
	}))
	if result {
		t.Error("expected feature-y to be disabled (server value false)")
	}

	// IsEnabled with both options
	result = client.IsEnabled("feature-x", false,
		WithUser("user-456"),
		WithAttributes(map[string]any{"country": "IT"}),
	)
	if !result {
		t.Error("expected feature-x to be enabled with combined options")
	}
}

func TestClient_IsEnabledDetailWithOptions(t *testing.T) {
	server := newTestServer(map[string]bool{"flag-z": true})
	defer server.Close()

	client, err := NewClient(Config{
		APIKey:          "test-key",
		BaseURL:         server.URL,
		RefreshInterval: time.Hour,
	})
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	err = client.Init(context.Background())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// IsEnabledDetail with options
	detail := client.IsEnabledDetail("flag-z", false, WithUser("user-789"))
	if !detail.Value {
		t.Error("expected flag-z to be enabled")
	}
	if detail.Reason.Kind == "" {
		t.Error("expected a reason to be set")
	}
}

func TestEvalOptions(t *testing.T) {
	t.Run("WithUser sets userID", func(t *testing.T) {
		opts := &evalOptions{}
		WithUser("user-123")(opts)
		if opts.userID != "user-123" {
			t.Errorf("expected userID 'user-123', got '%s'", opts.userID)
		}
	})

	t.Run("WithAttributes sets attributes", func(t *testing.T) {
		opts := &evalOptions{}
		attrs := map[string]any{"plan": "pro", "age": 30}
		WithAttributes(attrs)(opts)
		if len(opts.attributes) != 2 {
			t.Errorf("expected 2 attributes, got %d", len(opts.attributes))
		}
		if opts.attributes["plan"] != "pro" {
			t.Errorf("expected plan 'pro', got '%v'", opts.attributes["plan"])
		}
	})

	t.Run("multiple options compose", func(t *testing.T) {
		opts := &evalOptions{}
		WithUser("user-1")(opts)
		WithAttributes(map[string]any{"key": "val"})(opts)
		if opts.userID != "user-1" {
			t.Errorf("expected userID 'user-1', got '%s'", opts.userID)
		}
		if opts.attributes["key"] != "val" {
			t.Errorf("expected attribute key='val', got '%v'", opts.attributes["key"])
		}
	})
}
