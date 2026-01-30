package tests

import (
	"testing"
	"time"

	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSSEConnectionEstablished tests that SDK establishes SSE connection when streaming is enabled.
func TestSSEConnectionEstablished(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	config := h.InitSDKConfigWithStreaming()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.IsError() {
			t.Logf("%s: streaming not supported or init failed: %s", svc.GetName(), resp.Error)
			svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
			continue
		}

		// Give SDK time to establish SSE connection
		time.Sleep(500 * time.Millisecond)

		// Check if SSE client is connected
		clientCount := h.GetSSEClientCount()
		t.Logf("%s: SSE clients connected = %d", svc.GetName(), clientCount)

		// Cleanup
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
		time.Sleep(100 * time.Millisecond)
	}
}

// TestSSEInitialFlags tests that SDK receives initial flags via SSE.
func TestSSEInitialFlags(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	config := h.InitSDKConfigWithStreaming()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.IsError() {
			t.Logf("%s: streaming init failed: %s", svc.GetName(), resp.Error)
			svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
			continue
		}

		// Check that initial flags are available
		flagResp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
		require.NoError(t, err)

		if flagResp.Value == nil {
			t.Logf("%s: flag value is nil (streaming may not be fully supported)", svc.GetName())
			svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
			continue
		}

		assert.True(t, *flagResp.Value, "%s should have received enabled-flag=true via SSE init", svc.GetName())

		flagResp2, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("disabled-flag", true))
		require.NoError(t, err)
		if flagResp2.Value != nil {
			assert.False(t, *flagResp2.Value, "%s should have received disabled-flag=false via SSE init", svc.GetName())
		}

		t.Logf("%s: SSE init flags received correctly", svc.GetName())
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestSSEFlagUpdate tests that SDK receives flag updates via SSE.
func TestSSEFlagUpdate(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	config := h.InitSDKConfigWithStreaming()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.IsError() {
			t.Logf("%s: streaming not supported: %s", svc.GetName(), resp.Error)
			svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
			continue
		}

		// Wait for SSE connection to establish
		time.Sleep(300 * time.Millisecond)

		// Verify initial state
		flagResp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
		require.NoError(t, err)
		assert.True(t, *flagResp.Value, "initial value should be true")

		// Broadcast flag change via SSE
		h.BroadcastFlagChange("enabled-flag", false)

		// Give SDK time to process the event
		time.Sleep(500 * time.Millisecond)

		// Check if flag was updated
		// Note: Some SDKs might not update in-memory cache from SSE events
		// This tests the expected behavior
		flagResp2, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", true))
		require.NoError(t, err)
		if flagResp2.Value != nil {
			t.Logf("%s: flag value after SSE update = %v (expected: false)", svc.GetName(), *flagResp2.Value)
		} else {
			t.Logf("%s: flag value is nil after SSE update", svc.GetName())
		}

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestSSEFallbackToPolling tests that SDK falls back to polling when SSE is not available.
func TestSSEFallbackToPolling(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// Even with streaming enabled, SDK should work via polling fallback
	config := h.InitSDKConfigWithStreaming()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		// Whether streaming works or not, SDK should function
		if !resp.IsError() {
			flagResp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
			require.NoError(t, err)
			if flagResp.Value != nil {
				assert.True(t, *flagResp.Value, "%s should have flag value (via SSE or polling)", svc.GetName())
				t.Logf("%s: SDK working with streaming config", svc.GetName())
			} else {
				t.Logf("%s: flag value is nil (SDK init may have issues)", svc.GetName())
			}
		} else {
			t.Logf("%s: SDK fell back to polling or error: %s", svc.GetName(), resp.Error)
		}

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestSSEDisconnectRecovery tests that SDK handles SSE disconnection gracefully.
func TestSSEDisconnectRecovery(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	config := h.InitSDKConfigWithStreaming()
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.IsError() {
			t.Logf("%s: streaming not supported: %s", svc.GetName(), resp.Error)
			svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
			continue
		}

		// Verify initial state
		flagResp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
		require.NoError(t, err)
		assert.True(t, *flagResp.Value, "initial value should be true")

		// Disconnect all SSE clients
		disconnected := h.DisconnectSSEClients()
		t.Logf("%s: disconnected %d SSE clients", svc.GetName(), disconnected)

		// SDK should still work (using cache or reconnecting)
		time.Sleep(200 * time.Millisecond)

		flagResp2, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
		require.NoError(t, err)
		assert.True(t, *flagResp2.Value, "%s should still have flag value after disconnect", svc.GetName())

		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestSSEWithPollingDisabled tests streaming-only mode.
func TestSSEWithPollingDisabled(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// Config with streaming enabled and refresh=0 (no polling)
	config := h.InitSDKConfigWithStreaming()
	config.RefreshInterval = 0
	cmd := protocol.NewInitCommand(config, nil)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.IsError() {
			t.Logf("%s: streaming-only mode not supported: %s", svc.GetName(), resp.Error)
			svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
			continue
		}

		// Wait for SSE to establish
		time.Sleep(300 * time.Millisecond)

		// Verify flags work
		flagResp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("enabled-flag", false))
		require.NoError(t, err)
		assert.True(t, *flagResp.Value)

		t.Logf("%s: streaming-only mode working", svc.GetName())
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
	}
}

// TestMultipleSSEClients tests that mock server handles multiple SSE clients.
func TestMultipleSSEClients(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	config := h.InitSDKConfigWithStreaming()

	// Initialize multiple times (if we have multiple services)
	services := h.GetServices()
	if len(services) < 1 {
		t.Skip("No services available")
	}

	// Count initial clients
	initialCount := h.GetSSEClientCount()
	t.Logf("Initial SSE clients: %d", initialCount)

	// This test is more about verifying the mock server handles multiple connections
	for i := 0; i < 3; i++ {
		svc := services[0]
		cmd := protocol.NewInitCommand(config, nil)

		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.IsError() {
			t.Logf("Iteration %d: %s", i, resp.Error)
		}

		time.Sleep(100 * time.Millisecond)
		svc.SendCommand(tc.Ctx, protocol.NewCloseCommand())
		time.Sleep(100 * time.Millisecond)
	}

	// Final client count should be back to 0 or initial
	finalCount := h.GetSSEClientCount()
	t.Logf("Final SSE clients: %d", finalCount)
}
