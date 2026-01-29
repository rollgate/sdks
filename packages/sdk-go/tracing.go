package rollgate

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// TraceContext holds distributed tracing information
type TraceContext struct {
	TraceID   string
	SpanID    string
	ParentID  string
	RequestID string
	Sampled   bool
}

// TraceHeaders contains header names for trace propagation
const (
	HeaderTraceID      = "X-Trace-ID"
	HeaderSpanID       = "X-Span-ID"
	HeaderParentSpanID = "X-Parent-Span-ID"
	HeaderRequestID    = "X-Request-ID"
	HeaderTraceparent  = "traceparent"
)

// RequestTrace tracks timing and metadata for a single request
type RequestTrace struct {
	RequestID     string
	ServerTraceID string
	StartTime     time.Time
	EndTime       time.Time
	DurationMs    int64
	StatusCode    int
	Error         error
}

// randomHex generates a random hex string of the specified byte length
func randomHex(bytes int) string {
	b := make([]byte, bytes)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// GenerateTraceID creates a new 32-character trace ID
func GenerateTraceID() string {
	return randomHex(16)
}

// GenerateSpanID creates a new 16-character span ID
func GenerateSpanID() string {
	return randomHex(8)
}

// GenerateRequestID creates a human-readable request ID
// Format: rg-YYYYMMDDHHMMSS-RANDOM
func GenerateRequestID() string {
	timestamp := time.Now().Format("20060102150405")
	random := randomHex(4)
	return fmt.Sprintf("rg-%s-%s", timestamp, random)
}

// NewTraceContext creates a new trace context
func NewTraceContext() *TraceContext {
	return &TraceContext{
		TraceID:   GenerateTraceID(),
		SpanID:    GenerateSpanID(),
		RequestID: GenerateRequestID(),
		Sampled:   true,
	}
}

// NewTraceContextWithParent creates a child trace context
func NewTraceContextWithParent(parent *TraceContext) *TraceContext {
	if parent == nil {
		return NewTraceContext()
	}
	return &TraceContext{
		TraceID:   parent.TraceID,
		SpanID:    GenerateSpanID(),
		ParentID:  parent.SpanID,
		RequestID: parent.RequestID,
		Sampled:   parent.Sampled,
	}
}

// CreateChildSpan creates a child span from this context
func (tc *TraceContext) CreateChildSpan() *TraceContext {
	return NewTraceContextWithParent(tc)
}

// GetHeaders returns headers to inject into outgoing HTTP requests
func (tc *TraceContext) GetHeaders() map[string]string {
	headers := map[string]string{
		HeaderTraceID:   tc.TraceID,
		HeaderSpanID:    tc.SpanID,
		HeaderRequestID: tc.RequestID,
	}

	if tc.ParentID != "" {
		headers[HeaderParentSpanID] = tc.ParentID
	}

	// W3C Trace Context format
	flags := "00"
	if tc.Sampled {
		flags = "01"
	}
	headers[HeaderTraceparent] = fmt.Sprintf("00-%s-%s-%s", tc.TraceID, tc.SpanID, flags)

	return headers
}

// InjectHeaders adds trace headers to an HTTP request
func (tc *TraceContext) InjectHeaders(req *http.Request) {
	for key, value := range tc.GetHeaders() {
		req.Header.Set(key, value)
	}
}

// String returns a formatted string for logging
func (tc *TraceContext) String() string {
	parts := []string{
		fmt.Sprintf("trace_id=%s", tc.TraceID),
		fmt.Sprintf("span_id=%s", tc.SpanID),
	}

	if tc.ParentID != "" {
		parts = append(parts, fmt.Sprintf("parent_id=%s", tc.ParentID))
	}

	parts = append(parts, fmt.Sprintf("request_id=%s", tc.RequestID))

	return strings.Join(parts, " ")
}

// ParseTraceHeaders extracts trace context from HTTP response headers
func ParseTraceHeaders(headers http.Header) *TraceContext {
	ctx := &TraceContext{
		Sampled: true,
	}

	if traceID := headers.Get(HeaderTraceID); traceID != "" {
		ctx.TraceID = traceID
	}

	if spanID := headers.Get(HeaderSpanID); spanID != "" {
		ctx.SpanID = spanID
	}

	if parentID := headers.Get(HeaderParentSpanID); parentID != "" {
		ctx.ParentID = parentID
	}

	if requestID := headers.Get(HeaderRequestID); requestID != "" {
		ctx.RequestID = requestID
	}

	// Also try to parse W3C traceparent
	if traceparent := headers.Get(HeaderTraceparent); traceparent != "" && ctx.TraceID == "" {
		if parsed := ParseTraceparent(traceparent); parsed != nil {
			ctx.TraceID = parsed.TraceID
			ctx.SpanID = parsed.SpanID
			ctx.Sampled = parsed.Sampled
		}
	}

	return ctx
}

// TraceparentData holds parsed W3C traceparent data
type TraceparentData struct {
	TraceID string
	SpanID  string
	Sampled bool
}

var traceparentRegex = regexp.MustCompile(`^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$`)

// ParseTraceparent parses a W3C Trace Context traceparent header
func ParseTraceparent(header string) *TraceparentData {
	matches := traceparentRegex.FindStringSubmatch(strings.ToLower(header))
	if matches == nil {
		return nil
	}

	return &TraceparentData{
		TraceID: matches[1],
		SpanID:  matches[2],
		Sampled: matches[3] == "01",
	}
}

// NewRequestTrace creates a new request trace for timing
func NewRequestTrace(requestID string) *RequestTrace {
	return &RequestTrace{
		RequestID: requestID,
		StartTime: time.Now(),
	}
}

// Complete finalizes the request trace with response information
func (rt *RequestTrace) Complete(statusCode int, serverTraceID string, err error) {
	rt.EndTime = time.Now()
	rt.DurationMs = rt.EndTime.Sub(rt.StartTime).Milliseconds()
	rt.StatusCode = statusCode
	rt.ServerTraceID = serverTraceID
	rt.Error = err
}
