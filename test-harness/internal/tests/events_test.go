package tests

import (
	"testing"
	"time"

	"github.com/rollgate/test-harness/internal/harness"
	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestTrackBasicEvent tests that a basic event is tracked with correct camelCase fields.
func TestTrackBasicEvent(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("track-basic", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedEvents()

		trackCmd := protocol.NewTrackCommand("test-flag", "purchase", "user-1")
		resp, err := svc.SendCommand(tc.Ctx, trackCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError(), "track should succeed: %s - %s", resp.Error, resp.Message)

		flushCmd := protocol.NewFlushEventsCommand()
		resp, err = svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError(), "flushEvents should succeed: %s - %s", resp.Error, resp.Message)

		// Allow async flush to complete
		time.Sleep(500 * time.Millisecond)

		events := h.GetReceivedEvents()
		require.GreaterOrEqual(t, len(events), 1, "mock should have received at least 1 event")
		assert.Equal(t, "test-flag", events[0].FlagKey, "flagKey should be camelCase")
		assert.Equal(t, "purchase", events[0].EventName, "eventName should be camelCase")
		assert.Equal(t, "user-1", events[0].UserID, "userId should be camelCase")
	})
}

// TestTrackEventWithVariation tests tracking with a variationId.
func TestTrackEventWithVariation(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("track-variation", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedEvents()

		trackCmd := protocol.NewTrackCommandFull("ab-flag", "click", "user-2", "var-control", nil, nil)
		resp, err := svc.SendCommand(tc.Ctx, trackCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError())

		flushCmd := protocol.NewFlushEventsCommand()
		_, err = svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)

		time.Sleep(500 * time.Millisecond)

		events := h.GetReceivedEvents()
		require.GreaterOrEqual(t, len(events), 1)
		assert.Equal(t, "ab-flag", events[0].FlagKey)
		assert.Equal(t, "click", events[0].EventName)
		assert.Equal(t, "user-2", events[0].UserID)
		assert.Equal(t, "var-control", events[0].VariationID, "variationId should be camelCase")
	})
}

// TestTrackEventWithValue tests tracking with a numeric value.
func TestTrackEventWithValue(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("track-value", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedEvents()

		val := 42.5
		trackCmd := protocol.NewTrackCommandFull("revenue-flag", "purchase", "user-3", "", &val, nil)
		resp, err := svc.SendCommand(tc.Ctx, trackCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError())

		flushCmd := protocol.NewFlushEventsCommand()
		_, err = svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)

		time.Sleep(500 * time.Millisecond)

		events := h.GetReceivedEvents()
		require.GreaterOrEqual(t, len(events), 1)
		assert.Equal(t, "revenue-flag", events[0].FlagKey)
		assert.Equal(t, "purchase", events[0].EventName)
		require.NotNil(t, events[0].Value)
		assert.InDelta(t, 42.5, *events[0].Value, 0.01)
	})
}

// TestTrackEventWithMetadata tests tracking with metadata.
func TestTrackEventWithMetadata(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("track-metadata", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedEvents()

		meta := map[string]interface{}{
			"plan":   "pro",
			"source": "checkout",
		}
		trackCmd := protocol.NewTrackCommandFull("upgrade-flag", "upgrade", "user-4", "", nil, meta)
		resp, err := svc.SendCommand(tc.Ctx, trackCmd)
		require.NoError(t, err)
		assert.False(t, resp.IsError())

		flushCmd := protocol.NewFlushEventsCommand()
		_, err = svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)

		time.Sleep(500 * time.Millisecond)

		events := h.GetReceivedEvents()
		require.GreaterOrEqual(t, len(events), 1)
		assert.Equal(t, "upgrade-flag", events[0].FlagKey)
		require.NotNil(t, events[0].Metadata)
		assert.Equal(t, "pro", events[0].Metadata["plan"])
		assert.Equal(t, "checkout", events[0].Metadata["source"])
	})
}

// TestTrackMultipleEvents tests tracking multiple events in a batch.
func TestTrackMultipleEvents(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	tc.RunForEachSDK("track-multiple", func(t *testing.T, svc harness.SDKService) {
		h.ClearReceivedEvents()

		// Track 3 events
		for i, name := range []string{"view", "click", "purchase"} {
			trackCmd := protocol.NewTrackCommand("multi-flag", name, "user-5")
			resp, err := svc.SendCommand(tc.Ctx, trackCmd)
			require.NoError(t, err, "track event %d failed", i)
			assert.False(t, resp.IsError())
		}

		flushCmd := protocol.NewFlushEventsCommand()
		_, err := svc.SendCommand(tc.Ctx, flushCmd)
		require.NoError(t, err)

		time.Sleep(500 * time.Millisecond)

		events := h.GetReceivedEvents()
		require.GreaterOrEqual(t, len(events), 3, "mock should have received at least 3 events")

		// Verify all events have correct flagKey and userId
		eventNames := make([]string, 0, len(events))
		for _, ev := range events {
			assert.Equal(t, "multi-flag", ev.FlagKey)
			assert.Equal(t, "user-5", ev.UserID)
			eventNames = append(eventNames, ev.EventName)
		}
		assert.Contains(t, eventNames, "view")
		assert.Contains(t, eventNames, "click")
		assert.Contains(t, eventNames, "purchase")
	})
}
