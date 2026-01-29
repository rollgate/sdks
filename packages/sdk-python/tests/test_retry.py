"""Tests for retry logic."""

import pytest
from rollgate.retry import (
    RetryConfig,
    calculate_backoff,
    is_retryable_error,
    fetch_with_retry,
)
from rollgate.errors import (
    AuthenticationError,
    NetworkError,
    RateLimitError,
    RollgateError,
)


class TestCalculateBackoff:
    """Tests for calculate_backoff function."""

    def test_exponential_increase(self):
        """Backoff should increase exponentially."""
        config = RetryConfig(
            base_delay_ms=100,
            max_delay_ms=10000,
            jitter_factor=0,  # No jitter for predictable testing
        )

        delay0 = calculate_backoff(0, config)
        delay1 = calculate_backoff(1, config)
        delay2 = calculate_backoff(2, config)

        # Without jitter: 100ms, 200ms, 400ms
        assert delay0 == pytest.approx(0.1, rel=0.01)
        assert delay1 == pytest.approx(0.2, rel=0.01)
        assert delay2 == pytest.approx(0.4, rel=0.01)

    def test_capped_at_max_delay(self):
        """Backoff should be capped at max_delay."""
        config = RetryConfig(
            base_delay_ms=100,
            max_delay_ms=500,
            jitter_factor=0,
        )

        delay = calculate_backoff(10, config)  # Would be 102400ms without cap
        assert delay == pytest.approx(0.5, rel=0.01)

    def test_jitter_adds_variance(self):
        """Jitter should add variance to delays."""
        config = RetryConfig(
            base_delay_ms=1000,
            max_delay_ms=10000,
            jitter_factor=0.5,
        )

        delays = [calculate_backoff(0, config) for _ in range(100)]

        # Should have some variance
        assert min(delays) < max(delays)

        # All should be within expected range (1000ms +/- 50%)
        for delay in delays:
            assert 0.5 <= delay <= 1.5


class TestIsRetryableError:
    """Tests for is_retryable_error function."""

    def test_network_errors_are_retryable(self):
        """Network errors should be retryable."""
        assert is_retryable_error(NetworkError("Connection refused"))
        assert is_retryable_error(Exception("ECONNREFUSED"))
        assert is_retryable_error(Exception("Connection timeout"))

    def test_server_errors_are_retryable(self):
        """5xx errors should be retryable."""
        assert is_retryable_error(Exception("500 Internal Server Error"))
        assert is_retryable_error(Exception("503 Service Unavailable"))
        assert is_retryable_error(Exception("502 Bad Gateway"))

    def test_rate_limit_is_retryable(self):
        """429 errors should be retryable."""
        assert is_retryable_error(RateLimitError())
        assert is_retryable_error(Exception("429 Too Many Requests"))

    def test_auth_errors_are_not_retryable(self):
        """Auth errors should not be retryable."""
        assert not is_retryable_error(AuthenticationError())
        assert not is_retryable_error(Exception("401 Unauthorized"))
        assert not is_retryable_error(Exception("403 Forbidden"))

    def test_client_errors_are_not_retryable(self):
        """4xx client errors should not be retryable."""
        assert not is_retryable_error(Exception("400 Bad Request"))
        assert not is_retryable_error(Exception("404 Not Found"))

    def test_rollgate_error_uses_retryable_flag(self):
        """RollgateError should use its retryable flag."""
        retryable = RollgateError("test", retryable=True)
        not_retryable = RollgateError("test", retryable=False)

        assert is_retryable_error(retryable)
        assert not is_retryable_error(not_retryable)


class TestFetchWithRetry:
    """Tests for fetch_with_retry function."""

    async def test_success_on_first_try(self):
        """Should return success on first try."""
        call_count = 0

        async def success():
            nonlocal call_count
            call_count += 1
            return "ok"

        result = await fetch_with_retry(success)

        assert result.success
        assert result.data == "ok"
        assert result.attempts == 1
        assert call_count == 1

    async def test_retries_on_retryable_error(self):
        """Should retry on retryable errors."""
        call_count = 0
        config = RetryConfig(max_retries=3, base_delay_ms=10)

        async def fail_twice():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise Exception("ECONNREFUSED")
            return "ok"

        result = await fetch_with_retry(fail_twice, config)

        assert result.success
        assert result.data == "ok"
        assert result.attempts == 3
        assert call_count == 3

    async def test_no_retry_on_non_retryable_error(self):
        """Should not retry non-retryable errors."""
        call_count = 0
        config = RetryConfig(max_retries=3, base_delay_ms=10)

        async def auth_fail():
            nonlocal call_count
            call_count += 1
            raise AuthenticationError("Invalid API key")

        result = await fetch_with_retry(auth_fail, config)

        assert not result.success
        assert isinstance(result.error, AuthenticationError)
        assert result.attempts == 1
        assert call_count == 1

    async def test_exhausts_all_retries(self):
        """Should exhaust all retries on persistent failure."""
        call_count = 0
        config = RetryConfig(max_retries=3, base_delay_ms=10)

        async def always_fail():
            nonlocal call_count
            call_count += 1
            raise NetworkError("Connection refused")

        result = await fetch_with_retry(always_fail, config)

        assert not result.success
        assert isinstance(result.error, NetworkError)
        assert result.attempts == 4  # 1 initial + 3 retries
        assert call_count == 4
