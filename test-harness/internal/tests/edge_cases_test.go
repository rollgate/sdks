package tests

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rollgate/test-harness/internal/harness"
	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestUserIdSpecialChars tests user ID with special characters and emoji.
func TestUserIdSpecialChars(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	specialIDs := []string{
		"user-with-dash",
		"user_with_underscore",
		"user.with.dots",
		"user@email.com",
		"user+tag",
		"user🎉emoji",
		"user 🚀 space",
	}

	for _, id := range specialIDs {
		t.Run(id, func(t *testing.T) {
			user := &protocol.UserContext{ID: id}
			require.NoError(t, tc.InitAllSDKs(user))
			tc.AssertFlagValue("enabled-flag", true, false)
			tc.CloseAllSDKs()
		})
	}
}

// TestUserIdUnicode tests user ID with various unicode characters.
func TestUserIdUnicode(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	unicodeIDs := []string{
		"user-ñ-spanish",
		"user-ü-german",
		"user-中文-chinese",
		"user-日本語-japanese",
		"user-한국어-korean",
		"user-العربية-arabic",
		"user-עברית-hebrew",
		"user-Ελληνικά-greek",
		"user-кириллица-cyrillic",
	}

	for _, id := range unicodeIDs {
		t.Run(id, func(t *testing.T) {
			user := &protocol.UserContext{ID: id}
			require.NoError(t, tc.InitAllSDKs(user))
			tc.AssertFlagValue("enabled-flag", true, false)
			tc.CloseAllSDKs()
		})
	}
}

// TestUserIdVeryLong tests user ID with 1000+ characters.
func TestUserIdVeryLong(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")

	// Create a very long user ID
	longID := strings.Repeat("a", 1000)

	user := &protocol.UserContext{ID: longID}
	err := tc.InitAllSDKs(user)

	// Either it works or returns a clear error
	if err != nil {
		t.Logf("Long user ID rejected as expected: %v", err)
	} else {
		tc.AssertFlagValue("enabled-flag", true, false)
		tc.CloseAllSDKs()
		t.Log("Long user ID accepted successfully")
	}
}

// TestFlagKeySpecialChars tests flag keys with special characters.
func TestFlagKeySpecialChars(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	specialKeys := []string{
		"flag-with-dash",
		"flag_with_underscore",
		"flag.with.dots",
		"flagWithCamelCase",
		"UPPERCASE_FLAG",
		"flag123numeric",
	}

	for _, key := range specialKeys {
		h.SetFlag(&mock.FlagState{
			Key:               key,
			Enabled:           true,
			RolloutPercentage: 100,
		})
	}

	require.NoError(t, tc.InitAllSDKs(nil))

	for _, key := range specialKeys {
		t.Run(key, func(t *testing.T) {
			tc.AssertFlagValue(key, true, false)
		})
	}

	tc.CloseAllSDKs()
}

// TestFlagKeyVeryLong tests flag key with 500+ characters.
func TestFlagKeyVeryLong(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// Create a long flag key
	longKey := "flag-" + strings.Repeat("x", 500)

	h.SetFlag(&mock.FlagState{
		Key:               longKey,
		Enabled:           true,
		RolloutPercentage: 100,
	})

	err := tc.InitAllSDKs(nil)
	if err != nil {
		t.Logf("Init with long flag key failed: %v", err)
		return
	}

	tc.AssertFlagValue(longKey, true, false)
	tc.CloseAllSDKs()
}

// TestAttributeNull tests behavior with null/nil attribute values.
func TestAttributeNull(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "null-attr-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "optional", Operator: "eq", Value: "present"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with nil attribute should not match
	user := &protocol.UserContext{
		ID: "user-1",
		Attributes: map[string]interface{}{
			"optional": nil,
		},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("null-attr-test", false, true)
	tc.CloseAllSDKs()
}

// TestAttributeEmpty tests behavior with empty string attributes.
func TestAttributeEmpty(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "empty-attr-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "name", Operator: "eq", Value: ""},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with empty string should match eq ""
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"name": ""},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("empty-attr-test", true, false)
	tc.CloseAllSDKs()

	// User with non-empty should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"name": "John"},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("empty-attr-test", false, true)
	tc.CloseAllSDKs()
}

// TestAttributeBoolean tests boolean attribute handling.
func TestAttributeBoolean(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "bool-attr-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "verified", Operator: "eq", Value: true},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// User with verified=true should match
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"verified": true},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("bool-attr-test", true, false)
	tc.CloseAllSDKs()

	// User with verified=false should not match
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"verified": false},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("bool-attr-test", false, true)
	tc.CloseAllSDKs()
}

// TestAttributeNumber tests numeric attribute handling.
func TestAttributeNumber(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "num-attr-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "score", Operator: "gte", Value: 100},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// Test with integer
	user := &protocol.UserContext{
		ID:         "user-1",
		Attributes: map[string]interface{}{"score": 150},
	}
	require.NoError(t, tc.InitAllSDKs(user))
	tc.AssertFlagValue("num-attr-test", true, false)
	tc.CloseAllSDKs()

	// Test with float
	user2 := &protocol.UserContext{
		ID:         "user-2",
		Attributes: map[string]interface{}{"score": 99.9},
	}
	require.NoError(t, tc.InitAllSDKs(user2))
	tc.AssertFlagValue("num-attr-test", false, true)
	tc.CloseAllSDKs()

	// Test with string number
	user3 := &protocol.UserContext{
		ID:         "user-3",
		Attributes: map[string]interface{}{"score": "200"},
	}
	require.NoError(t, tc.InitAllSDKs(user3))
	tc.AssertFlagValue("num-attr-test", true, false)
	tc.CloseAllSDKs()
}

// TestManyFlags tests performance with many flags.
func TestManyFlags(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	numFlags := 100 // Reduced from 1000 for faster tests

	// Create many flags
	for i := 0; i < numFlags; i++ {
		h.SetFlag(&mock.FlagState{
			Key:               fmt.Sprintf("flag-%d", i),
			Enabled:           i%2 == 0, // Even flags enabled
			RolloutPercentage: 100,
		})
	}

	start := time.Now()
	require.NoError(t, tc.InitAllSDKs(nil))
	initTime := time.Since(start)

	t.Logf("Init with %d flags took %v", numFlags, initTime)
	assert.Less(t, initTime, 5*time.Second, "Init should complete within 5 seconds")

	// Test a few flag evaluations
	start = time.Now()
	for i := 0; i < 10; i++ {
		key := fmt.Sprintf("flag-%d", i)
		expected := i%2 == 0
		tc.AssertFlagValue(key, expected, !expected)
	}
	evalTime := time.Since(start)

	t.Logf("10 flag evaluations took %v", evalTime)
	assert.Less(t, evalTime, 1*time.Second, "Evaluations should be fast")

	tc.CloseAllSDKs()
}

// TestManyAttributes tests user with many attributes.
func TestManyAttributes(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetFlag(&mock.FlagState{
		Key:     "many-attrs-test",
		Enabled: true,
		Rules: []mock.Rule{
			{
				Enabled: true,
				Conditions: []mock.Condition{
					{Attribute: "attr-50", Operator: "eq", Value: "value-50"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0,
	})

	// Create user with 100 attributes
	attrs := make(map[string]interface{})
	for i := 0; i < 100; i++ {
		attrs[fmt.Sprintf("attr-%d", i)] = fmt.Sprintf("value-%d", i)
	}

	user := &protocol.UserContext{
		ID:         "user-with-many-attrs",
		Attributes: attrs,
	}

	start := time.Now()
	require.NoError(t, tc.InitAllSDKs(user))
	initTime := time.Since(start)

	t.Logf("Init with 100 attributes took %v", initTime)
	tc.AssertFlagValue("many-attrs-test", true, false)

	tc.CloseAllSDKs()
}

// TestConcurrentEvaluations tests thread safety of flag evaluations.
func TestConcurrentEvaluations(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	// Run 100 concurrent evaluations
	numGoroutines := 100
	var wg sync.WaitGroup
	errors := make(chan error, numGoroutines)

	for _, svc := range h.GetServices() {
		for i := 0; i < numGoroutines; i++ {
			wg.Add(1)
			go func(svc harness.SDKService, i int) {
				defer wg.Done()

				flagKey := "enabled-flag"
				if i%2 == 0 {
					flagKey = "disabled-flag"
				}

				_, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand(flagKey, false))
				if err != nil {
					errors <- err
				}
			}(svc, i)
		}
	}

	wg.Wait()
	close(errors)

	// Check for errors
	var errCount int
	for err := range errors {
		t.Logf("Concurrent evaluation error: %v", err)
		errCount++
	}

	assert.Equal(t, 0, errCount, "All concurrent evaluations should succeed")
	t.Logf("Completed %d concurrent evaluations", numGoroutines*len(h.GetServices()))

	tc.CloseAllSDKs()
}

// TestRapidIdentify tests rapid identify calls.
func TestRapidIdentify(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("targeting")
	require.NoError(t, tc.InitAllSDKs(nil))

	// Rapid identify calls
	numCalls := 10
	start := time.Now()

	for _, svc := range h.GetServices() {
		for i := 0; i < numCalls; i++ {
			user := protocol.UserContext{
				ID: fmt.Sprintf("rapid-user-%d", i),
				Attributes: map[string]interface{}{
					"plan": "pro",
				},
			}

			_, err := svc.SendCommand(tc.Ctx, protocol.NewIdentifyCommand(user))
			require.NoError(t, err, "Identify call %d should succeed", i)
		}
	}

	elapsed := time.Since(start)
	t.Logf("%d identify calls took %v", numCalls*len(h.GetServices()), elapsed)
	assert.Less(t, elapsed, 5*time.Second, "Rapid identifies should complete quickly")

	tc.CloseAllSDKs()
}

// TestEmptyFlagKey tests behavior with empty flag key.
func TestEmptyFlagKey(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	// Empty flag key should return default or error
	for _, svc := range h.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, protocol.NewIsEnabledCommand("", true))
		require.NoError(t, err)

		// SDK might return error or default value for empty key
		if resp.IsError() {
			t.Logf("%s: empty flag key returned error (expected): %s", svc.GetName(), resp.Error)
		} else if resp.Value != nil {
			assert.True(t, *resp.Value, "Empty flag key should return default value (true)")
		} else {
			t.Logf("%s: empty flag key returned nil value", svc.GetName())
		}
	}

	tc.CloseAllSDKs()
}

// TestNonExistentFlag tests behavior with non-existent flag.
func TestNonExistentFlag(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	// Non-existent flag should return default
	tc.AssertFlagValue("definitely-not-a-real-flag-xyz-123", false, false)
	tc.AssertFlagValue("another-fake-flag", true, true)

	tc.CloseAllSDKs()
}
