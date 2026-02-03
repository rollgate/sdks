package tests

import (
	"testing"

	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFlagEvaluation tests basic flag evaluation.
func TestFlagEvaluation(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// Load basic scenario
	h.SetScenario("basic")

	// Initialize all SDKs
	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	scenarios := []struct {
		name         string
		flagKey      string
		defaultValue bool
		expected     bool
	}{
		{"enabled flag returns true", "enabled-flag", false, true},
		{"disabled flag returns false", "disabled-flag", true, false},
		{"missing flag returns default true", "missing-flag", true, true},
		{"missing flag returns default false", "missing-flag", false, false},
	}

	for _, sc := range scenarios {
		t.Run(sc.name, func(t *testing.T) {
			tc.AssertFlagValue(sc.flagKey, sc.expected, sc.defaultValue)
		})
	}
}

// TestGetAllFlags tests getting all flags.
func TestGetAllFlags(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	// Set specific flags
	h.GetMockServer().GetFlagStore().Clear()
	h.SetFlag(&mock.FlagState{Key: "flag-a", Enabled: true, RolloutPercentage: 100})
	h.SetFlag(&mock.FlagState{Key: "flag-b", Enabled: false})
	h.SetFlag(&mock.FlagState{Key: "flag-c", Enabled: true, RolloutPercentage: 100})

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	expected := map[string]bool{
		"flag-a": true,
		"flag-b": false,
		"flag-c": true,
	}

	tc.AssertAllFlags(expected)
}

// TestRollout tests percentage rollout.
func TestRollout(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("rollout")

	t.Run("rollout 0% returns false", func(t *testing.T) {
		user := &protocol.UserContext{ID: "user-test-1"}
		require.NoError(t, tc.InitAllSDKs(user))
		tc.AssertFlagValue("rollout-0", false, false)
		tc.CloseAllSDKs()
	})

	t.Run("rollout 100% returns true", func(t *testing.T) {
		user := &protocol.UserContext{ID: "user-test-2"}
		require.NoError(t, tc.InitAllSDKs(user))
		tc.AssertFlagValue("rollout-100", true, false)
		tc.CloseAllSDKs()
	})
}

// TestConsistentHashing tests that the same user gets the same result.
func TestConsistentHashing(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("rollout")

	// Use a user that should get consistent results
	user := &protocol.UserContext{ID: "consistent-user-123"}
	require.NoError(t, tc.InitAllSDKs(user))
	defer tc.CloseAllSDKs()

	// Get the value for 50% rollout
	cmd := protocol.NewIsEnabledCommand("rollout-50", false)

	var firstResult *bool
	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		require.False(t, resp.IsError())
		require.NotNil(t, resp.Value)

		if firstResult == nil {
			firstResult = resp.Value
		} else {
			// All SDKs should return the same value for the same user
			assert.Equal(t, *firstResult, *resp.Value,
				"Consistent hashing: all SDKs should return same value for same user")
		}
	}

	// Verify multiple evaluations return the same result (consistency)
	for i := 0; i < 5; i++ {
		for _, svc := range h.GetServices() {
			resp, err := svc.SendCommand(tc.Ctx, cmd)
			require.NoError(t, err)
			assert.Equal(t, *firstResult, *resp.Value,
				"%s: evaluation %d should be consistent", svc.GetName(), i)
		}
	}
}

// TestFlagTypes tests different flag scenarios.
func TestFlagTypes(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	// Setup custom flags
	h.GetMockServer().GetFlagStore().Clear()

	t.Run("boolean flag enabled", func(t *testing.T) {
		h.SetFlag(&mock.FlagState{Key: "bool-true", Enabled: true, RolloutPercentage: 100})
		h.SetFlag(&mock.FlagState{Key: "bool-false", Enabled: false})

		require.NoError(t, tc.InitAllSDKs(nil))

		tc.AssertFlagValue("bool-true", true, false)
		tc.AssertFlagValue("bool-false", false, true)

		tc.CloseAllSDKs()
	})
}

// TestEmptyFlags tests behavior with no flags.
func TestEmptyFlags(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("empty")

	require.NoError(t, tc.InitAllSDKs(nil))
	defer tc.CloseAllSDKs()

	// Getting all flags should return empty map
	cmd := protocol.NewGetAllFlagsCommand()
	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)
		assert.Empty(t, resp.Flags, "%s should have no flags", svc.GetName())
	}

	// Any flag should return default
	tc.AssertFlagValue("nonexistent", false, false)
	tc.AssertFlagValue("also-nonexistent", true, true)
}
