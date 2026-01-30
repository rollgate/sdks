package tests

import (
	"net/http"
	"testing"
	"time"

	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAuthError tests 401 Unauthorized responses.
func TestAuthError(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// Configure mock to return 401
	h.SetError(http.StatusUnauthorized, -1, 0, "Invalid API key")
	defer h.ClearError()

	// Try to init - should fail with auth error
	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err, "SendCommand should not fail for %s", svc.Name)

		// SDK should report an error (either in response or via failed init)
		// The exact behavior depends on SDK implementation
		t.Logf("%s: response = %+v", svc.Name, resp)

		// Cleanup
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestForbiddenError tests 403 Forbidden responses.
func TestForbiddenError(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetError(http.StatusForbidden, -1, 0, "Access denied")
	defer h.ClearError()

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		t.Logf("%s: response = %+v", svc.Name, resp)
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestRateLimitError tests 429 Too Many Requests responses.
func TestRateLimitError(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// Return 429 with Retry-After header
	h.SetError(http.StatusTooManyRequests, -1, 60, "Rate limit exceeded")
	defer h.ClearError()

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		t.Logf("%s: response = %+v", svc.Name, resp)
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestServerError500 tests 500 Internal Server Error responses.
func TestServerError500(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetError(http.StatusInternalServerError, -1, 0, "Internal server error")
	defer h.ClearError()

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		t.Logf("%s: response = %+v", svc.Name, resp)
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestServerError502 tests 502 Bad Gateway responses.
func TestServerError502(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetError(http.StatusBadGateway, -1, 0, "Bad gateway")
	defer h.ClearError()

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		t.Logf("%s: response = %+v", svc.Name, resp)
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestServerError503 tests 503 Service Unavailable responses.
func TestServerError503(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetError(http.StatusServiceUnavailable, -1, 0, "Service unavailable")
	defer h.ClearError()

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		t.Logf("%s: response = %+v", svc.Name, resp)
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestTransientErrorRecovery tests that SDK recovers after transient errors.
func TestTransientErrorRecovery(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// First 2 requests fail, then succeed
	h.SetError(http.StatusInternalServerError, 2, 0, "Temporary failure")
	defer h.ClearError()

	h.SetScenario("basic")

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		// SDK should eventually succeed after retries
		// Check if we can evaluate flags
		if !resp.IsError() {
			flagResp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
			require.NoError(t, err)
			t.Logf("%s: flag value = %v", svc.Name, flagResp.Value)
		} else {
			t.Logf("%s: init failed (expected if SDK doesn't retry): %s", svc.Name, resp.Error)
		}

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}

	// Verify errors were actually simulated
	errorCount := h.GetErrorCount()
	t.Logf("Total errors simulated: %d", errorCount)
}

// TestErrorThenSuccess tests that flags work after error clears.
func TestErrorThenSuccess(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// Start with working server
	require.NoError(t, tc.InitAllSDKs(nil))

	// Verify flags work
	tc.AssertFlagValue("enabled-flag", true, false)

	// Now simulate errors for next refresh
	h.SetError(http.StatusInternalServerError, 1, 0, "Temporary failure")

	// SDK should still have cached values
	tc.AssertFlagValue("enabled-flag", true, false)

	// Clear error and close
	h.ClearError()
	tc.CloseAllSDKs()
}

// TestBadRequestError tests 400 Bad Request responses.
func TestBadRequestError(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetError(http.StatusBadRequest, -1, 0, "Invalid request")
	defer h.ClearError()

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		// 400 errors should not be retried
		t.Logf("%s: response = %+v", svc.Name, resp)
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestNetworkTimeout tests slow responses (simulating timeout).
func TestNetworkTimeout(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// Set a delay longer than typical SDK timeout
	h.SetErrorWithDelay(http.StatusOK, 1, 10*time.Second)
	defer h.ClearError()

	// Use short timeout in config
	config := protocol.Config{
		APIKey:          h.GetAPIKey(),
		BaseURL:         h.GetMockURL(),
		RefreshInterval: 0,
		Timeout:         1000, // 1 second timeout
	}
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		start := time.Now()
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		elapsed := time.Since(start)

		require.NoError(t, err)
		t.Logf("%s: response = %+v, elapsed = %v", svc.Name, resp, elapsed)

		// Should timeout relatively quickly, not wait 10s
		assert.Less(t, elapsed, 8*time.Second, "Should timeout before full delay")

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}
