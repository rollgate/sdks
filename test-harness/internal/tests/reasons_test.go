package tests

import (
	"testing"

	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestReasonFallthrough tests that existing flags return FALLTHROUGH reason.
func TestReasonFallthrough(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	cmd := protocol.NewIsEnabledDetailCommand("enabled-flag", false)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err, "%s should not error", svc.GetName())
		require.False(t, resp.IsError(), "%s response should not be error: %s", svc.GetName(), resp.Error)
		require.NotNil(t, resp.Value, "%s should return a value", svc.GetName())
		require.NotNil(t, resp.Reason, "%s should return a reason", svc.GetName())

		assert.True(t, *resp.Value, "%s: enabled-flag should be true", svc.GetName())
		assert.Equal(t, "FALLTHROUGH", resp.Reason.Kind, "%s: reason should be FALLTHROUGH", svc.GetName())
	}
}

// TestReasonUnknown tests that non-existent flags return UNKNOWN reason.
func TestReasonUnknown(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	cmd := protocol.NewIsEnabledDetailCommand("non-existent-flag", false)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err, "%s should not error", svc.GetName())
		require.False(t, resp.IsError(), "%s response should not be error: %s", svc.GetName(), resp.Error)
		require.NotNil(t, resp.Value, "%s should return a value", svc.GetName())
		require.NotNil(t, resp.Reason, "%s should return a reason", svc.GetName())

		assert.False(t, *resp.Value, "%s: non-existent flag should return default false", svc.GetName())
		assert.Equal(t, "UNKNOWN", resp.Reason.Kind, "%s: reason should be UNKNOWN", svc.GetName())
	}
}

// TestReasonOff tests that disabled flags return OFF reason.
func TestReasonOff(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.GetMockServer().GetFlagStore().Clear()
	h.SetFlag(&mock.FlagState{Key: "disabled-flag", Enabled: false})

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	cmd := protocol.NewIsEnabledDetailCommand("disabled-flag", true)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err, "%s should not error", svc.GetName())
		require.False(t, resp.IsError(), "%s response should not be error: %s", svc.GetName(), resp.Error)
		require.NotNil(t, resp.Value, "%s should return a value", svc.GetName())
		require.NotNil(t, resp.Reason, "%s should return a reason", svc.GetName())

		assert.False(t, *resp.Value, "%s: disabled flag should be false", svc.GetName())
		// OFF or FALLTHROUGH are both acceptable for disabled flags
		assert.Contains(t, []string{"OFF", "FALLTHROUGH"}, resp.Reason.Kind,
			"%s: reason should be OFF or FALLTHROUGH for disabled flag", svc.GetName())
	}
}

// TestReasonTargetMatch tests that targeted users get TARGET_MATCH reason.
func TestReasonTargetMatch(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.GetMockServer().GetFlagStore().Clear()
	h.SetFlag(&mock.FlagState{
		Key:               "targeted-flag",
		Enabled:           true,
		RolloutPercentage: 0, // Would be false without targeting
		TargetUsers:       []string{"target-user-123"},
	})

	user := &protocol.UserContext{ID: "target-user-123"}
	require.NoError(t, tc.InitAllSDKs(user))
	defer tc.CloseAllSDKs()

	cmd := protocol.NewIsEnabledDetailCommand("targeted-flag", false)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err, "%s should not error", svc.GetName())
		require.False(t, resp.IsError(), "%s response should not be error: %s", svc.GetName(), resp.Error)
		require.NotNil(t, resp.Value, "%s should return a value", svc.GetName())
		require.NotNil(t, resp.Reason, "%s should return a reason", svc.GetName())

		assert.True(t, *resp.Value, "%s: targeted user should get true", svc.GetName())
		// TARGET_MATCH or FALLTHROUGH are acceptable (depends on server-side vs client-side evaluation)
		assert.Contains(t, []string{"TARGET_MATCH", "FALLTHROUGH"}, resp.Reason.Kind,
			"%s: reason should be TARGET_MATCH or FALLTHROUGH", svc.GetName())
	}
}

// TestReasonValueConsistency tests that isEnabledDetail returns same value as isEnabled.
func TestReasonValueConsistency(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	flags := []string{"enabled-flag", "disabled-flag", "non-existent-flag"}

	for _, flagKey := range flags {
		t.Run(flagKey, func(t *testing.T) {
			cmdEnabled := protocol.NewIsEnabledCommand(flagKey, false)
			cmdDetail := protocol.NewIsEnabledDetailCommand(flagKey, false)

			for _, svc := range h.GetServices() {
				respEnabled, err := svc.SendCommand(tc.Ctx, cmdEnabled)
				require.NoError(t, err)

				respDetail, err := svc.SendCommand(tc.Ctx, cmdDetail)
				require.NoError(t, err)

				// Both should return the same value
				if respEnabled.Value != nil && respDetail.Value != nil {
					assert.Equal(t, *respEnabled.Value, *respDetail.Value,
						"%s: isEnabled and isEnabledDetail should return same value for %s",
						svc.GetName(), flagKey)
				}

				// Detail should always have a reason
				assert.NotNil(t, respDetail.Reason,
					"%s: isEnabledDetail should always return a reason for %s",
					svc.GetName(), flagKey)
			}
		})
	}
}

// TestReasonHasKind tests that all reasons have a valid kind.
func TestReasonHasKind(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	validKinds := []string{"OFF", "TARGET_MATCH", "RULE_MATCH", "FALLTHROUGH", "ERROR", "UNKNOWN"}

	cmd := protocol.NewIsEnabledDetailCommand("enabled-flag", false)

	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err, "%s should not error", svc.GetName())
		require.NotNil(t, resp.Reason, "%s should return a reason", svc.GetName())

		assert.Contains(t, validKinds, resp.Reason.Kind,
			"%s: reason kind %q should be one of %v", svc.GetName(), resp.Reason.Kind, validKinds)
	}
}
