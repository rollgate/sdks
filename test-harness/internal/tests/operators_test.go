package tests

import (
	"testing"

	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/require"
)

// TestOperatorEq tests the "eq" (equals) operator.
func TestOperatorEq(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	// Set flag with eq operator
	h.SetFlag(&mock.FlagState{
		Key:     "eq-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "plan", Operator: "eq", Value: "pro"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with plan=pro should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"plan": "pro"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("eq-test", true, false)
	tc.CloseAllSDKs()

	// User with plan=free should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"plan": "free"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("eq-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorNeq tests the "neq" (not equals) operator.
func TestOperatorNeq(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "neq-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "plan", Operator: "neq", Value: "free"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with plan=pro should match (plan != free)
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"plan": "pro"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("neq-test", true, false)
	tc.CloseAllSDKs()

	// User with plan=free should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"plan": "free"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("neq-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorContains tests the "contains" operator.
func TestOperatorContains(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "contains-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "email", Operator: "contains", Value: "@company.com"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with company email should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Email:      "john@company.com",
		Attributes: map[string]interface{}{"email": "john@company.com"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("contains-test", true, false)
	tc.CloseAllSDKs()

	// User with different email should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Email:      "john@gmail.com",
		Attributes: map[string]interface{}{"email": "john@gmail.com"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("contains-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorStartsWith tests the "starts_with" operator.
func TestOperatorStartsWith(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "starts-with-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "email", Operator: "starts_with", Value: "admin"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with admin email should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"email": "admin@company.com"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("starts-with-test", true, false)
	tc.CloseAllSDKs()

	// User with different email should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"email": "john@company.com"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("starts-with-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorEndsWith tests the "ends_with" operator.
func TestOperatorEndsWith(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "ends-with-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "email", Operator: "ends_with", Value: ".io"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with .io email should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"email": "john@company.io"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("ends-with-test", true, false)
	tc.CloseAllSDKs()

	// User with .com email should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"email": "john@company.com"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("ends-with-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorGt tests the "gt" (greater than) operator.
func TestOperatorGt(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "gt-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "age", Operator: "gt", Value: 18},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with age > 18 should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"age": 21},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("gt-test", true, false)
	tc.CloseAllSDKs()

	// User with age = 18 should not match (gt, not gte)
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"age": 18},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("gt-test", false, true)
	tc.CloseAllSDKs()

	// User with age < 18 should not match
	user3 := &protocol.UserContext{
		ID:         "user-3",
		Attributes: map[string]interface{}{"age": 16},
	}
	require.NoError(t, tc.InitAllSDKs(user3))
	tc.AssertFlagValue("gt-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorLte tests the "lte" (less than or equal) operator.
func TestOperatorLte(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "lte-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "attempts", Operator: "lte", Value: 3},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with attempts <= 3 should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"attempts": 2},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("lte-test", true, false)
	tc.CloseAllSDKs()

	// User with attempts = 3 should match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"attempts": 3},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("lte-test", true, false)
	tc.CloseAllSDKs()

	// User with attempts > 3 should not match
	user3 := &protocol.UserContext{
		ID:         "user-3",
		Attributes: map[string]interface{}{"attempts": 5},
	}
	require.NoError(t, tc.InitAllSDKs(user3))
	tc.AssertFlagValue("lte-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorIn tests the "in" operator.
func TestOperatorIn(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "in-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "country", Operator: "in", Value: []interface{}{"IT", "US", "UK"}},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User in allowed country should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"country": "IT"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("in-test", true, false)
	tc.CloseAllSDKs()

	// User in different country should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"country": "DE"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("in-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorNotIn tests the "not_in" operator.
func TestOperatorNotIn(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "not-in-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "role", Operator: "not_in", Value: []interface{}{"banned", "suspended"}},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User not in banned list should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"role": "user"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("not-in-test", true, false)
	tc.CloseAllSDKs()

	// Banned user should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"role": "banned"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("not-in-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorRegex tests the "regex" operator.
func TestOperatorRegex(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "regex-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "email", Operator: "regex", Value: `.*@(gmail|yahoo)\.com`},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with gmail should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"email": "john@gmail.com"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("regex-test", true, false)
	tc.CloseAllSDKs()

	// User with yahoo should match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"email": "jane@yahoo.com"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("regex-test", true, false)
	tc.CloseAllSDKs()

	// User with other email should not match
	user3 := &protocol.UserContext{
		ID:         "user-3",
		Attributes: map[string]interface{}{"email": "john@company.com"},
	}
	require.NoError(t, tc.InitAllSDKs(user3))
	tc.AssertFlagValue("regex-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorSemverGt tests the "semver_gt" operator.
func TestOperatorSemverGt(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "semver-gt-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "appVersion", Operator: "semver_gt", Value: "1.5.0"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with version > 1.5.0 should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"appVersion": "2.0.0"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("semver-gt-test", true, false)
	tc.CloseAllSDKs()

	// User with version = 1.5.0 should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"appVersion": "1.5.0"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("semver-gt-test", false, true)
	tc.CloseAllSDKs()

	// User with version < 1.5.0 should not match
	user3 := &protocol.UserContext{
		ID:         "user-3",
		Attributes: map[string]interface{}{"appVersion": "1.4.0"},
	}
	require.NoError(t, tc.InitAllSDKs(user3))
	tc.AssertFlagValue("semver-gt-test", false, true)
	tc.CloseAllSDKs()
}

// TestOperatorSemverEq tests the "semver_eq" operator.
func TestOperatorSemverEq(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "semver-eq-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "appVersion", Operator: "semver_eq", Value: "2.0.0"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with exact version should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"appVersion": "2.0.0"},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("semver-eq-test", true, false)
	tc.CloseAllSDKs()

	// User with different version should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"appVersion": "2.0.1"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("semver-eq-test", false, true)
	tc.CloseAllSDKs()
}

// TestCombinedOperators tests multiple conditions with different operators.
func TestCombinedOperators(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "combined-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "plan", Operator: "in", Value: []interface{}{"pro", "enterprise"}},
					{Attribute: "age", Operator: "gte", Value: 18},
					{Attribute: "country", Operator: "not_in", Value: []interface{}{"CN", "RU"}},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User matching all conditions should match
	user := &protocol.UserContext{
		ID: "user-1",
		Attributes: map[string]interface{}{
			"plan":    "pro",
			"age":     25,
			"country": "US",
		},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("combined-test", true, false)
	tc.CloseAllSDKs()

	// User failing one condition should not match (wrong plan)
	user2 := &protocol.UserContext{
		ID: "user-2",
		Attributes: map[string]interface{}{
			"plan":    "free",
			"age":     25,
			"country": "US",
		},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("combined-test", false, true)
	tc.CloseAllSDKs()

	// User failing one condition should not match (blocked country)
	user3 := &protocol.UserContext{
		ID: "user-3",
		Attributes: map[string]interface{}{
			"plan":    "pro",
			"age":     25,
			"country": "CN",
		},
	}
	require.NoError(t, tc.InitAllSDKs(user3))
	tc.AssertFlagValue("combined-test", false, true)
	tc.CloseAllSDKs()
}

// TestMissingAttribute tests behavior when attribute is missing.
func TestMissingAttribute(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "missing-attr-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "plan", Operator: "eq", Value: "pro"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0, // Default to false if rule doesn't match
	})

	// User without the attribute should not match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("missing-attr-test", false, true)
	tc.CloseAllSDKs()
}
