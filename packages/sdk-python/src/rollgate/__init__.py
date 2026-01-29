"""Rollgate Python SDK for feature flags."""

from rollgate.client import RollgateClient
from rollgate.config import Config, RetryConfig, CircuitBreakerConfig, CacheConfig
from rollgate.errors import (
    RollgateError,
    NetworkError,
    AuthenticationError,
    RateLimitError,
    ValidationError,
    ServerError,
    CircuitOpenError,
)
from rollgate.circuit_breaker import CircuitState

__version__ = "0.1.0"

__all__ = [
    "RollgateClient",
    "Config",
    "RetryConfig",
    "CircuitBreakerConfig",
    "CacheConfig",
    "RollgateError",
    "NetworkError",
    "AuthenticationError",
    "RateLimitError",
    "ValidationError",
    "ServerError",
    "CircuitOpenError",
    "CircuitState",
]
