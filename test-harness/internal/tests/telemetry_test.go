package tests

import (
	"testing"
	"time"

	"github.com/rollgate/test-harness/internal/harness"
	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// waitForTelemetry polls the mock server for received telemetry payloads
// with retries, returning the payloads once at least one is received.
func waitForTelemetry(h *harness.Harness, timeout time.Duration) []mock.TelemetryPayload {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		telemetry := h.GetReceivedTelemetry()
		if len(telemetry) > 0 {
			return telemetry
		}
		time.Sleep(100 * time.Millisecond)
	}
	return h.GetReceivedTelemetry()
}

// TestTelemetryBasicFlush tests that evaluations are flushed to the server.
func TestTelemetryBasicFlush(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("telemetry-basic-flush", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedTelemetry()

		// Evaluate a flag
		cmd := protocol.NewIsEnabledCommand("enabled-flag", false)
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError(), "isEnabled should succeed: %s - %s", resp.Error, resp.Message)

		// Flush telemetry
		flushCmd := protocol.NewFlushTelemetryCommand()
		resp, err = svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError(), "flushTelemetry should succeed: %s - %s", resp.Error, resp.Message)

		// Wait for telemetry with polling
		telemetry := waitForTelemetry(h, 3*time.Second)
		require.GreaterOrEqual(t, len(telemetry), 1, "mock should have received at least 1 telemetry payload")

		// Find our flag in any payload
		found := false
		for _, payload := range telemetry {
			if stats, ok := payload.Evaluations["enabled-flag"]; ok {
				found = true
				assert.GreaterOrEqual(t, stats.Total, 1, "total should be >= 1")
				break
			}
		}
		assert.True(t, found, "enabled-flag should be in telemetry payload")
	})
}

// TestTelemetryAggregation tests that multiple evaluations of the same flag are aggregated.
func TestTelemetryAggregation(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("telemetry-aggregation", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedTelemetry()

		// Evaluate enabled-flag 7 times (should be true)
		for i := 0; i < 7; i++ {
			cmd := protocol.NewIsEnabledCommand("enabled-flag", false)
			_, err := svc.SendCommand(tc.Ctx, cmd)
			require.NoError(t, err)
		}

		// Evaluate disabled-flag 3 times (should be false)
		for i := 0; i < 3; i++ {
			cmd := protocol.NewIsEnabledCommand("disabled-flag", false)
			_, err := svc.SendCommand(tc.Ctx, cmd)
			require.NoError(t, err)
		}

		// Flush telemetry
		flushCmd := protocol.NewFlushTelemetryCommand()
		resp, err := svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError(), "flushTelemetry should succeed: %s - %s", resp.Error, resp.Message)

		// Wait for telemetry with polling
		telemetry := waitForTelemetry(h, 3*time.Second)
		require.GreaterOrEqual(t, len(telemetry), 1, "should have received telemetry")

		// Aggregate stats across all payloads
		enabledTotal := 0
		enabledTrue := 0
		enabledFalse := 0
		disabledTotal := 0
		disabledTrue := 0
		disabledFalse := 0

		for _, payload := range telemetry {
			if stats, ok := payload.Evaluations["enabled-flag"]; ok {
				enabledTotal += stats.Total
				enabledTrue += stats.True
				enabledFalse += stats.False
			}
			if stats, ok := payload.Evaluations["disabled-flag"]; ok {
				disabledTotal += stats.Total
				disabledTrue += stats.True
				disabledFalse += stats.False
			}
		}

		assert.Equal(t, 7, enabledTotal, "enabled-flag total should be 7")
		assert.Equal(t, 7, enabledTrue, "enabled-flag true should be 7")
		assert.Equal(t, 0, enabledFalse, "enabled-flag false should be 0")

		assert.Equal(t, 3, disabledTotal, "disabled-flag total should be 3")
		assert.Equal(t, 0, disabledTrue, "disabled-flag true should be 0")
		assert.Equal(t, 3, disabledFalse, "disabled-flag false should be 3")
	})
}

// TestTelemetryMultipleFlags tests that multiple flags are tracked.
func TestTelemetryMultipleFlags(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("telemetry-multiple-flags", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedTelemetry()

		// Evaluate multiple flags
		flags := []string{"enabled-flag", "disabled-flag"}
		for _, flagKey := range flags {
			cmd := protocol.NewIsEnabledCommand(flagKey, false)
			_, err := svc.SendCommand(tc.Ctx, cmd)
			require.NoError(t, err)
		}

		// Flush telemetry
		flushCmd := protocol.NewFlushTelemetryCommand()
		resp, err := svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError())

		// Wait for telemetry with polling
		telemetry := waitForTelemetry(h, 3*time.Second)
		require.GreaterOrEqual(t, len(telemetry), 1, "should have received telemetry")

		// Collect all flag keys from all payloads
		seenFlags := make(map[string]bool)
		for _, payload := range telemetry {
			for key := range payload.Evaluations {
				seenFlags[key] = true
			}
		}

		for _, flagKey := range flags {
			assert.True(t, seenFlags[flagKey], "flag %q should be in telemetry", flagKey)
		}
	})
}

// TestTelemetryPeriodMs tests that period_ms is positive.
func TestTelemetryPeriodMs(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("telemetry-period-ms", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedTelemetry()

		// Evaluate a flag
		cmd := protocol.NewIsEnabledCommand("enabled-flag", false)
		_, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		// Flush telemetry
		flushCmd := protocol.NewFlushTelemetryCommand()
		resp, err := svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError())

		// Wait for telemetry with polling
		telemetry := waitForTelemetry(h, 3*time.Second)
		require.GreaterOrEqual(t, len(telemetry), 1, "should have received telemetry")

		assert.GreaterOrEqual(t, telemetry[0].PeriodMs, 0, "period_ms should be >= 0")
	})
}
