"""Tests for W3C Trace Context support."""

import pytest
from rollgate.tracing import (
    TraceContext,
    RequestTrace,
    TracingManager,
    generate_trace_id,
    generate_span_id,
    generate_request_id,
    get_tracer,
    create_tracer,
    HEADER_TRACEPARENT,
    HEADER_TRACE_ID,
    HEADER_SPAN_ID,
    HEADER_REQUEST_ID,
)


class TestTraceContext:
    """Tests for TraceContext class."""

    def test_generate_trace_id(self):
        """Test trace ID generation."""
        trace_id = generate_trace_id()
        assert len(trace_id) == 32
        assert all(c in "0123456789abcdef" for c in trace_id)

    def test_generate_span_id(self):
        """Test span ID generation."""
        span_id = generate_span_id()
        assert len(span_id) == 16
        assert all(c in "0123456789abcdef" for c in span_id)

    def test_generate_request_id(self):
        """Test request ID generation."""
        request_id = generate_request_id()
        assert request_id.startswith("req_")
        assert len(request_id) == 28  # "req_" + 24 hex chars

    def test_default_context(self):
        """Test default context creation."""
        ctx = TraceContext()
        assert len(ctx.trace_id) == 32
        assert len(ctx.span_id) == 16
        assert ctx.parent_id is None
        assert ctx.request_id.startswith("req_")
        assert ctx.sampled is True

    def test_get_headers(self):
        """Test header generation."""
        ctx = TraceContext(
            trace_id="a" * 32,
            span_id="b" * 16,
            sampled=True,
        )

        headers = ctx.get_headers()

        assert headers[HEADER_TRACEPARENT] == f"00-{'a' * 32}-{'b' * 16}-01"
        assert headers[HEADER_TRACE_ID] == "a" * 32
        assert headers[HEADER_SPAN_ID] == "b" * 16
        assert HEADER_REQUEST_ID in headers

    def test_get_headers_not_sampled(self):
        """Test header generation for non-sampled traces."""
        ctx = TraceContext(
            trace_id="a" * 32,
            span_id="b" * 16,
            sampled=False,
        )

        headers = ctx.get_headers()
        assert headers[HEADER_TRACEPARENT].endswith("-00")

    def test_create_child(self):
        """Test child context creation."""
        parent = TraceContext(
            trace_id="a" * 32,
            span_id="b" * 16,
        )

        child = parent.create_child()

        assert child.trace_id == parent.trace_id
        assert child.span_id != parent.span_id
        assert child.parent_id == parent.span_id
        assert child.request_id == parent.request_id

    def test_from_traceparent(self):
        """Test parsing traceparent header."""
        traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

        ctx = TraceContext.from_traceparent(traceparent)

        assert ctx is not None
        assert ctx.trace_id == "4bf92f3577b34da6a3ce929d0e0e4736"
        assert ctx.parent_id == "00f067aa0ba902b7"
        assert ctx.sampled is True

    def test_from_traceparent_not_sampled(self):
        """Test parsing non-sampled traceparent."""
        traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00"

        ctx = TraceContext.from_traceparent(traceparent)

        assert ctx is not None
        assert ctx.sampled is False

    def test_from_traceparent_invalid(self):
        """Test parsing invalid traceparent returns None."""
        invalid_values = [
            "",
            "invalid",
            "00-short-00f067aa0ba902b7-01",
            "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",  # Wrong version
        ]

        for value in invalid_values:
            assert TraceContext.from_traceparent(value) is None

    def test_from_headers_traceparent(self):
        """Test extracting context from headers with traceparent."""
        headers = {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            "x-request-id": "req_test123",
        }

        ctx = TraceContext.from_headers(headers)

        assert ctx is not None
        assert ctx.trace_id == "4bf92f3577b34da6a3ce929d0e0e4736"
        assert ctx.request_id == "req_test123"

    def test_from_headers_custom(self):
        """Test extracting context from custom headers."""
        headers = {
            "x-trace-id": "a" * 32,
            "x-span-id": "b" * 16,
            "x-request-id": "req_custom",
        }

        ctx = TraceContext.from_headers(headers)

        assert ctx is not None
        assert ctx.trace_id == "a" * 32
        assert ctx.request_id == "req_custom"

    def test_from_headers_empty(self):
        """Test extracting context from empty headers."""
        ctx = TraceContext.from_headers({})
        assert ctx is None


class TestRequestTrace:
    """Tests for RequestTrace class."""

    def test_timing(self):
        """Test request timing."""
        ctx = TraceContext()
        trace = RequestTrace(context=ctx, endpoint="/api/v1/flags")

        trace.start()
        # Simulate some work
        import time
        time.sleep(0.01)
        trace.finish(200)

        assert trace.latency_ms > 0
        assert trace.latency_ms < 100  # Should be ~10ms

    def test_success(self):
        """Test success detection."""
        ctx = TraceContext()
        trace = RequestTrace(context=ctx, endpoint="/api")

        trace.start()
        trace.finish(200)
        assert trace.success is True

        trace2 = RequestTrace(context=ctx, endpoint="/api")
        trace2.start()
        trace2.finish(500)
        assert trace2.success is False

        trace3 = RequestTrace(context=ctx, endpoint="/api")
        trace3.start()
        trace3.finish(200, error="Something went wrong")
        assert trace3.success is False


class TestTracingManager:
    """Tests for TracingManager class."""

    def test_create_context(self):
        """Test context creation."""
        tracer = TracingManager()
        ctx = tracer.create_context()

        assert ctx is not None
        assert len(ctx.trace_id) == 32

    def test_create_child_context(self):
        """Test child context creation."""
        tracer = TracingManager()
        parent = tracer.create_context()
        child = tracer.create_context(parent)

        assert child.trace_id == parent.trace_id
        assert child.parent_id == parent.span_id

    def test_extract_context(self):
        """Test context extraction from headers."""
        tracer = TracingManager()
        headers = {
            "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        }

        ctx = tracer.extract_context(headers)
        assert ctx is not None
        assert ctx.trace_id == "4bf92f3577b34da6a3ce929d0e0e4736"

    def test_inject_headers(self):
        """Test header injection."""
        tracer = TracingManager()
        ctx = TraceContext(trace_id="a" * 32, span_id="b" * 16)

        headers = tracer.inject_headers({}, ctx)

        assert HEADER_TRACEPARENT in headers
        assert HEADER_TRACE_ID in headers

    def test_trace_request_context_manager(self):
        """Test trace_request context manager."""
        tracer = TracingManager()

        with tracer.trace_request("/api/v1/flags") as trace:
            trace.finish(200)

        traces = tracer.get_recent_traces()
        assert len(traces) == 1
        assert traces[0].endpoint == "/api/v1/flags"

    def test_disabled_tracer(self):
        """Test disabled tracer."""
        tracer = TracingManager(enabled=False)

        ctx = tracer.extract_context({"traceparent": "00-a" * 16 + "-b" * 8 + "-01"})
        assert ctx is None

        headers = tracer.inject_headers({"existing": "value"})
        assert headers == {"existing": "value"}

    def test_sample_rate(self):
        """Test sample rate."""
        tracer = TracingManager(enabled=True, sample_rate=0.0)

        ctx = tracer.create_context()
        assert ctx.sampled is False

        tracer2 = TracingManager(enabled=True, sample_rate=1.0)
        ctx2 = tracer2.create_context()
        assert ctx2.sampled is True

    def test_get_stats(self):
        """Test statistics."""
        tracer = TracingManager()

        with tracer.trace_request("/api") as trace:
            trace.finish(200)

        with tracer.trace_request("/api") as trace:
            trace.finish(500)

        stats = tracer.get_stats()
        assert stats["trace_count"] == 2
        assert stats["error_rate"] == 0.5

    def test_clear_traces(self):
        """Test clearing traces."""
        tracer = TracingManager()

        with tracer.trace_request("/api") as trace:
            trace.finish(200)

        tracer.clear_traces()
        assert len(tracer.get_recent_traces()) == 0

    def test_global_tracer(self):
        """Test global tracer instance."""
        t1 = get_tracer()
        t2 = get_tracer()
        assert t1 is t2

        t3 = create_tracer()
        assert t3 is not t1
