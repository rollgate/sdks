"""
SDK Metrics Collection.
Tracks request performance, cache efficiency, error rates, and flag evaluations.
"""

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable, Any
from enum import Enum
from collections import defaultdict


class CircuitStateValue(Enum):
    """Circuit breaker state values."""
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half-open"


@dataclass
class WindowedStats:
    """Statistics for a time window."""
    requests: int = 0
    errors: int = 0
    avg_latency_ms: float = 0
    error_rate: float = 0


@dataclass
class FlagStats:
    """Statistics for a single flag."""
    evaluations: int = 0
    true_count: int = 0
    false_count: int = 0
    true_rate: float = 0
    avg_evaluation_time_ms: float = 0


@dataclass
class FlagEvaluationMetrics:
    """Flag evaluation metrics."""
    total_evaluations: int = 0
    evaluations_per_flag: Dict[str, FlagStats] = field(default_factory=dict)
    avg_evaluation_time_ms: float = 0


@dataclass
class TimeWindowMetrics:
    """Time-windowed metrics."""
    one_minute: WindowedStats = field(default_factory=WindowedStats)
    five_minutes: WindowedStats = field(default_factory=WindowedStats)
    fifteen_minutes: WindowedStats = field(default_factory=WindowedStats)
    one_hour: WindowedStats = field(default_factory=WindowedStats)


@dataclass
class MetricsSnapshot:
    """Complete snapshot of all metrics."""
    # Request metrics
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    success_rate: float = 0
    error_rate: float = 0

    # Latency metrics (in milliseconds)
    avg_latency_ms: float = 0
    min_latency_ms: float = 0
    max_latency_ms: float = 0
    p50_latency_ms: float = 0
    p95_latency_ms: float = 0
    p99_latency_ms: float = 0

    # Cache metrics
    cache_hits: int = 0
    cache_misses: int = 0
    cache_hit_rate: float = 0
    not_modified_responses: int = 0

    # Error metrics
    errors_by_category: Dict[str, int] = field(default_factory=dict)

    # Circuit breaker metrics
    circuit_opens: int = 0
    circuit_closes: int = 0
    circuit_state: str = "closed"

    # Flag evaluation metrics
    flag_evaluations: FlagEvaluationMetrics = field(default_factory=FlagEvaluationMetrics)

    # Time-windowed metrics
    windows: TimeWindowMetrics = field(default_factory=TimeWindowMetrics)

    # Timing
    uptime_ms: int = 0
    last_request_at: Optional[int] = None


@dataclass
class RequestMetrics:
    """Metrics for a single request."""
    endpoint: str
    status_code: int
    latency_ms: float
    cache_hit: bool = False
    not_modified: bool = False
    error: Optional[str] = None
    error_category: Optional[str] = None


@dataclass
class TimestampedRequest:
    """Request with timestamp for time windows."""
    timestamp: float
    latency_ms: float
    success: bool


@dataclass
class FlagEvaluation:
    """Record of a flag evaluation."""
    flag_key: str
    result: bool
    evaluation_time_ms: float
    timestamp: float


# Time windows in seconds
TIME_WINDOWS = {
    "1m": 60,
    "5m": 5 * 60,
    "15m": 15 * 60,
    "1h": 60 * 60,
}


class SDKMetrics:
    """
    Collects and reports SDK metrics.

    Example:
        ```python
        metrics = SDKMetrics()

        # Record a request
        metrics.record_request(RequestMetrics(
            endpoint="/api/v1/flags",
            status_code=200,
            latency_ms=45.2,
            cache_hit=False,
        ))

        # Record a flag evaluation
        metrics.record_evaluation("my-feature", True, 0.5)

        # Get snapshot
        snap = metrics.snapshot()
        print(f"Success rate: {snap.success_rate}%")

        # Export to Prometheus format
        print(metrics.to_prometheus())
        ```
    """

    def __init__(self):
        """Initialize metrics collector."""
        self._total_requests = 0
        self._successful_requests = 0
        self._failed_requests = 0
        self._cache_hits = 0
        self._cache_misses = 0
        self._not_modified_responses = 0
        self._circuit_opens = 0
        self._circuit_closes = 0
        self._circuit_state = CircuitStateValue.CLOSED

        self._latencies: List[float] = []
        self._max_latency_history = 1000

        self._errors_by_category: Dict[str, int] = defaultdict(int)

        # Time-windowed request tracking
        self._timestamped_requests: List[TimestampedRequest] = []
        self._max_timestamped_requests = 10000

        # Flag evaluation tracking
        self._flag_stats: Dict[str, Dict[str, Any]] = {}
        self._timestamped_evaluations: List[FlagEvaluation] = []
        self._max_timestamped_evaluations = 10000
        self._total_evaluations = 0
        self._total_evaluation_time_ms = 0.0

        self._start_time = time.time()
        self._last_request_at: Optional[float] = None

        # Event listeners
        self._listeners: Dict[str, List[Callable[[MetricsSnapshot], None]]] = defaultdict(list)

    def record_request(self, metrics: RequestMetrics) -> None:
        """
        Record a completed request.

        Args:
            metrics: Request metrics to record
        """
        now = time.time()
        self._total_requests += 1
        self._last_request_at = now

        success = 200 <= metrics.status_code < 400

        if success:
            self._successful_requests += 1
        else:
            self._failed_requests += 1

        # Track cache metrics
        if metrics.not_modified:
            self._not_modified_responses += 1
            self._cache_hits += 1
        elif metrics.cache_hit:
            self._cache_hits += 1
        else:
            self._cache_misses += 1

        # Track latency
        self._latencies.append(metrics.latency_ms)
        if len(self._latencies) > self._max_latency_history:
            self._latencies.pop(0)

        # Track timestamped request for time windows
        self._timestamped_requests.append(TimestampedRequest(
            timestamp=now,
            latency_ms=metrics.latency_ms,
            success=success,
        ))
        if len(self._timestamped_requests) > self._max_timestamped_requests:
            self._timestamped_requests.pop(0)

        # Track errors by category
        if metrics.error_category:
            self._errors_by_category[metrics.error_category] += 1

        # Emit update event
        self._emit("request", self.snapshot())

    def record_evaluation(
        self,
        flag_key: str,
        result: bool,
        evaluation_time_ms: float = 0,
    ) -> None:
        """
        Record a flag evaluation.

        Args:
            flag_key: The flag that was evaluated
            result: Evaluation result
            evaluation_time_ms: Time taken to evaluate
        """
        now = time.time()
        self._total_evaluations += 1
        self._total_evaluation_time_ms += evaluation_time_ms

        # Update per-flag stats
        if flag_key not in self._flag_stats:
            self._flag_stats[flag_key] = {
                "count": 0,
                "true_count": 0,
                "total_time_ms": 0,
            }

        stats = self._flag_stats[flag_key]
        stats["count"] += 1
        if result:
            stats["true_count"] += 1
        stats["total_time_ms"] += evaluation_time_ms

        # Track timestamped evaluation for time windows
        self._timestamped_evaluations.append(FlagEvaluation(
            flag_key=flag_key,
            result=result,
            evaluation_time_ms=evaluation_time_ms,
            timestamp=now,
        ))
        if len(self._timestamped_evaluations) > self._max_timestamped_evaluations:
            self._timestamped_evaluations.pop(0)

        # Emit update event
        self._emit("evaluation", self.snapshot())

    def record_circuit_state_change(self, new_state: CircuitStateValue) -> None:
        """
        Record a circuit breaker state change.

        Args:
            new_state: New circuit state
        """
        old_state = self._circuit_state
        self._circuit_state = new_state

        if new_state == CircuitStateValue.OPEN and old_state != CircuitStateValue.OPEN:
            self._circuit_opens += 1
        elif new_state == CircuitStateValue.CLOSED and old_state != CircuitStateValue.CLOSED:
            self._circuit_closes += 1

        self._emit("circuit-change", self.snapshot())

    def get_circuit_state(self) -> CircuitStateValue:
        """Get current circuit breaker state."""
        return self._circuit_state

    def on(
        self,
        event: str,
        callback: Callable[[MetricsSnapshot], None],
    ) -> None:
        """
        Subscribe to metrics events.

        Args:
            event: Event name ('request', 'evaluation', 'circuit-change')
            callback: Callback function
        """
        self._listeners[event].append(callback)

    def off(
        self,
        event: str,
        callback: Callable[[MetricsSnapshot], None],
    ) -> None:
        """
        Unsubscribe from metrics events.

        Args:
            event: Event name
            callback: Callback function to remove
        """
        if callback in self._listeners[event]:
            self._listeners[event].remove(callback)

    def _emit(self, event: str, data: MetricsSnapshot) -> None:
        """Emit an event to all listeners."""
        for callback in self._listeners.get(event, []):
            try:
                callback(data)
            except Exception:
                pass  # Ignore callback errors

    def snapshot(self) -> MetricsSnapshot:
        """
        Get a snapshot of all metrics.

        Returns:
            Complete metrics snapshot
        """
        sorted_latencies = sorted(self._latencies)
        total_cache_requests = self._cache_hits + self._cache_misses

        return MetricsSnapshot(
            total_requests=self._total_requests,
            successful_requests=self._successful_requests,
            failed_requests=self._failed_requests,
            success_rate=(
                (self._successful_requests / self._total_requests) * 100
                if self._total_requests > 0 else 0
            ),
            error_rate=(
                (self._failed_requests / self._total_requests) * 100
                if self._total_requests > 0 else 0
            ),

            avg_latency_ms=self._calculate_average(sorted_latencies),
            min_latency_ms=sorted_latencies[0] if sorted_latencies else 0,
            max_latency_ms=sorted_latencies[-1] if sorted_latencies else 0,
            p50_latency_ms=self._calculate_percentile(sorted_latencies, 50),
            p95_latency_ms=self._calculate_percentile(sorted_latencies, 95),
            p99_latency_ms=self._calculate_percentile(sorted_latencies, 99),

            cache_hits=self._cache_hits,
            cache_misses=self._cache_misses,
            cache_hit_rate=(
                (self._cache_hits / total_cache_requests) * 100
                if total_cache_requests > 0 else 0
            ),
            not_modified_responses=self._not_modified_responses,

            errors_by_category=dict(self._errors_by_category),

            circuit_opens=self._circuit_opens,
            circuit_closes=self._circuit_closes,
            circuit_state=self._circuit_state.value,

            flag_evaluations=self._get_flag_evaluation_metrics(),
            windows=self._get_time_window_metrics(),

            uptime_ms=int((time.time() - self._start_time) * 1000),
            last_request_at=(
                int(self._last_request_at * 1000)
                if self._last_request_at else None
            ),
        )

    def _get_flag_evaluation_metrics(self) -> FlagEvaluationMetrics:
        """Get flag evaluation metrics."""
        evaluations_per_flag: Dict[str, FlagStats] = {}

        for flag_key, stats in self._flag_stats.items():
            count = stats["count"]
            true_count = stats["true_count"]
            evaluations_per_flag[flag_key] = FlagStats(
                evaluations=count,
                true_count=true_count,
                false_count=count - true_count,
                true_rate=(true_count / count) * 100 if count > 0 else 0,
                avg_evaluation_time_ms=(
                    stats["total_time_ms"] / count if count > 0 else 0
                ),
            )

        return FlagEvaluationMetrics(
            total_evaluations=self._total_evaluations,
            evaluations_per_flag=evaluations_per_flag,
            avg_evaluation_time_ms=(
                self._total_evaluation_time_ms / self._total_evaluations
                if self._total_evaluations > 0 else 0
            ),
        )

    def _get_time_window_metrics(self) -> TimeWindowMetrics:
        """Get time-windowed metrics."""
        now = time.time()
        return TimeWindowMetrics(
            one_minute=self._calculate_window_stats(now, TIME_WINDOWS["1m"]),
            five_minutes=self._calculate_window_stats(now, TIME_WINDOWS["5m"]),
            fifteen_minutes=self._calculate_window_stats(now, TIME_WINDOWS["15m"]),
            one_hour=self._calculate_window_stats(now, TIME_WINDOWS["1h"]),
        )

    def _calculate_window_stats(self, now: float, window_seconds: float) -> WindowedStats:
        """Calculate stats for a time window."""
        cutoff = now - window_seconds
        window_requests = [r for r in self._timestamped_requests if r.timestamp >= cutoff]

        requests = len(window_requests)
        errors = sum(1 for r in window_requests if not r.success)
        total_latency = sum(r.latency_ms for r in window_requests)

        return WindowedStats(
            requests=requests,
            errors=errors,
            avg_latency_ms=total_latency / requests if requests > 0 else 0,
            error_rate=(errors / requests) * 100 if requests > 0 else 0,
        )

    def to_prometheus(self, prefix: str = "rollgate_sdk") -> str:
        """
        Export metrics in Prometheus format.

        Args:
            prefix: Metric name prefix

        Returns:
            Metrics in Prometheus text format
        """
        snap = self.snapshot()
        lines: List[str] = []

        def metric(name: str, value: float, help_text: str = "", metric_type: str = ""):
            full_name = f"{prefix}_{name}"
            if help_text:
                lines.append(f"# HELP {full_name} {help_text}")
            if metric_type:
                lines.append(f"# TYPE {full_name} {metric_type}")
            lines.append(f"{full_name} {value}")

        # Request metrics
        metric("requests_total", snap.total_requests, "Total number of requests", "counter")
        metric("requests_success_total", snap.successful_requests, "Total successful requests", "counter")
        metric("requests_failed_total", snap.failed_requests, "Total failed requests", "counter")

        # Latency metrics
        metric("latency_avg_ms", snap.avg_latency_ms, "Average request latency in milliseconds", "gauge")
        metric("latency_p50_ms", snap.p50_latency_ms, "50th percentile latency", "gauge")
        metric("latency_p95_ms", snap.p95_latency_ms, "95th percentile latency", "gauge")
        metric("latency_p99_ms", snap.p99_latency_ms, "99th percentile latency", "gauge")

        # Cache metrics
        metric("cache_hits_total", snap.cache_hits, "Total cache hits", "counter")
        metric("cache_misses_total", snap.cache_misses, "Total cache misses", "counter")
        metric("cache_hit_rate", snap.cache_hit_rate, "Cache hit rate percentage", "gauge")

        # Circuit breaker metrics
        metric("circuit_opens_total", snap.circuit_opens, "Total circuit breaker opens", "counter")
        circuit_value = 0 if snap.circuit_state == "closed" else (1 if snap.circuit_state == "open" else 0.5)
        metric("circuit_state", circuit_value, "Circuit breaker state (0=closed, 0.5=half-open, 1=open)", "gauge")

        # Flag evaluation metrics
        metric("evaluations_total", snap.flag_evaluations.total_evaluations, "Total flag evaluations", "counter")
        metric(
            "evaluation_avg_time_ms",
            snap.flag_evaluations.avg_evaluation_time_ms,
            "Average evaluation time in milliseconds",
            "gauge",
        )

        # Uptime
        metric("uptime_seconds", snap.uptime_ms / 1000, "SDK uptime in seconds", "gauge")

        return "\n".join(lines)

    def reset(self) -> None:
        """Reset all metrics."""
        self._total_requests = 0
        self._successful_requests = 0
        self._failed_requests = 0
        self._cache_hits = 0
        self._cache_misses = 0
        self._not_modified_responses = 0
        self._circuit_opens = 0
        self._circuit_closes = 0
        self._circuit_state = CircuitStateValue.CLOSED
        self._latencies = []
        self._errors_by_category = defaultdict(int)
        self._timestamped_requests = []
        self._flag_stats = {}
        self._timestamped_evaluations = []
        self._total_evaluations = 0
        self._total_evaluation_time_ms = 0.0
        self._start_time = time.time()
        self._last_request_at = None

    @staticmethod
    def _calculate_average(sorted_values: List[float]) -> float:
        """Calculate average of sorted values."""
        if not sorted_values:
            return 0
        return sum(sorted_values) / len(sorted_values)

    @staticmethod
    def _calculate_percentile(sorted_values: List[float], percentile: float) -> float:
        """Calculate percentile of sorted values."""
        if not sorted_values:
            return 0
        index = int((percentile / 100) * len(sorted_values)) - 1
        return sorted_values[max(0, index)]


# Global metrics instance
_global_metrics: Optional[SDKMetrics] = None


def get_metrics() -> SDKMetrics:
    """Get or create the global metrics instance."""
    global _global_metrics
    if _global_metrics is None:
        _global_metrics = SDKMetrics()
    return _global_metrics


def create_metrics() -> SDKMetrics:
    """Create a new metrics instance (useful for testing)."""
    return SDKMetrics()
