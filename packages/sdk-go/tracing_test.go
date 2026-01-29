package rollgate

import (
	"net/http"
	"strings"
	"testing"
)

func TestGenerateTraceID(t *testing.T) {
	traceID := GenerateTraceID()
	if len(traceID) != 32 {
		t.Errorf("TraceID should be 32 characters, got %d", len(traceID))
	}
}

func TestGenerateSpanID(t *testing.T) {
	spanID := GenerateSpanID()
	if len(spanID) != 16 {
		t.Errorf("SpanID should be 16 characters, got %d", len(spanID))
	}
}

func TestGenerateRequestID(t *testing.T) {
	requestID := GenerateRequestID()
	if !strings.HasPrefix(requestID, "rg-") {
		t.Errorf("RequestID should start with 'rg-', got %s", requestID)
	}
}

func TestNewTraceContext(t *testing.T) {
	ctx := NewTraceContext()

	if ctx.TraceID == "" {
		t.Error("TraceID should not be empty")
	}
	if ctx.SpanID == "" {
		t.Error("SpanID should not be empty")
	}
	if ctx.RequestID == "" {
		t.Error("RequestID should not be empty")
	}
	if !ctx.Sampled {
		t.Error("Sampled should be true by default")
	}
}

func TestNewTraceContextWithParent(t *testing.T) {
	parent := NewTraceContext()
	child := NewTraceContextWithParent(parent)

	if child.TraceID != parent.TraceID {
		t.Error("Child should inherit parent's TraceID")
	}
	if child.ParentID != parent.SpanID {
		t.Error("Child's ParentID should be parent's SpanID")
	}
	if child.SpanID == parent.SpanID {
		t.Error("Child should have a new SpanID")
	}
	if child.RequestID != parent.RequestID {
		t.Error("Child should inherit parent's RequestID")
	}
}

func TestGetHeaders(t *testing.T) {
	ctx := &TraceContext{
		TraceID:   "0123456789abcdef0123456789abcdef",
		SpanID:    "0123456789abcdef",
		ParentID:  "fedcba9876543210",
		RequestID: "rg-20240101120000-abcd",
		Sampled:   true,
	}

	headers := ctx.GetHeaders()

	if headers[HeaderTraceID] != ctx.TraceID {
		t.Error("TraceID header mismatch")
	}
	if headers[HeaderSpanID] != ctx.SpanID {
		t.Error("SpanID header mismatch")
	}
	if headers[HeaderParentSpanID] != ctx.ParentID {
		t.Error("ParentSpanID header mismatch")
	}
	if headers[HeaderRequestID] != ctx.RequestID {
		t.Error("RequestID header mismatch")
	}

	expectedTraceparent := "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
	if headers[HeaderTraceparent] != expectedTraceparent {
		t.Errorf("Traceparent mismatch, expected %s, got %s", expectedTraceparent, headers[HeaderTraceparent])
	}
}

func TestParseTraceparent(t *testing.T) {
	tests := []struct {
		name    string
		header  string
		valid   bool
		traceID string
		spanID  string
		sampled bool
	}{
		{
			name:    "valid sampled",
			header:  "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
			valid:   true,
			traceID: "0123456789abcdef0123456789abcdef",
			spanID:  "0123456789abcdef",
			sampled: true,
		},
		{
			name:    "valid not sampled",
			header:  "00-0123456789abcdef0123456789abcdef-0123456789abcdef-00",
			valid:   true,
			traceID: "0123456789abcdef0123456789abcdef",
			spanID:  "0123456789abcdef",
			sampled: false,
		},
		{
			name:   "invalid version",
			header: "01-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
			valid:  false,
		},
		{
			name:   "invalid format",
			header: "invalid",
			valid:  false,
		},
		{
			name:   "short trace id",
			header: "00-0123456789abcdef-0123456789abcdef-01",
			valid:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ParseTraceparent(tt.header)
			if tt.valid {
				if result == nil {
					t.Error("Expected valid result, got nil")
					return
				}
				if result.TraceID != tt.traceID {
					t.Errorf("TraceID mismatch: expected %s, got %s", tt.traceID, result.TraceID)
				}
				if result.SpanID != tt.spanID {
					t.Errorf("SpanID mismatch: expected %s, got %s", tt.spanID, result.SpanID)
				}
				if result.Sampled != tt.sampled {
					t.Errorf("Sampled mismatch: expected %v, got %v", tt.sampled, result.Sampled)
				}
			} else {
				if result != nil {
					t.Error("Expected nil result for invalid header")
				}
			}
		})
	}
}

func TestParseTraceHeaders(t *testing.T) {
	headers := http.Header{}
	headers.Set(HeaderTraceID, "0123456789abcdef0123456789abcdef")
	headers.Set(HeaderSpanID, "0123456789abcdef")
	headers.Set(HeaderRequestID, "rg-test")

	ctx := ParseTraceHeaders(headers)

	if ctx.TraceID != "0123456789abcdef0123456789abcdef" {
		t.Error("TraceID not parsed correctly")
	}
	if ctx.SpanID != "0123456789abcdef" {
		t.Error("SpanID not parsed correctly")
	}
	if ctx.RequestID != "rg-test" {
		t.Error("RequestID not parsed correctly")
	}
}

func TestRequestTrace(t *testing.T) {
	trace := NewRequestTrace("test-request")

	if trace.RequestID != "test-request" {
		t.Error("RequestID not set correctly")
	}
	if trace.StartTime.IsZero() {
		t.Error("StartTime should be set")
	}

	trace.Complete(200, "server-trace-123", nil)

	if trace.StatusCode != 200 {
		t.Error("StatusCode not set correctly")
	}
	if trace.ServerTraceID != "server-trace-123" {
		t.Error("ServerTraceID not set correctly")
	}
	if trace.DurationMs < 0 {
		t.Error("DurationMs should be >= 0")
	}
}

func TestTraceContextString(t *testing.T) {
	ctx := &TraceContext{
		TraceID:   "trace123",
		SpanID:    "span456",
		ParentID:  "parent789",
		RequestID: "req-abc",
	}

	str := ctx.String()

	if !strings.Contains(str, "trace_id=trace123") {
		t.Error("String should contain trace_id")
	}
	if !strings.Contains(str, "span_id=span456") {
		t.Error("String should contain span_id")
	}
	if !strings.Contains(str, "parent_id=parent789") {
		t.Error("String should contain parent_id")
	}
	if !strings.Contains(str, "request_id=req-abc") {
		t.Error("String should contain request_id")
	}
}
