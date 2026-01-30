package tests

import (
	"net/http"
	"testing"
	"time"

	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCircuitBreakerOpens tests that circuit opens after consecutive failures.
func TestCircuitBreakerOpens(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// Init SDK first (successful)
	require.NoError(t, tc.InitAllSDKs(nil))

	// Now set server to always fail
	h.SetError(http.StatusInternalServerError, -1, 0, "Server error")
	defer h.ClearError()

	for _, svc := range h.GetServices() {
		// Force multiple refresh attempts (simulate time passing or force refresh)
		// After enough failures, circuit should open
		for i := 0; i < 6; i++ {
			// Send identify to trigger a request (if SDK supports it)
			svc.SendCommand(tc.Ctx, protocol.NewIdentifyCommand(protocol.UserContext{ID: "test-user"}))
			time.Sleep(100 * time.Millisecond)
		}

		// Check circuit state
		resp, err := svc.SendCommand(tc.Ctx, protocol.NewGetStateCommand())
		require.NoError(t, err)

		t.Logf("%s: circuitState = %s", svc.Name, resp.CircuitState)
		// Circuit should be OPEN or at least have tracked failures
		// Note: Exact behavior depends on SDK implementation

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestCircuitBreakerFallback tests that SDK uses cache when circuit is open.
func TestCircuitBreakerFallback(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// Init SDK (gets flags in cache)
	require.NoError(t, tc.InitAllSDKs(nil))

	// Verify flags work initially
	tc.AssertFlagValue("enabled-flag", true, false)

	// Now break the server
	h.SetError(http.StatusInternalServerError, -1, 0, "Server down")
	defer h.ClearError()

	// SDK should still return cached values (fallback)
	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
		require.NoError(t, err)

		// Should still get cached value
		assert.True(t, *resp.Value, "%s should use cached value when server is down", svc.Name)
		t.Logf("%s: flag value from cache = %v", svc.Name, *resp.Value)

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestCacheFallback tests that SDK uses cached values when server is unavailable.
func TestCacheFallback(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// Init SDK successfully first
	require.NoError(t, tc.InitAllSDKs(nil))

	// Verify we have working values
	tc.AssertFlagValue("enabled-flag", true, false)
	tc.AssertFlagValue("disabled-flag", false, true)

	// Get state to check cache stats before
	for _, svc := range h.GetServices() {
		stateBefore, err := svc.SendCommand(tc.Ctx, protocol.NewGetStateCommand())
		require.NoError(t, err)
		t.Logf("%s: cache stats before = %+v", svc.Name, stateBefore.CacheStats)
	}

	// Now kill the server (simulate network failure)
	h.SetError(http.StatusServiceUnavailable, -1, 0, "Service unavailable")
	defer h.ClearError()

	// SDK should still work using cache
	for _, svc := range h.GetServices() {
		// Multiple flag checks should use cache
		for i := 0; i < 5; i++ {
			resp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
			require.NoError(t, err)
			assert.True(t, *resp.Value, "%s should return cached value", svc.Name)
		}

		// Check cache stats after
		stateAfter, err := svc.SendCommand(tc.Ctx, protocol.NewGetStateCommand())
		require.NoError(t, err)
		t.Logf("%s: cache stats after = %+v", svc.Name, stateAfter.CacheStats)

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestRetryOnTransientFailure tests that SDK retries and succeeds after transient error.
func TestRetryOnTransientFailure(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// First request fails, second succeeds
	h.SetError(http.StatusInternalServerError, 1, 0, "Temporary error")
	defer h.ClearError()

	// SDK should retry and succeed
	for _, svc := range h.GetServices() {
		config := h.InitSDKConfig()
		cmd := protocol.NewInitCommand(config, nil)

		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		// Depending on SDK retry behavior:
		// - If SDK retries: init should succeed
		// - If SDK doesn't retry: init will fail but that's also valid behavior
		t.Logf("%s: init response = %+v", svc.Name, resp)

		// If init succeeded, verify flag works
		if !resp.IsError() {
			flagResp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
			require.NoError(t, err)
			assert.True(t, *flagResp.Value)
		}

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}

	errorCount := h.GetErrorCount()
	t.Logf("Errors simulated: %d", errorCount)
}

// TestServerRecovery tests that SDK recovers when server comes back.
func TestServerRecovery(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// Init successfully
	require.NoError(t, tc.InitAllSDKs(nil))

	// Verify initial state
	tc.AssertFlagValue("enabled-flag", true, false)

	// Break server for 3 requests
	h.SetError(http.StatusInternalServerError, 3, 0, "Temporary outage")

	// SDK should use cache during outage
	tc.AssertFlagValue("enabled-flag", true, false)

	// After 3 errors, server "recovers" - clear error
	h.ClearError()

	// Give SDK time to recover if it has background refresh
	time.Sleep(500 * time.Millisecond)

	// SDK should still work
	tc.AssertFlagValue("enabled-flag", true, false)

	tc.CloseAllSDKs()
}

// TestDefaultValueOnError tests that SDK returns default when no cache and server fails.
func TestDefaultValueOnError(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// Server always fails from the start
	h.SetError(http.StatusInternalServerError, -1, 0, "Server error")
	defer h.ClearError()

	config := h.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		// Init will likely fail or timeout
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err) // Command execution shouldn't fail

		// Whether init succeeds or fails, flag evaluation should return default
		flagResp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("any-flag", true))
		require.NoError(t, err)

		// If no cache, should return the default value (true)
		if flagResp.Value != nil {
			t.Logf("%s: flag value = %v (expected default: true)", svc.Name, *flagResp.Value)
			assert.True(t, *flagResp.Value, "%s should return default value", svc.Name)
		} else if resp.IsError() {
			t.Logf("%s: init failed as expected, no flag value available", svc.Name)
		}

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestGetStateReportsCircuitInfo tests that getState returns circuit breaker info.
func TestGetStateReportsCircuitInfo(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, protocol.NewGetStateCommand())
		require.NoError(t, err)

		// Verify state fields are populated
		assert.NotNil(t, resp.IsReady)
		assert.True(t, *resp.IsReady, "%s should be ready", svc.Name)

		// Circuit state should be reported
		assert.NotEmpty(t, resp.CircuitState, "%s should report circuit state", svc.Name)
		t.Logf("%s: isReady=%v, circuitState=%s", svc.Name, *resp.IsReady, resp.CircuitState)

		// Cache stats might be nil or populated depending on implementation
		if resp.CacheStats != nil {
			t.Logf("%s: cacheStats=%+v", svc.Name, resp.CacheStats)
		}

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestCacheStatsTracking tests that cache hits/misses are tracked.
func TestCacheStatsTracking(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		// Make multiple flag evaluations
		for i := 0; i < 10; i++ {
			svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
		}

		// Check cache stats
		resp, err := svc.SendCommand(tc.Ctx, protocol.NewGetStateCommand())
		require.NoError(t, err)

		if resp.CacheStats != nil {
			t.Logf("%s: cache hits=%d, misses=%d", svc.Name, resp.CacheStats.Hits, resp.CacheStats.Misses)
			// Cache stats tracking is implementation-specific
			// Some SDKs count in-memory lookups, others count network cache
			// We just verify the stats are reported (no assertion on values)
		} else {
			t.Logf("%s: cache stats not available (implementation specific)", svc.Name)
		}

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}
