// Package tests provides the test runner and test utilities.
package tests

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/rollgate/test-harness/internal/harness"
	"github.com/rollgate/test-harness/internal/mock"
	"github.com/rollgate/test-harness/internal/protocol"
)

// TestContext holds the test context.
type TestContext struct {
	T       *testing.T
	Harness *harness.Harness
	Ctx     context.Context
	Cancel  context.CancelFunc
}

// Setup creates a new test context.
func Setup(t *testing.T, h *harness.Harness) *TestContext {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)

	return &TestContext{
		T:       t,
		Harness: h,
		Ctx:     ctx,
		Cancel:  cancel,
	}
}

// Teardown cleans up the test context.
func (tc *TestContext) Teardown() {
	tc.Cancel()

	// Cleanup all services
	for _, svc := range tc.Harness.GetServices() {
		_ = svc.Cleanup(context.Background())
	}
}

// InitAllSDKs initializes all SDKs with the given user.
func (tc *TestContext) InitAllSDKs(user *protocol.UserContext) error {
	config := tc.Harness.InitSDKConfig()
	cmd := protocol.NewInitCommand(config, user)

	for _, svc := range tc.Harness.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		if err != nil {
			return fmt.Errorf("%s init failed: %w", svc.Name, err)
		}
		if resp.IsError() {
			return fmt.Errorf("%s init error: %s - %s", svc.Name, resp.Error, resp.Message)
		}
	}

	return nil
}

// CloseAllSDKs closes all SDKs.
func (tc *TestContext) CloseAllSDKs() error {
	cmd := protocol.NewCloseCommand()

	for _, svc := range tc.Harness.GetServices() {
		_, err := svc.SendCommand(tc.Ctx, cmd)
		if err != nil {
			return fmt.Errorf("%s close failed: %w", svc.Name, err)
		}
	}

	return nil
}

// AssertFlagValue asserts a flag value across all SDKs.
func (tc *TestContext) AssertFlagValue(flagKey string, expected bool, defaultValue bool) {
	tc.T.Helper()

	cmd := protocol.NewIsEnabledCommand(flagKey, defaultValue)

	for _, svc := range tc.Harness.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		if err != nil {
			tc.T.Errorf("%s: isEnabled failed: %v", svc.Name, err)
			continue
		}
		if resp.IsError() {
			tc.T.Errorf("%s: isEnabled error: %s - %s", svc.Name, resp.Error, resp.Message)
			continue
		}
		if resp.Value == nil {
			tc.T.Errorf("%s: isEnabled returned nil value", svc.Name)
			continue
		}
		if *resp.Value != expected {
			tc.T.Errorf("%s: isEnabled(%q) = %v, want %v", svc.Name, flagKey, *resp.Value, expected)
		}
	}
}

// AssertAllFlags asserts all flags match expected values.
func (tc *TestContext) AssertAllFlags(expected map[string]bool) {
	tc.T.Helper()

	cmd := protocol.NewGetAllFlagsCommand()

	for _, svc := range tc.Harness.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		if err != nil {
			tc.T.Errorf("%s: getAllFlags failed: %v", svc.Name, err)
			continue
		}
		if resp.IsError() {
			tc.T.Errorf("%s: getAllFlags error: %s - %s", svc.Name, resp.Error, resp.Message)
			continue
		}

		for key, expectedVal := range expected {
			actualVal, ok := resp.Flags[key]
			if !ok {
				tc.T.Errorf("%s: flag %q not found in getAllFlags response", svc.Name, key)
				continue
			}
			if actualVal != expectedVal {
				tc.T.Errorf("%s: flag %q = %v, want %v", svc.Name, key, actualVal, expectedVal)
			}
		}
	}
}

// IdentifyUser identifies a user across all SDKs.
func (tc *TestContext) IdentifyUser(user protocol.UserContext) error {
	cmd := protocol.NewIdentifyCommand(user)

	for _, svc := range tc.Harness.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		if err != nil {
			return fmt.Errorf("%s identify failed: %w", svc.Name, err)
		}
		if resp.IsError() {
			return fmt.Errorf("%s identify error: %s - %s", svc.Name, resp.Error, resp.Message)
		}
	}

	return nil
}

// ResetUser resets user context across all SDKs.
func (tc *TestContext) ResetUser() error {
	cmd := protocol.NewResetCommand()

	for _, svc := range tc.Harness.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		if err != nil {
			return fmt.Errorf("%s reset failed: %w", svc.Name, err)
		}
		if resp.IsError() {
			return fmt.Errorf("%s reset error: %s - %s", svc.Name, resp.Error, resp.Message)
		}
	}

	return nil
}

// GetState gets state from all SDKs and returns them.
func (tc *TestContext) GetState() (map[string]protocol.Response, error) {
	cmd := protocol.NewGetStateCommand()
	results := make(map[string]protocol.Response)

	for _, svc := range tc.Harness.GetServices() {
		resp, err := svc.SendCommand(tc.Ctx, cmd)
		if err != nil {
			return nil, fmt.Errorf("%s getState failed: %w", svc.Name, err)
		}
		results[svc.Name] = resp
	}

	return results, nil
}

// AssertAllReady asserts all SDKs are ready.
func (tc *TestContext) AssertAllReady() {
	tc.T.Helper()

	states, err := tc.GetState()
	if err != nil {
		tc.T.Fatalf("GetState failed: %v", err)
	}

	for name, state := range states {
		if !state.GetIsReady() {
			tc.T.Errorf("%s: not ready", name)
		}
	}
}

// RunForEachSDK runs a test function for each SDK independently.
func (tc *TestContext) RunForEachSDK(name string, fn func(t *testing.T, svc *harness.TestService)) {
	tc.T.Helper()

	for _, svc := range tc.Harness.GetServices() {
		tc.T.Run(fmt.Sprintf("%s/%s", name, svc.Name), func(t *testing.T) {
			fn(t, svc)
		})
	}
}

// TestScenario represents a test scenario.
type TestScenario struct {
	Name     string
	Scenario string // Mock scenario to load
	Flags    []*mock.FlagState // Custom flags to set
	User     *protocol.UserContext
	Tests    []FlagTest
}

// FlagTest represents a single flag test.
type FlagTest struct {
	FlagKey      string
	DefaultValue bool
	Expected     bool
}

// RunScenario runs a test scenario.
func (tc *TestContext) RunScenario(scenario TestScenario) {
	tc.T.Helper()

	// Setup scenario
	if scenario.Scenario != "" {
		tc.Harness.SetScenario(scenario.Scenario)
	}
	for _, flag := range scenario.Flags {
		tc.Harness.SetFlag(flag)
	}

	// Initialize SDKs
	if err := tc.InitAllSDKs(scenario.User); err != nil {
		tc.T.Fatalf("InitAllSDKs failed: %v", err)
	}
	defer tc.CloseAllSDKs()

	// Run tests
	for _, ft := range scenario.Tests {
		tc.T.Run(ft.FlagKey, func(t *testing.T) {
			tc.AssertFlagValue(ft.FlagKey, ft.Expected, ft.DefaultValue)
		})
	}
}
