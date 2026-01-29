"""Tests for request deduplication."""

import asyncio
import pytest
from rollgate.dedup import RequestDeduplicator, DedupConfig


@pytest.fixture
def dedup():
    """Create a fresh deduplicator for each test."""
    return RequestDeduplicator(DedupConfig(enabled=True, ttl_ms=5000))


class TestRequestDeduplicator:
    """Tests for RequestDeduplicator class."""

    @pytest.mark.asyncio
    async def test_single_request(self, dedup):
        """Test that a single request executes normally."""
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            return "result"

        result = await dedup.dedupe("key1", fetch)

        assert result == "result"
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_concurrent_requests_deduplicated(self, dedup):
        """Test that concurrent identical requests are deduplicated."""
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.1)  # Simulate network delay
            return f"result-{call_count}"

        # Launch multiple concurrent requests
        results = await asyncio.gather(
            dedup.dedupe("key1", fetch),
            dedup.dedupe("key1", fetch),
            dedup.dedupe("key1", fetch),
        )

        # All should get the same result
        assert results[0] == results[1] == results[2]
        # But only one actual call should be made
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_different_keys_not_deduplicated(self, dedup):
        """Test that requests with different keys are not deduplicated."""
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            return f"result-{call_count}"

        result1 = await dedup.dedupe("key1", fetch)
        result2 = await dedup.dedupe("key2", fetch)

        assert result1 != result2
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_sequential_requests_not_deduplicated(self, dedup):
        """Test that sequential requests are not deduplicated."""
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            return f"result-{call_count}"

        result1 = await dedup.dedupe("key1", fetch)
        result2 = await dedup.dedupe("key1", fetch)

        # After first completes, second should make new request
        assert result1 == "result-1"
        assert result2 == "result-2"
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_error_propagation(self, dedup):
        """Test that errors are propagated to all waiters."""
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.05)
            raise ValueError("Test error")

        with pytest.raises(ValueError, match="Test error"):
            await asyncio.gather(
                dedup.dedupe("key1", fetch),
                dedup.dedupe("key1", fetch),
            )

        # Only one actual call should be made
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_disabled_dedup(self):
        """Test that disabled deduplicator doesn't dedupe."""
        dedup = RequestDeduplicator(DedupConfig(enabled=False))
        call_count = 0

        async def fetch():
            nonlocal call_count
            call_count += 1
            my_count = call_count  # Capture value before await
            await asyncio.sleep(0.05)
            return f"result-{my_count}"

        results = await asyncio.gather(
            dedup.dedupe("key1", fetch),
            dedup.dedupe("key1", fetch),
        )

        # Both calls should execute
        assert call_count == 2
        assert results[0] != results[1]

    @pytest.mark.asyncio
    async def test_stats(self, dedup):
        """Test statistics tracking."""
        async def fetch():
            await asyncio.sleep(0.05)
            return "result"

        # First request
        await dedup.dedupe("key1", fetch)

        # Concurrent requests (will be deduplicated)
        await asyncio.gather(
            dedup.dedupe("key2", fetch),
            dedup.dedupe("key2", fetch),
            dedup.dedupe("key2", fetch),
        )

        stats = dedup.get_stats()

        assert stats["total_requests"] == 4
        assert stats["deduplicated_requests"] == 2  # 2 of the key2 requests
        assert stats["dedup_rate"] == 0.5

    @pytest.mark.asyncio
    async def test_inflight_count(self, dedup):
        """Test inflight request counting."""
        started = asyncio.Event()
        continue_event = asyncio.Event()

        async def fetch():
            started.set()
            await continue_event.wait()
            return "result"

        # Start a request
        task = asyncio.create_task(dedup.dedupe("key1", fetch))
        await started.wait()

        # Check inflight count
        assert dedup.inflight_count == 1

        # Complete the request
        continue_event.set()
        await task

        # Should be 0 after completion
        assert dedup.inflight_count == 0

    @pytest.mark.asyncio
    async def test_clear(self, dedup):
        """Test clearing inflight requests."""
        started = asyncio.Event()

        async def fetch():
            started.set()
            await asyncio.sleep(10)  # Long delay
            return "result"

        # Start a request
        task = asyncio.create_task(dedup.dedupe("key1", fetch))
        await started.wait()

        # Clear
        await dedup.clear()

        assert dedup.inflight_count == 0

        # Cancel the task
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_reset_stats(self, dedup):
        """Test resetting statistics."""
        async def fetch():
            return "result"

        await dedup.dedupe("key1", fetch)
        await dedup.dedupe("key2", fetch)

        dedup.reset_stats()
        stats = dedup.get_stats()

        assert stats["total_requests"] == 0
        assert stats["deduplicated_requests"] == 0
