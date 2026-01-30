// Package harness provides the main orchestrator for SDK contract tests.
package harness

import (
	"context"

	"github.com/rollgate/test-harness/internal/protocol"
)

// SDKService is the common interface for all test services.
// Both standard TestService and BrowserTestService implement this interface.
type SDKService interface {
	// GetName returns the service name (e.g., "sdk-node", "sdk-browser").
	GetName() string

	// Health checks if the service is available.
	Health(ctx context.Context) error

	// Init initializes the SDK client with the given config and user.
	// For standard services, this sends an "init" command.
	// For browser services, this calls CreateClient.
	Init(ctx context.Context, config protocol.Config, user *protocol.UserContext) error

	// SendCommand sends a command to the SDK.
	// The service must be initialized first.
	SendCommand(ctx context.Context, cmd protocol.Command) (protocol.Response, error)

	// Close closes the SDK client.
	// For standard services, this sends a "close" command.
	// For browser services, this calls DeleteClient.
	Close(ctx context.Context) error

	// Cleanup cleans up the service (e.g., shutdown).
	Cleanup(ctx context.Context) error

	// IsBrowser returns true if this is a browser-based service.
	IsBrowser() bool
}

// Ensure TestService implements SDKService.
var _ SDKService = (*TestService)(nil)

// Ensure BrowserTestService implements SDKService.
var _ SDKService = (*BrowserTestService)(nil)

// GetName returns the service name.
func (ts *TestService) GetName() string {
	return ts.Name
}

// Init initializes the SDK by sending an init command.
func (ts *TestService) Init(ctx context.Context, config protocol.Config, user *protocol.UserContext) error {
	cmd := protocol.NewInitCommand(config, user)
	_, err := ts.SendCommand(ctx, cmd)
	return err
}

// Close closes the SDK by sending a close command.
func (ts *TestService) Close(ctx context.Context) error {
	cmd := protocol.NewCloseCommand()
	_, err := ts.SendCommand(ctx, cmd)
	return err
}

// IsBrowser returns false for standard test services.
func (ts *TestService) IsBrowser() bool {
	return false
}

// GetName returns the service name.
func (bs *BrowserTestService) GetName() string {
	return bs.Name
}

// Init initializes the browser SDK by creating a client.
func (bs *BrowserTestService) Init(ctx context.Context, config protocol.Config, user *protocol.UserContext) error {
	return bs.CreateClient(ctx, config, user)
}

// Close closes the browser SDK by deleting the client.
func (bs *BrowserTestService) Close(ctx context.Context) error {
	return bs.DeleteClient(ctx)
}

// IsBrowser returns true for browser test services.
func (bs *BrowserTestService) IsBrowser() bool {
	return true
}
