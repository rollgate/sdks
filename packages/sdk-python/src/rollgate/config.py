"""Configuration classes for Rollgate SDK."""

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class RetryConfig:
    """Retry configuration settings."""

    max_retries: int = 3
    base_delay: float = 0.1  # seconds
    max_delay: float = 10.0  # seconds
    jitter_factor: float = 0.1


@dataclass
class CircuitBreakerConfig:
    """Circuit breaker configuration settings."""

    failure_threshold: int = 5
    recovery_timeout: float = 30.0  # seconds
    monitoring_window: float = 60.0  # seconds
    success_threshold: int = 3


@dataclass
class CacheConfig:
    """Cache configuration settings."""

    ttl: float = 300.0  # 5 minutes
    stale_ttl: float = 3600.0  # 1 hour
    enabled: bool = True


@dataclass
class UserContext:
    """User context for flag targeting."""

    id: str
    email: Optional[str] = None
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass
class Config:
    """Main configuration for Rollgate client."""

    api_key: str
    base_url: str = "https://api.rollgate.io"
    timeout: float = 5.0  # seconds
    refresh_interval: float = 30.0  # seconds
    enable_streaming: bool = False
    sse_url: Optional[str] = None
    retry: RetryConfig = field(default_factory=RetryConfig)
    circuit_breaker: CircuitBreakerConfig = field(default_factory=CircuitBreakerConfig)
    cache: CacheConfig = field(default_factory=CacheConfig)
