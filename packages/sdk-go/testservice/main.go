// Package main provides the test service for the Rollgate Go SDK.
//
// This HTTP server wraps the rollgate.Client and exposes a standard interface
// for the test harness to interact with.
//
// Protocol:
// - GET /  -> Health check
// - POST / -> Execute command
// - DELETE / -> Cleanup/shutdown
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync"
	"syscall"
	"time"

	rollgate "github.com/rollgate/sdks/packages/sdk-go"
)

var (
	client   *rollgate.Client
	clientMu sync.Mutex
)

// UserContext represents a user for targeting.
type UserContext struct {
	ID         string                 `json:"id"`
	Email      string                 `json:"email,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

// Config represents SDK initialization configuration.
type Config struct {
	APIKey          string `json:"apiKey"`
	BaseURL         string `json:"baseUrl"`
	RefreshInterval int    `json:"refreshInterval,omitempty"` // ms
	EnableStreaming bool   `json:"enableStreaming,omitempty"`
	Timeout         int    `json:"timeout,omitempty"` // ms
}

// Command represents a command sent to the test service.
type Command struct {
	Command            string                 `json:"command"`
	Config             *Config                `json:"config,omitempty"`
	User               *UserContext           `json:"user,omitempty"`
	FlagKey            string                 `json:"flagKey,omitempty"`
	DefaultValue       *bool                  `json:"defaultValue,omitempty"`
	DefaultStringValue string                 `json:"defaultStringValue,omitempty"`
	DefaultNumberValue *float64               `json:"defaultNumberValue,omitempty"`
	DefaultJSONValue   interface{}            `json:"defaultJsonValue,omitempty"`
	EventName          string                 `json:"eventName,omitempty"`
	UserID             string                 `json:"userId,omitempty"`
	VariationID        string                 `json:"variationId,omitempty"`
	EventValue         *float64               `json:"eventValue,omitempty"`
	EventMetadata      map[string]interface{} `json:"eventMetadata,omitempty"`
}

// EvaluationReason represents the reason for a flag evaluation.
type EvaluationReason struct {
	Kind      string `json:"kind"`
	RuleID    string `json:"ruleId,omitempty"`
	RuleIndex int    `json:"ruleIndex,omitempty"`
	InRollout bool   `json:"inRollout,omitempty"`
	ErrorKind string `json:"errorKind,omitempty"`
}

// Response represents a response from the test service.
type Response struct {
	Value        *bool             `json:"value,omitempty"`
	StringValue  *string           `json:"stringValue,omitempty"`
	NumberValue  *float64          `json:"numberValue,omitempty"`
	JSONValue    interface{}       `json:"jsonValue,omitempty"`
	Flags        map[string]bool   `json:"flags,omitempty"`
	IsReady      *bool             `json:"isReady,omitempty"`
	CircuitState string            `json:"circuitState,omitempty"`
	CacheStats   *CacheStats       `json:"cacheStats,omitempty"`
	Success      *bool             `json:"success,omitempty"`
	Error        string            `json:"error,omitempty"`
	Message      string            `json:"message,omitempty"`
	Reason          *EvaluationReason `json:"reason,omitempty"`
	VariationID     string            `json:"variationId,omitempty"`
	FlagCount       *int              `json:"flagCount,omitempty"`
	EvaluationCount *int              `json:"evaluationCount,omitempty"`
}

// CacheStats represents cache statistics.
type CacheStats struct {
	Hits   int64 `json:"hits"`
	Misses int64 `json:"misses"`
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8002"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", handleRequest)

	server := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	// Start server in goroutine
	go func() {
		log.Printf("[sdk-go test-service] Listening on port %s", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interrupt
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("[sdk-go test-service] Shutting down...")

	// Cleanup
	clientMu.Lock()
	if client != nil {
		client.Close()
	}
	clientMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(ctx)
}

func handleRequest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Health check
	if r.Method == http.MethodGet {
		json.NewEncoder(w).Encode(Response{Success: boolPtr(true)})
		return
	}

	// Cleanup
	if r.Method == http.MethodDelete {
		clientMu.Lock()
		if client != nil {
			client.Close()
			client = nil
		}
		clientMu.Unlock()
		json.NewEncoder(w).Encode(Response{Success: boolPtr(true)})
		return
	}

	// Execute command
	if r.Method == http.MethodPost {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			sendError(w, "ParseError", "Failed to read request body")
			return
		}

		var cmd Command
		if err := json.Unmarshal(body, &cmd); err != nil {
			sendError(w, "ParseError", err.Error())
			return
		}

		result := handleCommand(cmd)
		json.NewEncoder(w).Encode(result)
		return
	}

	w.WriteHeader(http.StatusMethodNotAllowed)
}

func handleCommand(cmd Command) Response {
	switch cmd.Command {
	case "init":
		return handleInit(cmd)
	case "isEnabled":
		return handleIsEnabled(cmd)
	case "isEnabledDetail":
		return handleIsEnabledDetail(cmd)
	case "getString":
		return handleGetString(cmd)
	case "getNumber":
		return handleGetNumber(cmd)
	case "getJson":
		return handleGetJSON(cmd)
	case "getValueDetail":
		return handleGetValueDetail(cmd)
	case "identify":
		return handleIdentify(cmd)
	case "reset":
		return handleReset(cmd)
	case "getAllFlags":
		return handleGetAllFlags(cmd)
	case "getState":
		return handleGetState(cmd)
	case "track":
		return handleTrack(cmd)
	case "flushEvents":
		return handleFlushEvents(cmd)
	case "flushTelemetry":
		return handleFlushTelemetry(cmd)
	case "getTelemetryStats":
		return handleGetTelemetryStats(cmd)
	case "close":
		return handleClose(cmd)
	default:
		return Response{Error: "UnknownCommand", Message: fmt.Sprintf("Unknown command: %s", cmd.Command)}
	}
}

func handleInit(cmd Command) Response {
	if cmd.Config == nil {
		return Response{Error: "ValidationError", Message: "config is required"}
	}

	config := rollgate.Config{
		APIKey:  cmd.Config.APIKey,
		BaseURL: cmd.Config.BaseURL,
	}

	if cmd.Config.RefreshInterval > 0 {
		config.RefreshInterval = time.Duration(cmd.Config.RefreshInterval) * time.Millisecond
	} else {
		config.RefreshInterval = 0 // Disable polling
	}

	if cmd.Config.Timeout > 0 {
		config.Timeout = time.Duration(cmd.Config.Timeout) * time.Millisecond
	}

	config.EnableStreaming = cmd.Config.EnableStreaming

	// Create client
	c, err := rollgate.NewClient(config)
	if err != nil {
		return Response{Error: "InitError", Message: err.Error()}
	}

	// Set user if provided
	if cmd.User != nil {
		user := &rollgate.UserContext{
			ID:    cmd.User.ID,
			Email: cmd.User.Email,
		}
		if cmd.User.Attributes != nil {
			user.Attributes = make(map[string]any)
			for k, v := range cmd.User.Attributes {
				user.Attributes[k] = v
			}
		}
		// Note: We'll pass the user context during identify after init
	}

	// Initialize
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := c.Initialize(ctx); err != nil {
		return Response{Error: "InitError", Message: err.Error()}
	}

	// If user was provided, identify
	if cmd.User != nil {
		user := &rollgate.UserContext{
			ID:    cmd.User.ID,
			Email: cmd.User.Email,
		}
		if cmd.User.Attributes != nil {
			user.Attributes = make(map[string]any)
			for k, v := range cmd.User.Attributes {
				user.Attributes[k] = v
			}
		}
		if err := c.Identify(ctx, user); err != nil {
			return Response{Error: "IdentifyError", Message: err.Error()}
		}
	}

	clientMu.Lock()
	client = c
	clientMu.Unlock()

	return Response{Success: boolPtr(true)}
}

func handleIsEnabled(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if cmd.FlagKey == "" {
		return Response{Error: "ValidationError", Message: "flagKey is required"}
	}

	defaultValue := false
	if cmd.DefaultValue != nil {
		defaultValue = *cmd.DefaultValue
	}

	value := c.IsEnabled(cmd.FlagKey, defaultValue)
	return Response{Value: boolPtr(value)}
}

func handleIsEnabledDetail(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if cmd.FlagKey == "" {
		return Response{Error: "ValidationError", Message: "flagKey is required"}
	}

	defaultValue := false
	if cmd.DefaultValue != nil {
		defaultValue = *cmd.DefaultValue
	}

	detail := c.IsEnabledDetail(cmd.FlagKey, defaultValue)
	return Response{
		Value: boolPtr(detail.Value),
		Reason: &EvaluationReason{
			Kind:      string(detail.Reason.Kind),
			RuleID:    detail.Reason.RuleID,
			RuleIndex: detail.Reason.RuleIndex,
			InRollout: detail.Reason.InRollout,
			ErrorKind: string(detail.Reason.ErrorKind),
		},
		VariationID: detail.VariationID,
	}
}

func handleGetString(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if cmd.FlagKey == "" {
		return Response{Error: "ValidationError", Message: "flagKey is required"}
	}

	value := c.GetString(cmd.FlagKey, cmd.DefaultStringValue)
	return Response{StringValue: &value}
}

func handleGetNumber(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if cmd.FlagKey == "" {
		return Response{Error: "ValidationError", Message: "flagKey is required"}
	}

	defaultValue := 0.0
	if cmd.DefaultNumberValue != nil {
		defaultValue = *cmd.DefaultNumberValue
	}

	value := c.GetNumber(cmd.FlagKey, defaultValue)
	return Response{NumberValue: &value}
}

func handleGetJSON(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if cmd.FlagKey == "" {
		return Response{Error: "ValidationError", Message: "flagKey is required"}
	}

	value := c.GetJSON(cmd.FlagKey, cmd.DefaultJSONValue)
	return Response{JSONValue: value}
}

func handleGetValueDetail(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if cmd.FlagKey == "" {
		return Response{Error: "ValidationError", Message: "flagKey is required"}
	}

	// For now, Go SDK only supports boolean flags with detail
	// Return boolean detail
	defaultValue := false
	if cmd.DefaultValue != nil {
		defaultValue = *cmd.DefaultValue
	}

	detail := c.IsEnabledDetail(cmd.FlagKey, defaultValue)
	return Response{
		Value: boolPtr(detail.Value),
		Reason: &EvaluationReason{
			Kind:      string(detail.Reason.Kind),
			RuleID:    detail.Reason.RuleID,
			RuleIndex: detail.Reason.RuleIndex,
			InRollout: detail.Reason.InRollout,
			ErrorKind: string(detail.Reason.ErrorKind),
		},
		VariationID: detail.VariationID,
	}
}

func handleIdentify(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if cmd.User == nil {
		return Response{Error: "ValidationError", Message: "user is required"}
	}

	user := &rollgate.UserContext{
		ID:    cmd.User.ID,
		Email: cmd.User.Email,
	}
	if cmd.User.Attributes != nil {
		user.Attributes = make(map[string]any)
		for k, v := range cmd.User.Attributes {
			user.Attributes[k] = v
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := c.Identify(ctx, user); err != nil {
		return Response{Error: "IdentifyError", Message: err.Error()}
	}

	return Response{Success: boolPtr(true)}
}

func handleReset(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := c.Reset(ctx); err != nil {
		return Response{Error: "ResetError", Message: err.Error()}
	}

	return Response{Success: boolPtr(true)}
}

func handleGetAllFlags(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	flags := c.GetAllFlags()
	return Response{Flags: flags}
}

func handleGetState(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{
			IsReady:      boolPtr(false),
			CircuitState: "UNKNOWN",
		}
	}

	circuitState := c.GetCircuitState()
	metrics := c.GetMetrics()

	return Response{
		IsReady:      boolPtr(c.IsReady()),
		CircuitState: string(circuitState),
		CacheStats: &CacheStats{
			Hits:   metrics.CacheHits,
			Misses: metrics.CacheMisses,
		},
	}
}

func handleTrack(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if cmd.FlagKey == "" || cmd.EventName == "" || cmd.UserID == "" {
		return Response{Error: "ValidationError", Message: "flagKey, eventName, and userId are required"}
	}

	opts := rollgate.TrackEventOptions{
		FlagKey:   cmd.FlagKey,
		EventName: cmd.EventName,
		UserID:    cmd.UserID,
	}
	if cmd.VariationID != "" {
		opts.VariationID = cmd.VariationID
	}
	if cmd.EventValue != nil {
		opts.Value = cmd.EventValue
	}
	if cmd.EventMetadata != nil {
		opts.Metadata = make(map[string]any)
		for k, v := range cmd.EventMetadata {
			opts.Metadata[k] = v
		}
	}

	c.Track(opts)
	return Response{Success: boolPtr(true)}
}

func handleFlushEvents(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if err := c.FlushEvents(); err != nil {
		return Response{Error: "FlushError", Message: err.Error()}
	}

	return Response{Success: boolPtr(true)}
}

func handleFlushTelemetry(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	if err := c.FlushTelemetry(); err != nil {
		return Response{Error: "FlushError", Message: err.Error()}
	}

	return Response{Success: boolPtr(true)}
}

func handleGetTelemetryStats(cmd Command) Response {
	clientMu.Lock()
	c := client
	clientMu.Unlock()

	if c == nil {
		return Response{Error: "NotInitializedError", Message: "Client not initialized"}
	}

	flagCount, evaluationCount := c.GetTelemetryStats()
	return Response{FlagCount: &flagCount, EvaluationCount: &evaluationCount}
}

func handleClose(cmd Command) Response {
	clientMu.Lock()
	if client != nil {
		client.Close()
		client = nil
	}
	clientMu.Unlock()

	return Response{Success: boolPtr(true)}
}

func sendError(w http.ResponseWriter, errType, message string) {
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(Response{Error: errType, Message: message})
}

func boolPtr(b bool) *bool {
	return &b
}

func getEnvInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return defaultVal
}
