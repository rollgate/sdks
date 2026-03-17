// Package mock provides a mock Rollgate API server for testing SDKs.
package mock

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ErrorSimulation configures error responses for testing.
type ErrorSimulation struct {
	StatusCode int           `json:"statusCode"` // HTTP status code to return
	Count      int           `json:"count"`      // Number of requests to fail (-1 = always)
	RetryAfter int           `json:"retryAfter"` // Retry-After header value for 429
	Delay      time.Duration `json:"delay"`      // Delay before responding (for timeout testing)
	Message    string        `json:"message"`    // Error message
}

// TrackEventItem represents a single tracked event received by the mock server.
type TrackEventItem struct {
	FlagKey     string                 `json:"flagKey"`
	EventName   string                 `json:"eventName"`
	UserID      string                 `json:"userId"`
	VariationID string                 `json:"variationId,omitempty"`
	Value       *float64               `json:"value,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
	Timestamp   *time.Time             `json:"timestamp,omitempty"`
}

// EvalStats represents evaluation statistics for a single flag.
type EvalStats struct {
	Total int `json:"total"`
	True  int `json:"true"`
	False int `json:"false"`
}

// TelemetryPayload represents a telemetry batch payload.
type TelemetryPayload struct {
	Evaluations map[string]EvalStats `json:"evaluations"`
	PeriodMs    int                  `json:"period_ms"`
}

// Server is a mock Rollgate API server.
type Server struct {
	mux        *http.ServeMux
	flags      *FlagStore
	apiKey     string
	sseClients map[chan []byte]struct{}
	sseMu      sync.Mutex
	// User sessions - stores user context by user_id for remote evaluation
	userSessions map[string]map[string]interface{}
	userMu       sync.RWMutex
	// Segments - reusable conditions referenced by rules
	segments   map[string][]Condition
	segmentsMu sync.RWMutex
	// Error simulation
	errorSim   *ErrorSimulation
	errorCount int
	errorMu    sync.Mutex
	// Received events for testing
	receivedEvents []TrackEventItem
	eventsMu       sync.Mutex
	// Received telemetry for testing
	receivedTelemetry []TelemetryPayload
	telemetryMu       sync.Mutex
}

// NewServer creates a new mock server.
func NewServer(apiKey string) *Server {
	s := &Server{
		mux:          http.NewServeMux(),
		flags:        NewFlagStore(),
		apiKey:       apiKey,
		sseClients:   make(map[chan []byte]struct{}),
		userSessions: make(map[string]map[string]interface{}),
		segments:     make(map[string][]Condition),
	}
	s.setupRoutes()
	return s
}

// GetFlagStore returns the flag store for configuration.
func (s *Server) GetFlagStore() *FlagStore {
	return s.flags
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// CORS headers for browser SDK testing
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "*")
	w.Header().Set("Access-Control-Expose-Headers", "ETag, Retry-After")

	// Handle preflight
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	s.mux.ServeHTTP(w, r)
}

func (s *Server) setupRoutes() {
	s.mux.HandleFunc("/api/v1/sdk/flags", s.handleFlags)
	s.mux.HandleFunc("/api/v1/sdk/v2/flags", s.handleFlagsV2)
	s.mux.HandleFunc("/api/v1/sdk/stream", s.handleSSE)
	s.mux.HandleFunc("/api/v1/sdk/identify", s.handleIdentify)
	s.mux.HandleFunc("/api/v1/sdk/events", s.handleEvents)
	s.mux.HandleFunc("/api/v1/test/set-error", s.handleSetError)
	s.mux.HandleFunc("/api/v1/test/clear-error", s.handleClearError)
	s.mux.HandleFunc("/api/v1/test/sse/send-event", s.handleSSESendEvent)
	s.mux.HandleFunc("/api/v1/test/sse/disconnect", s.handleSSEDisconnect)
	s.mux.HandleFunc("/api/v1/test/sse/clients", s.handleSSEClients)
	s.mux.HandleFunc("/api/v1/test/events", s.handleTestEvents)
	s.mux.HandleFunc("/api/v1/test/set-segment", s.handleSetSegment)
	s.mux.HandleFunc("/api/v1/sdk/telemetry", s.handleTelemetry)
	s.mux.HandleFunc("/api/v1/test/telemetry", s.handleTestTelemetry)
	s.mux.HandleFunc("/health", s.handleHealth)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (s *Server) handleSetError(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var sim ErrorSimulation
	if err := json.NewDecoder(r.Body).Decode(&sim); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.errorMu.Lock()
	s.errorSim = &sim
	s.errorCount = 0
	s.errorMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func (s *Server) handleClearError(w http.ResponseWriter, r *http.Request) {
	s.errorMu.Lock()
	s.errorSim = nil
	s.errorCount = 0
	s.errorMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// checkErrorSimulation checks if an error should be simulated and returns true if so.
func (s *Server) checkErrorSimulation(w http.ResponseWriter) bool {
	s.errorMu.Lock()

	if s.errorSim == nil {
		s.errorMu.Unlock()
		return false
	}

	// Check if we should still return errors
	if s.errorSim.Count != -1 && s.errorCount >= s.errorSim.Count {
		s.errorMu.Unlock()
		return false
	}

	s.errorCount++

	// Copy values we need before releasing the mutex
	delay := s.errorSim.Delay
	statusCode := s.errorSim.StatusCode
	message := s.errorSim.Message
	retryAfter := s.errorSim.RetryAfter
	s.errorMu.Unlock()

	// Apply delay AFTER releasing mutex so other requests aren't blocked
	if delay > 0 {
		time.Sleep(delay)
	}

	// Build error response
	if message == "" {
		message = http.StatusText(statusCode)
	}

	// Add Retry-After header for 429
	if statusCode == http.StatusTooManyRequests && retryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
	}

	// Determine error type based on status code
	errorType := "ServerError"
	switch statusCode {
	case http.StatusUnauthorized:
		errorType = "AuthenticationError"
	case http.StatusForbidden:
		errorType = "ForbiddenError"
	case http.StatusTooManyRequests:
		errorType = "RateLimitError"
	case http.StatusBadRequest:
		errorType = "ValidationError"
	case http.StatusNotFound:
		errorType = "NotFoundError"
	}

	// Determine if error is retryable based on status code
	retryable := statusCode >= 500 || statusCode == http.StatusTooManyRequests

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"code":      errorType,
			"category":  "internal",
			"message":   message,
			"retryable": retryable,
		},
	})

	return true
}

// extractUserContext extracts user context from request headers and query params.
// Priority: 1) X-User-Context header (base64 JSON), 2) X-User-ID/Email/Attributes headers, 3) query param user_id + session
func (s *Server) extractUserContext(r *http.Request) (string, map[string]interface{}) {
	// 1. Try X-User-Context header (base64-encoded JSON)
	if xuc := r.Header.Get("X-User-Context"); xuc != "" {
		decoded, err := base64.StdEncoding.DecodeString(xuc)
		if err != nil {
			// Try URL-safe base64
			decoded, err = base64.URLEncoding.DecodeString(xuc)
		}
		if err == nil {
			var ctx struct {
				ID         string                 `json:"id"`
				Email      string                 `json:"email"`
				Attributes map[string]interface{} `json:"attributes"`
			}
			if json.Unmarshal(decoded, &ctx) == nil && ctx.ID != "" {
				attrs := make(map[string]interface{})
				if ctx.Email != "" {
					attrs["email"] = ctx.Email
				}
				for k, v := range ctx.Attributes {
					attrs[k] = v
				}
				return ctx.ID, attrs
			}
		}
	}

	// 2. Try individual X-User-* headers
	if xuID := r.Header.Get("X-User-ID"); xuID != "" {
		attrs := make(map[string]interface{})
		if email := r.Header.Get("X-User-Email"); email != "" {
			attrs["email"] = email
		}
		if xAttrs := r.Header.Get("X-User-Attributes"); xAttrs != "" {
			var parsed map[string]interface{}
			if json.Unmarshal([]byte(xAttrs), &parsed) == nil {
				for k, v := range parsed {
					attrs[k] = v
				}
			}
		}
		return xuID, attrs
	}

	// 3. Fallback to query param user_id + session
	userID := r.URL.Query().Get("user_id")
	var userAttrs map[string]interface{}
	if userID != "" {
		s.userMu.RLock()
		userAttrs = s.userSessions[userID]
		s.userMu.RUnlock()
	}
	return userID, userAttrs
}

func (s *Server) handleFlags(w http.ResponseWriter, r *http.Request) {
	// Check for simulated errors first
	if s.checkErrorSimulation(w) {
		return
	}

	if !s.authenticate(r) {
		http.Error(w, `{"error":"AuthenticationError","message":"Invalid API key"}`, http.StatusUnauthorized)
		return
	}

	userID, userAttrs := s.extractUserContext(r)
	includeReasons := r.URL.Query().Get("withReasons") == "true"

	// Build V1 response: map[string]bool (enabled/disabled only)
	allFlags := s.flags.GetAll()
	evaluated := make(map[string]bool, len(allFlags))
	reasons := make(map[string]EvaluationReason, len(allFlags))

	for key, flag := range allFlags {
		result := s.evaluateFlagWithReason(flag, userID, userAttrs)
		evaluated[key] = result.Value
		reasons[key] = result.Reason
	}

	// Generate ETag
	etag := s.generateETag(evaluated)

	// Check If-None-Match
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag)

	response := map[string]interface{}{
		"flags": evaluated,
	}
	if includeReasons {
		response["reasons"] = reasons
	}
	json.NewEncoder(w).Encode(response)
}

// handleFlagsV2 returns flags with typed values (V2 format).
// Matches production: /api/v1/sdk/v2/flags
func (s *Server) handleFlagsV2(w http.ResponseWriter, r *http.Request) {
	if s.checkErrorSimulation(w) {
		return
	}

	if !s.authenticate(r) {
		http.Error(w, `{"error":"AuthenticationError","message":"Invalid API key"}`, http.StatusUnauthorized)
		return
	}

	userID, userAttrs := s.extractUserContext(r)

	allFlags := s.flags.GetAll()

	type V2FlagValue struct {
		Key     string              `json:"key"`
		Type    string              `json:"type"`
		Value   interface{}         `json:"value"`
		Enabled bool                `json:"enabled"`
		Reason  *EvaluationReason   `json:"reason,omitempty"`
	}

	evaluated := make(map[string]V2FlagValue, len(allFlags))

	for key, flag := range allFlags {
		result := s.evaluateFlagWithReason(flag, userID, userAttrs)
		typedValue := s.resolveTypedValueFromResult(flag, result)

		// Determine flag type
		flagType := "boolean"
		if flag.DefaultVariation != "" && len(flag.Variations) > 0 {
			switch flag.Variations[flag.DefaultVariation].(type) {
			case string:
				flagType = "string"
			case float64, int, int64:
				flagType = "number"
			case map[string]interface{}:
				flagType = "json"
			}
		}

		reason := result.Reason
		evaluated[key] = V2FlagValue{
			Key:     key,
			Type:    flagType,
			Value:   typedValue,
			Enabled: result.Value,
			Reason:  &reason,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"flags": evaluated,
	})
}

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	// Check auth from query param (EventSource doesn't support headers)
	token := r.URL.Query().Get("token")
	if token != s.apiKey {
		http.Error(w, `{"error":"AuthenticationError","message":"Invalid API key"}`, http.StatusUnauthorized)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	// Create client channel
	clientChan := make(chan []byte, 10)
	s.sseMu.Lock()
	s.sseClients[clientChan] = struct{}{}
	s.sseMu.Unlock()

	defer func() {
		s.sseMu.Lock()
		// Only close if still in map (wasn't already closed by DisconnectSSEClients)
		if _, exists := s.sseClients[clientChan]; exists {
			delete(s.sseClients, clientChan)
			s.sseMu.Unlock()
			close(clientChan)
		} else {
			s.sseMu.Unlock()
		}
	}()

	// Send initial flags (V1 format: map[string]bool)
	userID := r.URL.Query().Get("user_id")
	var userAttrs map[string]interface{}
	if userID != "" {
		s.userMu.RLock()
		userAttrs = s.userSessions[userID]
		s.userMu.RUnlock()
	}
	allFlags := s.flags.GetAll()
	evaluated := make(map[string]bool, len(allFlags))
	for key, flag := range allFlags {
		result := s.evaluateFlagWithReason(flag, userID, userAttrs)
		evaluated[key] = result.Value
	}

	initData, _ := json.Marshal(map[string]interface{}{"flags": evaluated})
	fmt.Fprintf(w, "event: init\ndata: %s\n\n", initData)
	flusher.Flush()

	// Keep connection open
	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-clientChan:
			if !ok {
				// Channel was closed (disconnect requested)
				return
			}
			fmt.Fprintf(w, "event: flag-changed\ndata: %s\n\n", msg)
			flusher.Flush()
		}
	}
}

func (s *Server) handleIdentify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !s.authenticate(r) {
		http.Error(w, `{"error":"AuthenticationError","message":"Invalid API key"}`, http.StatusUnauthorized)
		return
	}

	// Parse user context from body
	var body struct {
		User struct {
			ID         string                 `json:"id"`
			Email      string                 `json:"email"`
			Attributes map[string]interface{} `json:"attributes"`
		} `json:"user"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.User.ID != "" {
		// Store user session with attributes
		s.userMu.Lock()
		attrs := make(map[string]interface{})
		if body.User.Email != "" {
			attrs["email"] = body.User.Email
		}
		for k, v := range body.User.Attributes {
			attrs[k] = v
		}
		s.userSessions[body.User.ID] = attrs
		s.userMu.Unlock()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func (s *Server) authenticate(r *http.Request) bool {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return false
	}

	// Bearer token
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ") == s.apiKey
	}

	return auth == s.apiKey
}

func (s *Server) evaluateFlag(flag *FlagState, userID string, attrs map[string]interface{}) bool {
	result := s.evaluateFlagWithReason(flag, userID, attrs)
	return result.Value
}

// evaluateFlagValue returns the typed value (or bool for simple flags).
func (s *Server) evaluateFlagValue(flag *FlagState, userID string, attrs map[string]interface{}) interface{} {
	result := s.evaluateFlagWithReason(flag, userID, attrs)
	return s.resolveTypedValueFromResult(flag, result)
}

// resolveTypedValueFromResult returns the typed variation value based on evaluation result.
func (s *Server) resolveTypedValueFromResult(flag *FlagState, result EvaluationResult) interface{} {
	if len(flag.Variations) == 0 || flag.DefaultVariation == "" {
		return result.Value
	}
	if !result.Value {
		return result.Value
	}
	// If a rule matched with a specific variation, use that
	variation := flag.DefaultVariation
	if result.Variation != "" {
		variation = result.Variation
	}
	if val, ok := flag.Variations[variation]; ok {
		return val
	}
	return result.Value
}

// evaluateFlagWithReason evaluates a flag and returns both value and reason.
func (s *Server) evaluateFlagWithReason(flag *FlagState, userID string, attrs map[string]interface{}) EvaluationResult {
	if !flag.Enabled {
		return EvaluationResult{Value: false, Reason: EvaluationReason{Kind: "OFF"}}
	}

	// Check target users first
	for _, target := range flag.TargetUsers {
		if target == userID {
			return EvaluationResult{Value: true, Reason: EvaluationReason{Kind: "TARGET_MATCH"}}
		}
	}

	// Check rules
	if len(flag.Rules) > 0 {
		for i, rule := range flag.Rules {
			if !rule.Enabled {
				continue
			}
			if s.evaluateConditions(rule.Conditions, userID, attrs) {
				inRollout := s.evaluateRollout(rule.RolloutPercentage, userID, flag.Key)
				return EvaluationResult{
					Value:     inRollout,
					Variation: rule.Variation,
					Reason: EvaluationReason{
						Kind:      "RULE_MATCH",
						RuleID:    rule.ID,
						RuleIndex: i,
						InRollout: inRollout,
					},
				}
			}
		}
		// No rule matched - fall through to global rollout
	}

	// Global rollout (FALLTHROUGH)
	inRollout := s.evaluateRollout(flag.RolloutPercentage, userID, flag.Key)
	return EvaluationResult{
		Value:  inRollout,
		Reason: EvaluationReason{Kind: "FALLTHROUGH", InRollout: inRollout},
	}
}

func (s *Server) evaluateConditions(conditions []Condition, userID string, attrs map[string]interface{}) bool {
	if attrs == nil {
		attrs = make(map[string]interface{})
	}

	// Add userID as implicit attribute
	attrs["id"] = userID

	// Expand segment references
	conditions = s.expandSegmentConditions(conditions)

	for _, cond := range conditions {
		attrValue, ok := attrs[cond.Attribute]
		if !ok {
			return false
		}

		if !s.evaluateCondition(cond, attrValue) {
			return false
		}
	}
	return true
}

func (s *Server) evaluateCondition(cond Condition, attrValue interface{}) bool {
	attrStr := fmt.Sprintf("%v", attrValue)
	condStr := fmt.Sprintf("%v", cond.Value)

	switch cond.Operator {
	case "eq":
		return attrStr == condStr
	case "neq":
		return attrStr != condStr
	case "contains":
		return strings.Contains(attrStr, condStr)
	case "not_contains":
		return !strings.Contains(attrStr, condStr)
	case "starts_with":
		return strings.HasPrefix(attrStr, condStr)
	case "ends_with":
		return strings.HasSuffix(attrStr, condStr)
	case "gt":
		return compareNumbers(attrValue, cond.Value) > 0
	case "gte":
		return compareNumbers(attrValue, cond.Value) >= 0
	case "lt":
		return compareNumbers(attrValue, cond.Value) < 0
	case "lte":
		return compareNumbers(attrValue, cond.Value) <= 0
	case "in":
		if arr, ok := cond.Value.([]interface{}); ok {
			for _, v := range arr {
				if attrStr == fmt.Sprintf("%v", v) {
					return true
				}
			}
		}
		return false
	case "not_in":
		if arr, ok := cond.Value.([]interface{}); ok {
			for _, v := range arr {
				if attrStr == fmt.Sprintf("%v", v) {
					return false
				}
			}
		}
		return true
	case "regex":
		matched, err := regexp.MatchString(condStr, attrStr)
		return err == nil && matched
	case "semver_eq":
		return compareSemver(attrStr, condStr) == 0
	case "semver_gt":
		return compareSemver(attrStr, condStr) > 0
	case "semver_gte":
		return compareSemver(attrStr, condStr) >= 0
	case "semver_lt":
		return compareSemver(attrStr, condStr) < 0
	case "semver_lte":
		return compareSemver(attrStr, condStr) <= 0
	default:
		return false
	}
}

// compareNumbers compares two values as numbers. Returns -1, 0, or 1.
func compareNumbers(a, b interface{}) int {
	aFloat := toFloat(a)
	bFloat := toFloat(b)
	if aFloat < bFloat {
		return -1
	}
	if aFloat > bFloat {
		return 1
	}
	return 0
}

// toFloat converts a value to float64.
func toFloat(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int:
		return float64(val)
	case int64:
		return float64(val)
	case int32:
		return float64(val)
	case string:
		f, _ := strconv.ParseFloat(val, 64)
		return f
	default:
		f, _ := strconv.ParseFloat(fmt.Sprintf("%v", v), 64)
		return f
	}
}

// compareSemver compares two semantic versions. Returns -1, 0, or 1.
func compareSemver(a, b string) int {
	aParts := parseSemver(a)
	bParts := parseSemver(b)

	for i := 0; i < 3; i++ {
		if aParts[i] < bParts[i] {
			return -1
		}
		if aParts[i] > bParts[i] {
			return 1
		}
	}
	return 0
}

// parseSemver parses a semver string into [major, minor, patch].
func parseSemver(v string) [3]int {
	// Remove 'v' prefix if present
	v = strings.TrimPrefix(v, "v")

	parts := strings.Split(v, ".")
	var result [3]int
	for i := 0; i < len(parts) && i < 3; i++ {
		// Handle pre-release suffix (e.g., "1.0.0-beta")
		num := strings.Split(parts[i], "-")[0]
		result[i], _ = strconv.Atoi(num)
	}
	return result
}

func (s *Server) evaluateRollout(percentage int, userID, flagKey string) bool {
	if percentage >= 100 {
		return true
	}
	if percentage <= 0 {
		return false
	}

	// Consistent hashing
	h := fnv.New32a()
	h.Write([]byte(userID + ":" + flagKey))
	hash := h.Sum32()
	bucket := int(hash % 100)

	return bucket < percentage
}

func (s *Server) generateETag(flags interface{}) string {
	data, _ := json.Marshal(flags)
	hash := sha256.Sum256(data)
	return `"` + hex.EncodeToString(hash[:8]) + `"`
}

// BroadcastFlagChange notifies all SSE clients of a flag change.
func (s *Server) BroadcastFlagChange(flagKey string, enabled bool) {
	s.sseMu.Lock()
	defer s.sseMu.Unlock()

	data, _ := json.Marshal(map[string]interface{}{
		"key":     flagKey,
		"enabled": enabled,
	})

	for ch := range s.sseClients {
		select {
		case ch <- data:
		default:
			// Client not ready, skip
		}
	}
}

// SetScenario loads a test scenario.
func (s *Server) SetScenario(scenario string) {
	s.flags.LoadScenario(scenario)
}

// SetFlags sets multiple flags at once.
func (s *Server) SetFlags(flags []*FlagState) {
	for _, f := range flags {
		s.flags.Set(f)
	}
}

// SetFlag sets a single flag.
func (s *Server) SetFlag(flag *FlagState) {
	s.flags.Set(flag)
}

// Log helper for debugging (optional).
func (s *Server) Log(format string, args ...interface{}) {
	log.Printf("[MockServer] "+format, args...)
}

// SetError configures error simulation.
func (s *Server) SetError(sim *ErrorSimulation) {
	s.errorMu.Lock()
	defer s.errorMu.Unlock()
	s.errorSim = sim
	s.errorCount = 0
}

// ClearError removes error simulation.
func (s *Server) ClearError() {
	s.errorMu.Lock()
	defer s.errorMu.Unlock()
	s.errorSim = nil
	s.errorCount = 0
}

// GetErrorCount returns how many errors have been simulated.
func (s *Server) GetErrorCount() int {
	s.errorMu.Lock()
	defer s.errorMu.Unlock()
	return s.errorCount
}

// ClearUserSessions clears all user sessions.
func (s *Server) ClearUserSessions() {
	s.userMu.Lock()
	defer s.userMu.Unlock()
	s.userSessions = make(map[string]map[string]interface{})
}

// handleSSESendEvent sends a custom event to all SSE clients.
func (s *Server) handleSSESendEvent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Event string                 `json:"event"`
		Data  map[string]interface{} `json:"data"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Broadcast to all SSE clients
	data, _ := json.Marshal(body.Data)
	s.sseMu.Lock()
	clientCount := len(s.sseClients)
	for ch := range s.sseClients {
		select {
		case ch <- data:
		default:
			// Client not ready, skip
		}
	}
	s.sseMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"clients": clientCount,
	})
}

// handleSSEDisconnect closes all SSE connections.
func (s *Server) handleSSEDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.sseMu.Lock()
	clientCount := len(s.sseClients)
	// Close all client channels to trigger disconnect
	for ch := range s.sseClients {
		close(ch)
		delete(s.sseClients, ch)
	}
	s.sseMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"disconnected": clientCount,
	})
}

// handleSSEClients returns the count of connected SSE clients.
func (s *Server) handleSSEClients(w http.ResponseWriter, r *http.Request) {
	s.sseMu.Lock()
	clientCount := len(s.sseClients)
	s.sseMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"clients": clientCount,
	})
}

// GetSSEClientCount returns the count of connected SSE clients.
func (s *Server) GetSSEClientCount() int {
	s.sseMu.Lock()
	defer s.sseMu.Unlock()
	return len(s.sseClients)
}

// SendSSEEvent sends a custom event to all SSE clients.
func (s *Server) SendSSEEvent(data map[string]interface{}) int {
	encoded, _ := json.Marshal(data)
	s.sseMu.Lock()
	defer s.sseMu.Unlock()

	sent := 0
	for ch := range s.sseClients {
		select {
		case ch <- encoded:
			sent++
		default:
			// Client not ready
		}
	}
	return sent
}

// handleEvents receives tracked events from SDKs (POST /api/v1/sdk/events).
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !s.authenticate(r) {
		http.Error(w, `{"error":"AuthenticationError","message":"Invalid API key"}`, http.StatusUnauthorized)
		return
	}

	var body struct {
		Events []TrackEventItem `json:"events"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.eventsMu.Lock()
	s.receivedEvents = append(s.receivedEvents, body.Events...)
	s.eventsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"received": len(body.Events),
	})
}

// handleTestEvents is the test control endpoint for events (GET/DELETE /api/v1/test/events).
func (s *Server) handleTestEvents(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.eventsMu.Lock()
		events := make([]TrackEventItem, len(s.receivedEvents))
		copy(events, s.receivedEvents)
		s.eventsMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"events": events,
			"count":  len(events),
		})

	case http.MethodDelete:
		s.eventsMu.Lock()
		s.receivedEvents = nil
		s.eventsMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// GetReceivedEvents returns all events received by the mock server.
func (s *Server) GetReceivedEvents() []TrackEventItem {
	s.eventsMu.Lock()
	defer s.eventsMu.Unlock()
	events := make([]TrackEventItem, len(s.receivedEvents))
	copy(events, s.receivedEvents)
	return events
}

// ClearReceivedEvents clears all received events.
func (s *Server) ClearReceivedEvents() {
	s.eventsMu.Lock()
	defer s.eventsMu.Unlock()
	s.receivedEvents = nil
}

// DisconnectSSEClients disconnects all SSE clients.
func (s *Server) DisconnectSSEClients() int {
	s.sseMu.Lock()
	defer s.sseMu.Unlock()

	count := len(s.sseClients)
	for ch := range s.sseClients {
		close(ch)
		delete(s.sseClients, ch)
	}
	return count
}

// SetSegment registers a segment with the given ID and conditions.
func (s *Server) SetSegment(id string, conditions []Condition) {
	s.segmentsMu.Lock()
	defer s.segmentsMu.Unlock()
	s.segments[id] = conditions
}

// ClearSegments removes all segments.
func (s *Server) ClearSegments() {
	s.segmentsMu.Lock()
	defer s.segmentsMu.Unlock()
	s.segments = make(map[string][]Condition)
}

// handleSetSegment is the test control endpoint for setting segments.
func (s *Server) handleSetSegment(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		ID         string      `json:"id"`
		Conditions []Condition `json:"conditions"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.SetSegment(body.ID, body.Conditions)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// handleTelemetry receives telemetry data from SDKs (POST /api/v1/sdk/telemetry).
func (s *Server) handleTelemetry(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !s.authenticate(r) {
		http.Error(w, `{"error":"AuthenticationError","message":"Invalid API key"}`, http.StatusUnauthorized)
		return
	}

	var payload TelemetryPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	totalReceived := 0
	for _, stats := range payload.Evaluations {
		totalReceived += stats.Total
	}

	s.telemetryMu.Lock()
	s.receivedTelemetry = append(s.receivedTelemetry, payload)
	s.telemetryMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"received": totalReceived,
	})
}

// handleTestTelemetry is the test control endpoint for telemetry (GET/DELETE /api/v1/test/telemetry).
func (s *Server) handleTestTelemetry(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.telemetryMu.Lock()
		telemetry := make([]TelemetryPayload, len(s.receivedTelemetry))
		copy(telemetry, s.receivedTelemetry)
		s.telemetryMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"telemetry": telemetry,
			"count":     len(telemetry),
		})

	case http.MethodDelete:
		s.telemetryMu.Lock()
		s.receivedTelemetry = nil
		s.telemetryMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]bool{"success": true})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// GetReceivedTelemetry returns all telemetry received by the mock server.
func (s *Server) GetReceivedTelemetry() []TelemetryPayload {
	s.telemetryMu.Lock()
	defer s.telemetryMu.Unlock()
	telemetry := make([]TelemetryPayload, len(s.receivedTelemetry))
	copy(telemetry, s.receivedTelemetry)
	return telemetry
}

// ClearReceivedTelemetry clears all received telemetry.
func (s *Server) ClearReceivedTelemetry() {
	s.telemetryMu.Lock()
	defer s.telemetryMu.Unlock()
	s.receivedTelemetry = nil
}

// expandSegmentConditions replaces segment references in conditions with actual segment conditions.
// A segment reference is a condition with Attribute=="segment" and Operator=="in".
func (s *Server) expandSegmentConditions(conditions []Condition) []Condition {
	s.segmentsMu.RLock()
	defer s.segmentsMu.RUnlock()

	var expanded []Condition
	for _, cond := range conditions {
		if cond.Attribute == "segment" && cond.Operator == "in" {
			// Value is the segment ID (string)
			if segID, ok := cond.Value.(string); ok {
				if segConds, exists := s.segments[segID]; exists {
					expanded = append(expanded, segConds...)
					continue
				}
			}
			// Value could also be an array of segment IDs
			if segIDs, ok := cond.Value.([]interface{}); ok {
				for _, id := range segIDs {
					if segID, ok := id.(string); ok {
						if segConds, exists := s.segments[segID]; exists {
							expanded = append(expanded, segConds...)
						}
					}
				}
				continue
			}
		}
		expanded = append(expanded, cond)
	}
	return expanded
}
