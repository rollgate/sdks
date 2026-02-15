package tests

import (
	"testing"

	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
)

// TestSegmentBasicMatch tests that a user matching segment conditions gets the flag enabled.
func TestSegmentBasicMatch(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server for segment setup")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("segments")
	h.SetSegment("pro-users", []mock.Condition{
		{Attribute: "plan", Operator: "eq", Value: "pro"},
	})

	user := &protocol.UserContext{
		ID:         "pro-user-1",
		Attributes: map[string]interface{}{"plan": "pro"},
	}
	tc.InitAllSDKs(user)
	tc.AssertFlagValue("pro-feature", true, false)
	tc.CloseAllSDKs()
}

// TestSegmentNoMatch tests that a user NOT matching segment conditions gets the flag disabled.
func TestSegmentNoMatch(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server for segment setup")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("segments")
	h.SetSegment("pro-users", []mock.Condition{
		{Attribute: "plan", Operator: "eq", Value: "pro"},
	})

	user := &protocol.UserContext{
		ID:         "free-user-1",
		Attributes: map[string]interface{}{"plan": "free"},
	}
	tc.InitAllSDKs(user)
	tc.AssertFlagValue("pro-feature", false, true)
	tc.CloseAllSDKs()
}

// TestSegmentMultipleConditions tests a segment with multiple AND conditions.
func TestSegmentMultipleConditions(t *testing.T) {
	h := getHarness(t)
	if h.IsUsingExternalServer() {
		t.Skip("requires mock server for segment setup")
	}
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("segments")
	h.SetSegment("pro-users", []mock.Condition{
		{Attribute: "plan", Operator: "eq", Value: "pro"},
		{Attribute: "verified", Operator: "eq", Value: true},
	})

	// User with both conditions met
	user1 := &protocol.UserContext{
		ID:         "verified-pro",
		Attributes: map[string]interface{}{"plan": "pro", "verified": true},
	}
	tc.InitAllSDKs(user1)
	tc.AssertFlagValue("pro-feature", true, false)
	tc.CloseAllSDKs()

	// User with only one condition met
	user2 := &protocol.UserContext{
		ID:         "unverified-pro",
		Attributes: map[string]interface{}{"plan": "pro", "verified": false},
	}
	tc.InitAllSDKs(user2)
	tc.AssertFlagValue("pro-feature", false, true)
	tc.CloseAllSDKs()
}
