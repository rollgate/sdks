// Package harness provides the main orchestrator for SDK contract tests.
package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rollgate/test-harness/internal/protocol"
)

// BrowserTestService represents a browser SDK test service that uses the
// LaunchDarkly-style protocol with /clients/:id endpoints.
type BrowserTestService struct {
	Name     string // e.g., "sdk-browser"
	URL      string // e.g., "http://localhost:8000"
	client   *http.Client
	clientID string // Current client ID (from Location header)
}

// NewBrowserTestService creates a new browser test service client.
func NewBrowserTestService(name, url string) *BrowserTestService {
	return &BrowserTestService{
		Name: name,
		URL:  url,
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Health checks if the service is available.
func (bs *BrowserTestService) Health(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, bs.URL, nil)
	if err != nil {
		return err
	}

	resp, err := bs.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health check failed: status %d", resp.StatusCode)
	}

	return nil
}

// CreateClient creates a new SDK client instance.
// This is equivalent to the "init" command in the standard protocol.
func (bs *BrowserTestService) CreateClient(ctx context.Context, config protocol.Config, user *protocol.UserContext) error {
	// Build LaunchDarkly-style configuration
	createReq := map[string]interface{}{
		"tag": bs.Name,
		"configuration": map[string]interface{}{
			"credential":      config.APIKey,
			"startWaitTimeMs": config.Timeout,
			"initCanFail":     false,
			"serviceEndpoints": map[string]string{
				"polling":   config.BaseURL,
				"streaming": config.BaseURL,
			},
			"clientSide": map[string]interface{}{
				"initialUser": user,
			},
		},
	}

	data, err := json.Marshal(createReq)
	if err != nil {
		return fmt.Errorf("marshal create request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, bs.URL, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := bs.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("create client failed: status %d, body: %s", resp.StatusCode, string(body))
	}

	// Extract client ID from Location header
	location := resp.Header.Get("Location")
	if location != "" {
		// Location is like "/clients/0"
		parts := strings.Split(location, "/")
		if len(parts) >= 2 {
			bs.clientID = parts[len(parts)-1]
		}
	}

	return nil
}

// SendCommand sends a command to the current client.
func (bs *BrowserTestService) SendCommand(ctx context.Context, cmd protocol.Command) (protocol.Response, error) {
	// Auto-create client on init command
	if cmd.Command == protocol.CommandInit && bs.clientID == "" {
		var config protocol.Config
		if cmd.Config != nil {
			config = *cmd.Config
		}
		if err := bs.CreateClient(ctx, config, cmd.User); err != nil {
			// Return error in Response rather than as Go error
			// This matches test expectations for invalid API keys, etc.
			return protocol.Response{Error: err.Error()}, nil
		}
		// Return success for init (client creation includes initialization)
		trueVal := true
		return protocol.Response{Success: &trueVal}, nil
	}

	// Handle getState directly - if client exists, it's ready
	if cmd.Command == protocol.CommandGetState {
		if bs.clientID == "" {
			falseVal := false
			return protocol.Response{IsReady: &falseVal, CircuitState: "UNKNOWN"}, nil
		}
		trueVal := true
		return protocol.Response{IsReady: &trueVal, CircuitState: "closed"}, nil
	}

	// Handle close command - delete the client
	if cmd.Command == protocol.CommandClose {
		if err := bs.DeleteClient(ctx); err != nil {
			return protocol.Response{}, fmt.Errorf("delete client failed: %w", err)
		}
		trueVal := true
		return protocol.Response{Success: &trueVal}, nil
	}

	// When there's no client (init failed), return default values for flag evaluations
	if bs.clientID == "" {
		switch cmd.Command {
		case protocol.CommandIsEnabled:
			// Return the default value when SDK is not initialized
			return protocol.Response{Value: cmd.DefaultValue}, nil
		case protocol.CommandIsEnabledDetail:
			// Return the default value with ERROR reason when SDK is not initialized
			reason := protocol.EvaluationReason{Kind: "ERROR", ErrorKind: "CLIENT_NOT_READY"}
			return protocol.Response{Value: cmd.DefaultValue, Reason: &reason}, nil
		case protocol.CommandGetString:
			return protocol.Response{StringValue: &cmd.DefaultStringValue}, nil
		case protocol.CommandGetNumber:
			return protocol.Response{NumberValue: cmd.DefaultNumberValue}, nil
		case protocol.CommandIdentify, protocol.CommandReset:
			// No-op when no client
			trueVal := true
			return protocol.Response{Success: &trueVal}, nil
		default:
			return protocol.Response{}, fmt.Errorf("no client created, call CreateClient first")
		}
	}

	// Convert our command format to LaunchDarkly format
	ldCmd := bs.convertToLDCommand(cmd)

	data, err := json.Marshal(ldCmd)
	if err != nil {
		return protocol.Response{}, fmt.Errorf("marshal command: %w", err)
	}

	url := fmt.Sprintf("%s/clients/%s", bs.URL, bs.clientID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return protocol.Response{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := bs.client.Do(req)
	if err != nil {
		return protocol.Response{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return protocol.Response{}, fmt.Errorf("read response: %w", err)
	}

	// Convert LaunchDarkly response to our format
	return bs.convertFromLDResponse(cmd.Command, body)
}

// DeleteClient deletes the current client.
func (bs *BrowserTestService) DeleteClient(ctx context.Context) error {
	if bs.clientID == "" {
		return nil // No client to delete
	}

	url := fmt.Sprintf("%s/clients/%s", bs.URL, bs.clientID)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, url, nil)
	if err != nil {
		return err
	}

	resp, err := bs.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	bs.clientID = ""
	return nil
}

// Cleanup sends DELETE to clean up the service.
func (bs *BrowserTestService) Cleanup(ctx context.Context) error {
	// First delete the current client
	if err := bs.DeleteClient(ctx); err != nil {
		return err
	}

	// Then shutdown the service (optional)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, bs.URL, nil)
	if err != nil {
		return err
	}

	resp, err := bs.client.Do(req)
	if err != nil {
		// Ignore errors - service might have already shut down
		return nil
	}
	defer resp.Body.Close()

	return nil
}

// convertToLDCommand converts our command format to LaunchDarkly format.
func (bs *BrowserTestService) convertToLDCommand(cmd protocol.Command) map[string]interface{} {
	switch cmd.Command {
	case protocol.CommandIsEnabled:
		return map[string]interface{}{
			"command": "evaluate",
			"evaluate": map[string]interface{}{
				"flagKey":      cmd.FlagKey,
				"valueType":    "bool",
				"defaultValue": cmd.DefaultValue,
				"detail":       false,
			},
		}

	case protocol.CommandIsEnabledDetail:
		return map[string]interface{}{
			"command": "evaluate",
			"evaluate": map[string]interface{}{
				"flagKey":      cmd.FlagKey,
				"valueType":    "bool",
				"defaultValue": cmd.DefaultValue,
				"detail":       true,
			},
		}

	case protocol.CommandGetString:
		return map[string]interface{}{
			"command": "evaluate",
			"evaluate": map[string]interface{}{
				"flagKey":      cmd.FlagKey,
				"valueType":    "string",
				"defaultValue": cmd.DefaultStringValue,
				"detail":       false,
			},
		}

	case protocol.CommandGetNumber:
		return map[string]interface{}{
			"command": "evaluate",
			"evaluate": map[string]interface{}{
				"flagKey":      cmd.FlagKey,
				"valueType":    "double",
				"defaultValue": cmd.DefaultNumberValue,
				"detail":       false,
			},
		}

	case protocol.CommandIdentify:
		user := map[string]interface{}{}
		if cmd.User != nil {
			user["id"] = cmd.User.ID
			if cmd.User.Email != "" {
				user["email"] = cmd.User.Email
			}
			if cmd.User.Attributes != nil {
				user["attributes"] = cmd.User.Attributes
			}
		}
		return map[string]interface{}{
			"command":       "identifyEvent",
			"identifyEvent": map[string]interface{}{"user": user},
		}

	case protocol.CommandGetAllFlags:
		return map[string]interface{}{
			"command": "evaluateAll",
		}

	case protocol.CommandClose:
		// Close is handled by DeleteClient
		return map[string]interface{}{
			"command": "flushEvents",
		}

	default:
		return map[string]interface{}{
			"command": cmd.Command,
		}
	}
}

// convertFromLDResponse converts LaunchDarkly response to our format.
func (bs *BrowserTestService) convertFromLDResponse(cmdType string, body []byte) (protocol.Response, error) {
	trueVal := true
	if len(body) == 0 {
		return protocol.Response{Success: &trueVal}, nil
	}

	var rawResp map[string]interface{}
	if err := json.Unmarshal(body, &rawResp); err != nil {
		return protocol.Response{}, fmt.Errorf("unmarshal response: %w (body: %s)", err, string(body))
	}

	response := protocol.Response{}

	switch cmdType {
	case protocol.CommandIsEnabled:
		if val, ok := rawResp["value"]; ok {
			if boolVal, ok := val.(bool); ok {
				response.Value = &boolVal
			}
		}

	case protocol.CommandIsEnabledDetail:
		if val, ok := rawResp["value"]; ok {
			if boolVal, ok := val.(bool); ok {
				response.Value = &boolVal
			}
		}
		if reason, ok := rawResp["reason"]; ok {
			if reasonMap, ok := reason.(map[string]interface{}); ok {
				response.Reason = &protocol.EvaluationReason{}
				if kind, ok := reasonMap["kind"].(string); ok {
					response.Reason.Kind = kind
				}
				if ruleId, ok := reasonMap["ruleId"].(string); ok {
					response.Reason.RuleID = ruleId
				}
				if ruleIndex, ok := reasonMap["ruleIndex"].(float64); ok {
					idx := int(ruleIndex)
					response.Reason.RuleIndex = &idx
				}
				if inRollout, ok := reasonMap["inRollout"].(bool); ok {
					response.Reason.InRollout = &inRollout
				}
				if errorKind, ok := reasonMap["errorKind"].(string); ok {
					response.Reason.ErrorKind = errorKind
				}
			}
		}
		if variationId, ok := rawResp["variationId"].(string); ok {
			response.VariationID = variationId
		}

	case protocol.CommandGetString:
		if val, ok := rawResp["value"]; ok {
			if strVal, ok := val.(string); ok {
				response.StringValue = &strVal
			}
		}

	case protocol.CommandGetNumber:
		if val, ok := rawResp["value"]; ok {
			if numVal, ok := val.(float64); ok {
				response.NumberValue = &numVal
			}
		}

	case protocol.CommandGetAllFlags:
		if state, ok := rawResp["state"]; ok {
			if flags, ok := state.(map[string]interface{}); ok {
				response.Flags = make(map[string]bool)
				for k, v := range flags {
					if boolVal, ok := v.(bool); ok {
						response.Flags[k] = boolVal
					}
				}
			}
		}

	case protocol.CommandIdentify, protocol.CommandReset, protocol.CommandClose:
		response.Success = &trueVal
	}

	// Check for errors
	if errVal, ok := rawResp["error"]; ok {
		response.Error = fmt.Sprintf("%v", errVal)
	}
	if msgVal, ok := rawResp["message"]; ok {
		response.Message = fmt.Sprintf("%v", msgVal)
	}

	return response, nil
}

// HasClient returns true if a client has been created.
func (bs *BrowserTestService) HasClient() bool {
	return bs.clientID != ""
}

// GetClientID returns the current client ID.
func (bs *BrowserTestService) GetClientID() string {
	return bs.clientID
}
