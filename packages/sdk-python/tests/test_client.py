"""Tests for Rollgate client."""

import pytest
import httpx
import respx
from rollgate import RollgateClient, RollgateConfig, UserContext
from rollgate.circuit_breaker import CircuitState


@pytest.fixture
def mock_api():
    """Mock API responses."""
    with respx.mock:
        yield respx


@pytest.fixture
def config():
    """Create test configuration."""
    return RollgateConfig(
        api_key="test-api-key",
        base_url="https://api.rollgate.io",
        refresh_interval_ms=0,  # Disable polling for tests
    )


class TestRollgateClient:
    """Tests for RollgateClient class."""

    async def test_init_fetches_flags(self, mock_api, config):
        """init() should fetch flags from API."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"feature-a": True, "feature-b": False}},
            )
        )

        client = RollgateClient(config)
        await client.init()

        assert client.is_enabled("feature-a") is True
        assert client.is_enabled("feature-b") is False

        await client.close()

    async def test_is_enabled_returns_default_when_not_initialized(self, config):
        """is_enabled should return default when not initialized."""
        client = RollgateClient(config)

        assert client.is_enabled("feature-a") is False
        assert client.is_enabled("feature-a", default_value=True) is True

    async def test_is_enabled_returns_default_for_unknown_flag(self, mock_api, config):
        """is_enabled should return default for unknown flags."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"known-flag": True}},
            )
        )

        client = RollgateClient(config)
        await client.init()

        assert client.is_enabled("unknown-flag") is False
        assert client.is_enabled("unknown-flag", default_value=True) is True

        await client.close()

    async def test_get_all_flags(self, mock_api, config):
        """get_all_flags should return all flags."""
        flags = {"feature-a": True, "feature-b": False, "feature-c": True}
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(200, json={"flags": flags})
        )

        client = RollgateClient(config)
        await client.init()

        assert client.get_all_flags() == flags

        await client.close()

    async def test_identify_refetches_flags(self, mock_api, config):
        """identify() should refetch flags with user context."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"feature-a": False}},
            )
        )

        client = RollgateClient(config)
        await client.init()
        assert client.is_enabled("feature-a") is False

        # Update mock for user-specific response
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"feature-a": True}},
            )
        )

        await client.identify(UserContext(id="user-123", email="test@example.com"))
        assert client.is_enabled("feature-a") is True

        await client.close()

    async def test_refresh_fetches_new_flags(self, mock_api, config):
        """refresh() should fetch new flags."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"feature-a": False}},
            )
        )

        client = RollgateClient(config)
        await client.init()
        assert client.is_enabled("feature-a") is False

        # Update mock
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"feature-a": True}},
            )
        )

        await client.refresh()
        assert client.is_enabled("feature-a") is True

        await client.close()

    async def test_context_manager(self, mock_api, config):
        """Should work as async context manager."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"feature-a": True}},
            )
        )

        async with RollgateClient(config) as client:
            assert client.is_enabled("feature-a") is True


class TestClientEvents:
    """Tests for client events."""

    async def test_ready_event(self, mock_api, config):
        """Should emit ready event after init."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(200, json={"flags": {}})
        )

        events = []
        client = RollgateClient(config)
        client.on("ready", lambda: events.append("ready"))

        await client.init()

        assert "ready" in events
        await client.close()

    async def test_flags_updated_event(self, mock_api, config):
        """Should emit flags_updated event."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"a": True}},
            )
        )

        events = []
        client = RollgateClient(config)
        client.on("flags_updated", lambda flags: events.append(flags))

        await client.init()

        assert len(events) >= 1
        assert events[-1] == {"a": True}
        await client.close()

    async def test_flag_changed_event(self, mock_api, config):
        """Should emit flag_changed event when flag changes."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"a": False}},
            )
        )

        events = []
        client = RollgateClient(config)
        client.on("flag_changed", lambda key, new, old: events.append((key, new, old)))

        await client.init()

        # Update mock
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(
                200,
                json={"flags": {"a": True}},
            )
        )

        await client.refresh()

        assert ("a", True, False) in events
        await client.close()


class TestClientErrorHandling:
    """Tests for client error handling."""

    async def test_handles_401_error(self, mock_api, config):
        """Should handle 401 authentication error."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(401, json={"error": "Unauthorized"})
        )

        errors = []
        client = RollgateClient(config)
        client.on("error", lambda e: errors.append(e))

        await client.init()

        assert len(errors) >= 1
        await client.close()

    async def test_handles_network_error(self, mock_api, config):
        """Should handle network errors gracefully."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            side_effect=httpx.ConnectError("Connection refused")
        )

        client = RollgateClient(config)
        await client.init()

        # Should use default values
        assert client.is_enabled("feature-a") is False
        await client.close()


class TestCircuitBreakerIntegration:
    """Tests for circuit breaker integration."""

    async def test_circuit_state_property(self, mock_api, config):
        """Should expose circuit state."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(200, json={"flags": {}})
        )

        client = RollgateClient(config)
        await client.init()

        assert client.circuit_state == CircuitState.CLOSED
        await client.close()

    async def test_reset_circuit(self, mock_api, config):
        """Should allow resetting circuit."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(200, json={"flags": {}})
        )

        client = RollgateClient(config)
        await client.init()

        client.reset_circuit()
        assert client.circuit_state == CircuitState.CLOSED
        await client.close()


class TestCacheIntegration:
    """Tests for cache integration."""

    async def test_get_cache_stats(self, mock_api, config):
        """Should expose cache stats."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(200, json={"flags": {}})
        )

        client = RollgateClient(config)
        await client.init()

        stats = client.get_cache_stats()
        assert stats.size >= 0
        await client.close()

    async def test_clear_cache(self, mock_api, config):
        """Should allow clearing cache."""
        mock_api.get("https://api.rollgate.io/api/v1/sdk/flags").mock(
            return_value=httpx.Response(200, json={"flags": {}})
        )

        client = RollgateClient(config)
        await client.init()

        client.clear_cache()
        stats = client.get_cache_stats()
        assert stats.size == 0
        await client.close()
