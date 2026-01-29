"""
W3C Trace Context support for distributed tracing.
Implements traceparent header format for request correlation.
"""

import re
import time
import secrets
from dataclasses import dataclass, field
from typing import Dict, Optional, List
from contextlib import contextmanager


# W3C Trace Context header names
HEADER_TRACEPARENT = "traceparent"
HEADER_TRACESTATE = "tracestate"
HEADER_TRACE_ID = "x-trace-id"
HEADER_SPAN_ID = "x-span-id"
HEADER_REQUEST_ID = "x-request-id"

# W3C traceparent format: version-trace_id-parent_id-flags
# Example: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
TRACEPARENT_REGEX = re.compile(
    r"^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$"
)


def generate_trace_id() -> str:
    """Generate a 32-character hex trace ID."""
    return secrets.token_hex(16)


def generate_span_id() -> str:
    """Generate a 16-character hex span ID."""
    return secrets.token_hex(8)


def generate_request_id() -> str:
    """Generate a unique request ID."""
    return f"req_{secrets.token_hex(12)}"


@dataclass
class TraceContext:
    """
    Represents W3C Trace Context for distributed tracing.

    The traceparent header format is:
    {version}-{trace-id}-{parent-id}-{flags}

    Example:
        00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

    Where:
    - version: 2 hex chars (always "00" for current version)
    - trace-id: 32 hex chars
    - parent-id: 16 hex chars
    - flags: 2 hex chars (01 = sampled)
    """

    trace_id: str = field(default_factory=generate_trace_id)
    """32-character hex trace ID."""

    span_id: str = field(default_factory=generate_span_id)
    """16-character hex span ID."""

    parent_id: Optional[str] = None
    """Parent span ID for nested spans."""

    request_id: str = field(default_factory=generate_request_id)
    """Human-readable request ID."""

    sampled: bool = True
    """Whether this trace should be sampled."""

    def get_headers(self) -> Dict[str, str]:
        """
        Get headers to propagate trace context.

        Returns:
            Dictionary of headers to add to outgoing requests
        """
        flags = "01" if self.sampled else "00"
        traceparent = f"00-{self.trace_id}-{self.span_id}-{flags}"

        return {
            HEADER_TRACEPARENT: traceparent,
            HEADER_TRACE_ID: self.trace_id,
            HEADER_SPAN_ID: self.span_id,
            HEADER_REQUEST_ID: self.request_id,
        }

    def create_child(self) -> "TraceContext":
        """
        Create a child span context.

        Returns:
            New TraceContext with same trace_id but new span_id
        """
        return TraceContext(
            trace_id=self.trace_id,
            span_id=generate_span_id(),
            parent_id=self.span_id,
            request_id=self.request_id,
            sampled=self.sampled,
        )

    @classmethod
    def from_traceparent(cls, traceparent: str) -> Optional["TraceContext"]:
        """
        Parse a traceparent header.

        Args:
            traceparent: W3C traceparent header value

        Returns:
            TraceContext if valid, None if invalid
        """
        match = TRACEPARENT_REGEX.match(traceparent.lower())
        if not match:
            return None

        version, trace_id, parent_id, flags = match.groups()

        # Only support version 00
        if version != "00":
            return None

        return cls(
            trace_id=trace_id,
            span_id=generate_span_id(),
            parent_id=parent_id,
            sampled=flags == "01",
        )

    @classmethod
    def from_headers(cls, headers: Dict[str, str]) -> Optional["TraceContext"]:
        """
        Extract trace context from request headers.

        Args:
            headers: Request headers (case-insensitive)

        Returns:
            TraceContext if found, None otherwise
        """
        # Normalize header names to lowercase
        normalized = {k.lower(): v for k, v in headers.items()}

        # Try W3C traceparent first
        traceparent = normalized.get(HEADER_TRACEPARENT)
        if traceparent:
            ctx = cls.from_traceparent(traceparent)
            if ctx:
                # Preserve request ID if present
                request_id = normalized.get(HEADER_REQUEST_ID)
                if request_id:
                    ctx.request_id = request_id
                return ctx

        # Fall back to custom headers
        trace_id = normalized.get(HEADER_TRACE_ID)
        span_id = normalized.get(HEADER_SPAN_ID)
        request_id = normalized.get(HEADER_REQUEST_ID)

        if trace_id:
            return cls(
                trace_id=trace_id,
                span_id=span_id or generate_span_id(),
                request_id=request_id or generate_request_id(),
            )

        return None


@dataclass
class RequestTrace:
    """
    Tracks timing for a single request.

    Example:
        ```python
        trace = RequestTrace(
            context=TraceContext(),
            endpoint="/api/v1/flags",
        )
        trace.start()
        # ... make request ...
        trace.finish(200)
        print(f"Latency: {trace.latency_ms}ms")
        ```
    """

    context: TraceContext
    """Trace context for this request."""

    endpoint: str
    """API endpoint being called."""

    start_time: float = 0
    """Start timestamp (seconds since epoch)."""

    end_time: float = 0
    """End timestamp (seconds since epoch)."""

    status_code: int = 0
    """HTTP status code."""

    error: Optional[str] = None
    """Error message if request failed."""

    def start(self) -> None:
        """Mark request start time."""
        self.start_time = time.time()

    def finish(self, status_code: int, error: Optional[str] = None) -> None:
        """
        Mark request end time.

        Args:
            status_code: HTTP status code
            error: Error message if failed
        """
        self.end_time = time.time()
        self.status_code = status_code
        self.error = error

    @property
    def latency_ms(self) -> float:
        """Get request latency in milliseconds."""
        if self.end_time == 0 or self.start_time == 0:
            return 0
        return (self.end_time - self.start_time) * 1000

    @property
    def success(self) -> bool:
        """Check if request was successful."""
        return 200 <= self.status_code < 400 and self.error is None


class TracingManager:
    """
    Manages trace contexts for the SDK.

    Thread-safe management of trace context propagation.

    Example:
        ```python
        tracer = TracingManager()

        # Create a new trace
        ctx = tracer.create_context()

        # Track a request
        with tracer.trace_request("/api/v1/flags") as trace:
            response = await client.get(url, headers=trace.context.get_headers())
            trace.finish(response.status_code)
        ```
    """

    def __init__(self, enabled: bool = True, sample_rate: float = 1.0):
        """
        Initialize tracing manager.

        Args:
            enabled: Whether tracing is enabled
            sample_rate: Fraction of requests to sample (0.0 to 1.0)
        """
        self._enabled = enabled
        self._sample_rate = sample_rate
        self._traces: List[RequestTrace] = []
        self._max_traces = 1000

    @property
    def enabled(self) -> bool:
        """Check if tracing is enabled."""
        return self._enabled

    @enabled.setter
    def enabled(self, value: bool) -> None:
        """Enable or disable tracing."""
        self._enabled = value

    def create_context(
        self,
        parent: Optional[TraceContext] = None,
    ) -> TraceContext:
        """
        Create a new trace context.

        Args:
            parent: Optional parent context for nested spans

        Returns:
            New TraceContext
        """
        if parent:
            return parent.create_child()

        # Determine if this trace should be sampled
        sampled = self._enabled and (secrets.randbelow(100) / 100 < self._sample_rate)

        return TraceContext(sampled=sampled)

    def extract_context(self, headers: Dict[str, str]) -> Optional[TraceContext]:
        """
        Extract trace context from headers.

        Args:
            headers: Request headers

        Returns:
            TraceContext if found
        """
        if not self._enabled:
            return None
        return TraceContext.from_headers(headers)

    def inject_headers(
        self,
        headers: Dict[str, str],
        context: Optional[TraceContext] = None,
    ) -> Dict[str, str]:
        """
        Inject trace context into headers.

        Args:
            headers: Existing headers
            context: Trace context (creates new if None)

        Returns:
            Headers with trace context added
        """
        if not self._enabled:
            return headers

        ctx = context or self.create_context()
        result = dict(headers)
        result.update(ctx.get_headers())
        return result

    @contextmanager
    def trace_request(
        self,
        endpoint: str,
        parent: Optional[TraceContext] = None,
    ):
        """
        Context manager for tracing a request.

        Args:
            endpoint: API endpoint
            parent: Optional parent context

        Yields:
            RequestTrace to record timing
        """
        ctx = self.create_context(parent)
        trace = RequestTrace(context=ctx, endpoint=endpoint)
        trace.start()

        try:
            yield trace
        finally:
            # Store trace if enabled
            if self._enabled and trace.end_time > 0:
                self._traces.append(trace)
                if len(self._traces) > self._max_traces:
                    self._traces.pop(0)

    def get_recent_traces(self, limit: int = 100) -> List[RequestTrace]:
        """
        Get recent request traces.

        Args:
            limit: Maximum number of traces to return

        Returns:
            List of recent RequestTrace objects
        """
        return self._traces[-limit:]

    def clear_traces(self) -> None:
        """Clear all stored traces."""
        self._traces = []

    def get_stats(self) -> Dict[str, float]:
        """
        Get tracing statistics.

        Returns:
            Dictionary with trace_count, avg_latency_ms, error_rate
        """
        traces = self._traces
        if not traces:
            return {
                "trace_count": 0,
                "avg_latency_ms": 0,
                "error_rate": 0,
            }

        completed = [t for t in traces if t.end_time > 0]
        if not completed:
            return {
                "trace_count": len(traces),
                "avg_latency_ms": 0,
                "error_rate": 0,
            }

        total_latency = sum(t.latency_ms for t in completed)
        errors = sum(1 for t in completed if not t.success)

        return {
            "trace_count": len(traces),
            "avg_latency_ms": total_latency / len(completed),
            "error_rate": errors / len(completed),
        }


# Global tracer instance
_global_tracer: Optional[TracingManager] = None


def get_tracer() -> TracingManager:
    """Get or create the global tracer instance."""
    global _global_tracer
    if _global_tracer is None:
        _global_tracer = TracingManager()
    return _global_tracer


def create_tracer(enabled: bool = True, sample_rate: float = 1.0) -> TracingManager:
    """Create a new tracer instance."""
    return TracingManager(enabled=enabled, sample_rate=sample_rate)
