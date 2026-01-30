package tests

import (
	"testing"

	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/require"
)

// TestIdentify tests user identification.
func TestIdentify(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// Setup targeting scenario
	h.SetScenario("targeting")

	t.Run("identify changes flag evaluation", func(t *testing.T) {
		// Init without user
		require.NoError(t, tc.InitAllSDKs(nil))

		// pro-only flag should be false without user context
		tc.AssertFlagValue("pro-only", false, false)

		// Identify as pro user
		proUser := protocol.UserContext{
			ID: "user-pro-1",
			Attributes: map[string]interface{}{
				"plan": "pro",
			},
		}
		require.NoError(t, tc.IdentifyUser(proUser))

		// Now pro-only should be true
		tc.AssertFlagValue("pro-only", true, false)

		tc.CloseAllSDKs()
	})

	t.Run("identify with different users", func(t *testing.T) {
		// Init with free user
		freeUser := &protocol.UserContext{
			ID: "user-free-1",
			Attributes: map[string]interface{}{
				"plan": "free",
			},
		}
		require.NoError(t, tc.InitAllSDKs(freeUser))

		// pro-only should be false for free user
		tc.AssertFlagValue("pro-only", false, false)

		// Change to pro user
		proUser := protocol.UserContext{
			ID: "user-pro-2",
			Attributes: map[string]interface{}{
				"plan": "pro",
			},
		}
		require.NoError(t, tc.IdentifyUser(proUser))

		// Now pro-only should be true
		tc.AssertFlagValue("pro-only", true, false)

		tc.CloseAllSDKs()
	})
}

// TestReset tests user context reset.
func TestReset(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("targeting")

	// Init with pro user
	proUser := &protocol.UserContext{
		ID: "user-pro-3",
		Attributes: map[string]interface{}{
			"plan": "pro",
		},
	}
	require.NoError(t, tc.InitAllSDKs(proUser))

	// pro-only should be true
	tc.AssertFlagValue("pro-only", true, false)

	// Reset user context
	require.NoError(t, tc.ResetUser())

	// pro-only should be false after reset
	tc.AssertFlagValue("pro-only", false, false)

	tc.CloseAllSDKs()
}

// TestTargetUsers tests specific user targeting.
func TestTargetUsers(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("targeting")

	t.Run("targeted user gets flag", func(t *testing.T) {
		vipUser := &protocol.UserContext{ID: "user-vip-1"}
		require.NoError(t, tc.InitAllSDKs(vipUser))

		// vip-feature targets specific users
		tc.AssertFlagValue("vip-feature", true, false)

		tc.CloseAllSDKs()
	})

	t.Run("non-targeted user does not get flag", func(t *testing.T) {
		regularUser := &protocol.UserContext{ID: "user-regular-1"}
		require.NoError(t, tc.InitAllSDKs(regularUser))

		// vip-feature should be false for non-targeted user
		tc.AssertFlagValue("vip-feature", false, false)

		tc.CloseAllSDKs()
	})
}

// TestAttributeTargeting tests attribute-based targeting.
func TestAttributeTargeting(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// Setup custom targeting rules
	h.GetMockServer().GetFlagStore().Clear()
	h.SetFlag(&mock.FlagState{
		Key:     "enterprise-only",
		Enabled: true,
		Rules: []mock.Rule{
			{
				ID:      "enterprise-rule",
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "plan", Operator: "eq", Value: "enterprise"},
				},
				RolloutPercentage: 100,
			},
		},
	})

	t.Run("enterprise user matches", func(t *testing.T) {
		user := &protocol.UserContext{
			ID:         "enterprise-user",
			Attributes: map[string]interface{}{"plan": "enterprise"},
		}
		require.NoError(t, tc.InitAllSDKs(user))
		tc.AssertFlagValue("enterprise-only", true, false)
		tc.CloseAllSDKs()
	})

	t.Run("free user does not match", func(t *testing.T) {
		user := &protocol.UserContext{
			ID:         "free-user",
			Attributes: map[string]interface{}{"plan": "free"},
		}
		require.NoError(t, tc.InitAllSDKs(user))
		tc.AssertFlagValue("enterprise-only", false, false)
		tc.CloseAllSDKs()
	})

	t.Run("user without attribute does not match", func(t *testing.T) {
		user := &protocol.UserContext{ID: "no-plan-user"}
		require.NoError(t, tc.InitAllSDKs(user))
		tc.AssertFlagValue("enterprise-only", false, false)
		tc.CloseAllSDKs()
	})
}

// TestMultipleConditions tests rules with multiple conditions (AND logic).
func TestMultipleConditions(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.GetMockServer().GetFlagStore().Clear()
	h.SetFlag(&mock.FlagState{
		Key:     "pro-beta-feature",
		Enabled: true,
		Rules: []mock.Rule{
			{
				ID:      "pro-beta-rule",
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "plan", Operator: "eq", Value: "pro"},
					{Attribute: "beta", Operator: "eq", Value: true},
				},
				RolloutPercentage: 100,
			},
		},
	})

	t.Run("user with both conditions matches", func(t *testing.T) {
		user := &protocol.UserContext{
			ID: "pro-beta-user",
			Attributes: map[string]interface{}{
				"plan": "pro",
				"beta": true,
			},
		}
		require.NoError(t, tc.InitAllSDKs(user))
		tc.AssertFlagValue("pro-beta-feature", true, false)
		tc.CloseAllSDKs()
	})

	t.Run("user with only plan does not match", func(t *testing.T) {
		user := &protocol.UserContext{
			ID: "pro-only-user",
			Attributes: map[string]interface{}{
				"plan": "pro",
				"beta": false,
			},
		}
		require.NoError(t, tc.InitAllSDKs(user))
		tc.AssertFlagValue("pro-beta-feature", false, false)
		tc.CloseAllSDKs()
	})

	t.Run("user with only beta does not match", func(t *testing.T) {
		user := &protocol.UserContext{
			ID: "beta-only-user",
			Attributes: map[string]interface{}{
				"plan": "free",
				"beta": true,
			},
		}
		require.NoError(t, tc.InitAllSDKs(user))
		tc.AssertFlagValue("pro-beta-feature", false, false)
		tc.CloseAllSDKs()
	})
}
