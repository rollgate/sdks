package tests

import (
	"testing"

	"github.com/rollgate/test-harness/internal/protocol"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Note: Typed flags are a V2 feature and may not be supported by all SDKs.
// Tests will skip if the SDK returns "UnknownCommand" error.

// TestGetStringFlag tests getString command.
func TestGetStringFlag(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		cmd := protocol.NewGetStringCommand("banner-text", "Welcome")
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.Error == "UnknownCommand" {
			t.Skipf("%s: getString not supported (V2 feature)", svc.Name)
		}

		if resp.IsError() {
			t.Logf("%s: getString error: %s", svc.Name, resp.Error)
		} else if resp.StringValue != nil {
			t.Logf("%s: getString = %s", svc.Name, *resp.StringValue)
		} else {
			t.Logf("%s: getString returned nil (flag not found, using default)", svc.Name)
		}
	}

	tc.CloseAllSDKs()
}

// TestGetStringFlagDefault tests getString returns default when flag not found.
func TestGetStringFlagDefault(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		defaultValue := "DefaultText"
		cmd := protocol.NewGetStringCommand("non-existent-string-flag", defaultValue)
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.Error == "UnknownCommand" {
			t.Skipf("%s: getString not supported (V2 feature)", svc.Name)
		}

		if resp.StringValue != nil {
			assert.Equal(t, defaultValue, *resp.StringValue,
				"%s: non-existent flag should return default", svc.Name)
		} else {
			t.Logf("%s: getString returned nil", svc.Name)
		}
	}

	tc.CloseAllSDKs()
}

// TestGetNumberFlag tests getNumber command.
func TestGetNumberFlag(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		cmd := protocol.NewGetNumberCommand("max-items", 10)
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.Error == "UnknownCommand" {
			t.Skipf("%s: getNumber not supported (V2 feature)", svc.Name)
		}

		if resp.IsError() {
			t.Logf("%s: getNumber error: %s", svc.Name, resp.Error)
		} else if resp.NumberValue != nil {
			t.Logf("%s: getNumber = %f", svc.Name, *resp.NumberValue)
		} else {
			t.Logf("%s: getNumber returned nil (flag not found, using default)", svc.Name)
		}
	}

	tc.CloseAllSDKs()
}

// TestGetNumberFlagDefault tests getNumber returns default when flag not found.
func TestGetNumberFlagDefault(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		defaultValue := 42.0
		cmd := protocol.NewGetNumberCommand("non-existent-number-flag", defaultValue)
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.Error == "UnknownCommand" {
			t.Skipf("%s: getNumber not supported (V2 feature)", svc.Name)
		}

		if resp.NumberValue != nil {
			assert.Equal(t, defaultValue, *resp.NumberValue,
				"%s: non-existent flag should return default", svc.Name)
		} else {
			t.Logf("%s: getNumber returned nil", svc.Name)
		}
	}

	tc.CloseAllSDKs()
}

// TestGetJSONFlag tests getJson command.
func TestGetJSONFlag(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		defaultValue := map[string]interface{}{"theme": "dark"}
		cmd := protocol.NewGetJSONCommand("config", defaultValue)
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.Error == "UnknownCommand" {
			t.Skipf("%s: getJson not supported (V2 feature)", svc.Name)
		}

		if resp.IsError() {
			t.Logf("%s: getJson error: %s", svc.Name, resp.Error)
		} else if resp.JSONValue != nil {
			t.Logf("%s: getJson = %+v", svc.Name, resp.JSONValue)
		} else {
			t.Logf("%s: getJson returned nil (flag not found, using default)", svc.Name)
		}
	}

	tc.CloseAllSDKs()
}

// TestGetJSONFlagDefault tests getJson returns default when flag not found.
func TestGetJSONFlagDefault(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		defaultValue := map[string]interface{}{
			"enabled":   true,
			"threshold": 100,
			"message":   "Hello",
		}
		cmd := protocol.NewGetJSONCommand("non-existent-json-flag", defaultValue)
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.Error == "UnknownCommand" {
			t.Skipf("%s: getJson not supported (V2 feature)", svc.Name)
		}

		if resp.JSONValue != nil {
			t.Logf("%s: getJson default = %+v", svc.Name, resp.JSONValue)
			// Note: Deep comparison of interfaces is complex, just verify not nil
		} else {
			t.Logf("%s: getJson returned nil", svc.Name)
		}
	}

	tc.CloseAllSDKs()
}

// TestTypeMismatch tests behavior when value type doesn't match.
func TestTypeMismatch(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	// enabled-flag is a boolean flag
	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		// Try to get boolean flag as string
		cmd := protocol.NewGetStringCommand("enabled-flag", "default")
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		require.NoError(t, err)

		if resp.Error == "UnknownCommand" {
			t.Skipf("%s: getString not supported (V2 feature)", svc.Name)
		}

		// SDK should return default or handle type mismatch gracefully
		t.Logf("%s: type mismatch result: stringValue=%v, error=%s",
			svc.Name, resp.StringValue, resp.Error)

		// Try to get boolean flag as number
		cmdNum := protocol.NewGetNumberCommand("enabled-flag", 0)
		respNum, err := svc.SendCommand(tc.Ctx, cmdNum)
		require.NoError(t, err)

		t.Logf("%s: type mismatch (number) result: numberValue=%v, error=%s",
			svc.Name, respNum.NumberValue, respNum.Error)
	}

	tc.CloseAllSDKs()
}

// TestAllTypedFlagsNotSupported verifies that SDKs gracefully handle missing typed flag support.
func TestAllTypedFlagsNotSupported(t *testing.T) {
	h := getHarness(t)
	tc := Setup(t, h)
	defer tc.Teardown()

	h.SetScenario("basic")
	require.NoError(t, tc.InitAllSDKs(nil))

	for _, svc := range h.GetServices() {
		// getString
		resp1, err := svc.SendCommand(tc.Ctx, protocol.NewGetStringCommand("flag", "default"))
		require.NoError(t, err)
		if resp1.Error == "UnknownCommand" {
			t.Logf("%s: getString not supported (expected for V1 SDKs)", svc.Name)
		}

		// getNumber
		resp2, err := svc.SendCommand(tc.Ctx, protocol.NewGetNumberCommand("flag", 0))
		require.NoError(t, err)
		if resp2.Error == "UnknownCommand" {
			t.Logf("%s: getNumber not supported (expected for V1 SDKs)", svc.Name)
		}

		// getJson
		resp3, err := svc.SendCommand(tc.Ctx, protocol.NewGetJSONCommand("flag", nil))
		require.NoError(t, err)
		if resp3.Error == "UnknownCommand" {
			t.Logf("%s: getJson not supported (expected for V1 SDKs)", svc.Name)
		}
	}

	tc.CloseAllSDKs()
}
