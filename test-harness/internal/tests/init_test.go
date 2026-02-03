package tests

import (
	"context"
	"log"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/rollgate/test-harness/internal/harness"
	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestInit tests SDK initialization.
func TestInit(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	t.Run("init with valid config", func(t *testing.T) {
		config := h.InitSDKConfig()
		cmd := protocol.NewInitCommand(config, nil)

		for _, svc := range h.GetServices() {
			resp, err := svc.SendCommand(tc.Ctx, cmd)
			require.NoError(t, err, "SendCommand failed for %s", svc.GetName())
			assert.False(t, resp.IsError(), "Init should succeed for %s: %s - %s", svc.GetName(), resp.Error, resp.Message)
		}

		// Verify all SDKs are ready
		tc.AssertAllReady()

		// Cleanup
		tc.CloseAllSDKs()
	})

	t.Run("init with user context", func(t *testing.T) {
		config := h.InitSDKConfig()
		user := &protocol.UserContext{
			ID:    "test-user-1",
			Email: "test@example.com",
			Attributes: map[string]interface{}{
				"plan": "pro",
			},
		}
		cmd := protocol.NewInitCommand(config, user)

		for _, svc := range h.GetServices() {
			resp, err := svc.SendCommand(tc.Ctx, cmd)
			require.NoError(t, err, "SendCommand failed for %s", svc.GetName())
			assert.False(t, resp.IsError(), "Init with user should succeed for %s", svc.GetName())
		}

		tc.AssertAllReady()
		tc.CloseAllSDKs()
	})

	t.Run("init with invalid API key", func(t *testing.T) {
		config := protocol.Config{
			APIKey:          "invalid-key",
			BaseURL:         h.GetMockURL(),
			RefreshInterval: 0,
			Timeout:         5000,
		}
		cmd := protocol.NewInitCommand(config, nil)

		for _, svc := range h.GetServices() {
			resp, err := svc.SendCommand(tc.Ctx, cmd)
			require.NoError(t, err, "SendCommand should not fail")
			// SDK should either return an auth error or handle it gracefully
			// Different SDKs may handle this differently, so we just check it doesn't crash
			_ = resp
		}

		tc.CloseAllSDKs()
	})
}

// TestInitTimeout tests SDK initialization with timeout.
func TestInitTimeout(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	// This test requires a mock server that delays responses
	// For now, we just test that short timeout doesn't break the SDK
	config := protocol.Config{
		APIKey:          h.GetAPIKey(),
		BaseURL:         h.GetMockURL(),
		RefreshInterval: 0,
		Timeout:         100, // Very short timeout
	}
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err, "SendCommand should not fail for %s", svc.GetName())
		// Should succeed since mock responds immediately
		assert.False(t, resp.IsError(), "Init should succeed for %s", svc.GetName())
	}

	tc.CloseAllSDKs()
}

// TestDoubleInit tests calling init twice.
func TestDoubleInit(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	// First init
	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError())
	}

	// Second init (should work or be a no-op)
	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		// Second init might succeed or return an error, both are acceptable
		_ = resp
	}

	tc.CloseAllSDKs()
}

// TestCloseBeforeInit tests calling close before init.
func TestCloseBeforeInit(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	cmd := protocol.NewCloseCommand()

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		// Should not crash, might return error or success
		_ = resp
	}
}

// getHarness returns the shared test harness.
// This should be initialized in TestMain.
var testHarness *harness.Harness

func getHarness(t *testing.T) *harness.Harness {
	t.Helper()
	if testHarness == nil {
		t.Skip("Test harness not initialized. Run tests with -harness flag or set up services.")
	}
	return testHarness
}

// SetupHarness initializes the test harness for all tests.
// Call this from TestMain.
//
// Environment variables:
//   - EXTERNAL_SERVER_URL: Use real Rollgate server instead of mock (e.g., "http://localhost:3000")
//   - EXTERNAL_API_KEY: API key for external server (required if using EXTERNAL_SERVER_URL)
func SetupHarness(services map[string]string) (*harness.Harness, error) {
	cfg := harness.DefaultConfig()

	// Check for external server
	if externalURL := os.Getenv("EXTERNAL_SERVER_URL"); externalURL != "" {
		cfg.ExternalServerURL = externalURL
		if apiKey := os.Getenv("EXTERNAL_API_KEY"); apiKey != "" {
			cfg.APIKey = apiKey
		}
		log.Printf("Using external server: %s", externalURL)
	}

	h := harness.New(cfg)

	// Add services - browser-based SDKs use LaunchDarkly protocol
	// Note: sdk-react-native is NOT a browser SDK - it uses the standard protocol
	browserSDKs := []string{"sdk-browser", "sdk-react", "sdk-vue", "sdk-svelte", "sdk-angular"}
	for name, url := range services {
		isBrowser := false
		// Exclude sdk-react-native from browser detection (it's a mobile SDK)
		if name != "sdk-react-native" {
			for _, prefix := range browserSDKs {
				if strings.HasPrefix(name, prefix) {
					isBrowser = true
					break
				}
			}
		}
		if isBrowser {
			h.AddBrowserService(name, url)
		} else {
			h.AddService(name, url)
		}
	}

	// Start mock server (or verify external server)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := h.Start(ctx); err != nil {
		return nil, err
	}

	// Wait for services
	if err := h.WaitForServices(ctx, 30*time.Second); err != nil {
		h.Stop(context.Background())
		return nil, err
	}

	// Load default scenario (only for mock server)
	if !h.IsUsingExternalServer() {
		h.SetScenario("basic")
	}

	testHarness = h
	return h, nil
}

// TeardownHarness cleans up the test harness.
func TeardownHarness(h *harness.Harness) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h.Stop(ctx)
}
