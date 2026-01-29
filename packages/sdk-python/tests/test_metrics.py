"""Tests for SDK metrics."""

import pytest
from rollgate.metrics import (
    SDKMetrics,
    RequestMetrics,
    CircuitStateValue,
    get_metrics,
    create_metrics,
)


@pytest.fixture
def metrics():
    """Create a fresh metrics instance for each test."""
    return SDKMetrics()


class TestSDKMetrics:
    """Tests for SDKMetrics class."""

    def test_record_request_success(self, metrics):
        """Test recording successful requests."""
        metrics.record_request(RequestMetrics(
            endpoint="/api/v1/flags",
            status_code=200,
            latency_ms=50.0,
        ))

        snap = metrics.snapshot()
        assert snap.total_requests == 1
        assert snap.successful_requests == 1
        assert snap.failed_requests == 0

    def test_record_request_failure(self, metrics):
        """Test recording failed requests."""
        metrics.record_request(RequestMetrics(
            endpoint="/api/v1/flags",
            status_code=500,
            latency_ms=100.0,
            error="Server error",
            error_category="server",
        ))

        snap = metrics.snapshot()
        assert snap.total_requests == 1
        assert snap.successful_requests == 0
        assert snap.failed_requests == 1
        assert snap.errors_by_category.get("server") == 1

    def test_latency_stats(self, metrics):
        """Test latency statistics calculation."""
        for latency in [100, 200, 300]:
            metrics.record_request(RequestMetrics(
                endpoint="/api/v1/flags",
                status_code=200,
                latency_ms=float(latency),
            ))

        snap = metrics.snapshot()
        assert snap.min_latency_ms == 100
        assert snap.max_latency_ms == 300
        assert snap.avg_latency_ms == 200

    def test_cache_metrics(self, metrics):
        """Test cache metrics tracking."""
        metrics.record_request(RequestMetrics(
            endpoint="/api/v1/flags",
            status_code=200,
            latency_ms=10.0,
            cache_hit=True,
        ))
        metrics.record_request(RequestMetrics(
            endpoint="/api/v1/flags",
            status_code=304,
            latency_ms=5.0,
            not_modified=True,
        ))
        metrics.record_request(RequestMetrics(
            endpoint="/api/v1/flags",
            status_code=200,
            latency_ms=100.0,
            cache_hit=False,
        ))

        snap = metrics.snapshot()
        assert snap.cache_hits == 2  # cache_hit + not_modified
        assert snap.cache_misses == 1
        assert snap.not_modified_responses == 1
        assert snap.cache_hit_rate == pytest.approx(66.67, rel=0.1)

    def test_record_evaluation(self, metrics):
        """Test recording flag evaluations."""
        metrics.record_evaluation("feature-a", True, 1.0)
        metrics.record_evaluation("feature-a", True, 2.0)
        metrics.record_evaluation("feature-a", False, 1.5)
        metrics.record_evaluation("feature-b", True, 0.5)

        snap = metrics.snapshot()
        assert snap.flag_evaluations.total_evaluations == 4

        flag_a = snap.flag_evaluations.evaluations_per_flag["feature-a"]
        assert flag_a.evaluations == 3
        assert flag_a.true_count == 2
        assert flag_a.false_count == 1
        assert flag_a.true_rate == pytest.approx(66.67, rel=0.1)

    def test_circuit_state_change(self, metrics):
        """Test circuit breaker state tracking."""
        metrics.record_circuit_state_change(CircuitStateValue.OPEN)
        metrics.record_circuit_state_change(CircuitStateValue.HALF_OPEN)
        metrics.record_circuit_state_change(CircuitStateValue.CLOSED)
        metrics.record_circuit_state_change(CircuitStateValue.OPEN)

        snap = metrics.snapshot()
        assert snap.circuit_opens == 2
        assert snap.circuit_closes == 1
        assert snap.circuit_state == "open"

    def test_success_error_rates(self, metrics):
        """Test success and error rate calculations."""
        for _ in range(7):
            metrics.record_request(RequestMetrics(
                endpoint="/api",
                status_code=200,
                latency_ms=10.0,
            ))
        for _ in range(3):
            metrics.record_request(RequestMetrics(
                endpoint="/api",
                status_code=500,
                latency_ms=10.0,
            ))

        snap = metrics.snapshot()
        assert snap.success_rate == 70.0
        assert snap.error_rate == 30.0

    def test_percentiles(self, metrics):
        """Test percentile calculations."""
        # Add 100 requests with latencies 1-100ms
        for i in range(1, 101):
            metrics.record_request(RequestMetrics(
                endpoint="/api",
                status_code=200,
                latency_ms=float(i),
            ))

        snap = metrics.snapshot()
        assert snap.p50_latency_ms == pytest.approx(50, abs=5)
        assert snap.p95_latency_ms == pytest.approx(95, abs=5)
        assert snap.p99_latency_ms == pytest.approx(99, abs=2)

    def test_to_prometheus(self, metrics):
        """Test Prometheus format export."""
        metrics.record_request(RequestMetrics(
            endpoint="/api",
            status_code=200,
            latency_ms=50.0,
        ))
        metrics.record_evaluation("flag-1", True, 1.0)

        output = metrics.to_prometheus("rollgate_sdk")

        assert "rollgate_sdk_requests_total" in output
        assert "rollgate_sdk_latency_avg_ms" in output
        assert "rollgate_sdk_evaluations_total" in output
        assert "# HELP" in output
        assert "# TYPE" in output

    def test_reset(self, metrics):
        """Test resetting all metrics."""
        metrics.record_request(RequestMetrics(
            endpoint="/api",
            status_code=200,
            latency_ms=50.0,
        ))
        metrics.record_evaluation("flag-1", True)

        metrics.reset()
        snap = metrics.snapshot()

        assert snap.total_requests == 0
        assert snap.flag_evaluations.total_evaluations == 0

    def test_event_listeners(self, metrics):
        """Test event listener functionality."""
        events_received = []

        def on_request(snap):
            events_received.append(("request", snap))

        metrics.on("request", on_request)
        metrics.record_request(RequestMetrics(
            endpoint="/api",
            status_code=200,
            latency_ms=50.0,
        ))

        assert len(events_received) == 1
        assert events_received[0][0] == "request"

        # Test removal
        metrics.off("request", on_request)
        metrics.record_request(RequestMetrics(
            endpoint="/api",
            status_code=200,
            latency_ms=50.0,
        ))

        assert len(events_received) == 1  # No new event

    def test_global_metrics(self):
        """Test global metrics instance."""
        m1 = get_metrics()
        m2 = get_metrics()
        assert m1 is m2  # Same instance

        m3 = create_metrics()
        assert m3 is not m1  # New instance

    def test_time_window_metrics(self, metrics):
        """Test time-windowed metrics."""
        for _ in range(5):
            metrics.record_request(RequestMetrics(
                endpoint="/api",
                status_code=200,
                latency_ms=50.0,
            ))

        snap = metrics.snapshot()

        # All requests should be in all windows (just created)
        assert snap.windows.one_minute.requests == 5
        assert snap.windows.five_minutes.requests == 5
        assert snap.windows.fifteen_minutes.requests == 5
        assert snap.windows.one_hour.requests == 5
