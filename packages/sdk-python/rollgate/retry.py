"""
Retry utility with exponential backoff and jitter.
"""

import asyncio
import random
from dataclasses import dataclass, field
from typing import Callable, TypeVar, Optional, Awaitable, Generic

from rollgate.errors import RollgateError

T = TypeVar("T")


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""

    max_retries: int = 3
    """Maximum number of retry attempts."""

    base_delay_ms: int = 100
    """Base delay in milliseconds."""

    max_delay_ms: int = 10000
    """Maximum delay in milliseconds."""

    jitter_factor: float = 0.1
    """Jitter factor 0-1 to randomize delays."""


@dataclass
class RetryResult(Generic[T]):
    """Result of a retry operation."""

    success: bool
    data: Optional[T] = None
    error: Optional[Exception] = None
    attempts: int = 1


DEFAULT_RETRY_CONFIG = RetryConfig()


def calculate_backoff(attempt: int, config: RetryConfig) -> float:
    """
    Calculate backoff delay with exponential increase and jitter.

    Args:
        attempt: Current attempt number (0-indexed)
        config: Retry configuration

    Returns:
        Delay in seconds
    """
    # Exponential: base_delay * 2^attempt
    exponential_delay = config.base_delay_ms * (2**attempt)

    # Cap at max_delay
    capped_delay = min(exponential_delay, config.max_delay_ms)

    # Add jitter: random value between -jitter and +jitter
    jitter = capped_delay * config.jitter_factor * (random.random() * 2 - 1)

    delay_ms = max(0, capped_delay + jitter)
    return delay_ms / 1000.0  # Convert to seconds


def is_retryable_error(error: Exception) -> bool:
    """
    Check if an error is retryable.

    Args:
        error: The exception to check

    Returns:
        True if the error should be retried
    """
    if isinstance(error, RollgateError):
        return error.retryable

    message = str(error).lower()

    # Network errors (always retry)
    network_indicators = [
        "econnrefused",
        "etimedout",
        "enotfound",
        "econnreset",
        "network",
        "connection",
        "timeout",
        "dns",
    ]
    if any(indicator in message for indicator in network_indicators):
        return True

    # HTTP 5xx errors (server issues, retry)
    server_errors = ["500", "502", "503", "504"]
    if any(code in message for code in server_errors):
        return True

    # Rate limiting (retry with backoff)
    if "429" in message or "too many requests" in message:
        return True

    # HTTP 4xx errors (client errors, don't retry)
    client_errors = ["400", "401", "403", "404"]
    if any(code in message for code in client_errors):
        return False

    return False


async def fetch_with_retry(
    fn: Callable[[], Awaitable[T]],
    config: Optional[RetryConfig] = None,
) -> RetryResult[T]:
    """
    Execute an async function with retry logic and exponential backoff.

    Args:
        fn: Async function to execute
        config: Retry configuration

    Returns:
        RetryResult with success status and data/error
    """
    cfg = config or DEFAULT_RETRY_CONFIG
    last_error: Optional[Exception] = None

    for attempt in range(cfg.max_retries + 1):
        try:
            data = await fn()
            return RetryResult(success=True, data=data, attempts=attempt + 1)
        except Exception as error:
            last_error = error

            # Don't retry non-retryable errors
            if not is_retryable_error(error):
                return RetryResult(success=False, error=error, attempts=attempt + 1)

            # Don't sleep after the last attempt
            if attempt < cfg.max_retries:
                delay = calculate_backoff(attempt, cfg)
                await asyncio.sleep(delay)

    return RetryResult(
        success=False,
        error=last_error or Exception("Retry exhausted"),
        attempts=cfg.max_retries + 1,
    )


async def retry_async(
    fn: Callable[[], Awaitable[T]],
    config: Optional[RetryConfig] = None,
) -> T:
    """
    Execute an async function with retry, raising on failure.

    Args:
        fn: Async function to execute
        config: Retry configuration

    Returns:
        Result of the function

    Raises:
        Exception: The last error if all retries fail
    """
    result = await fetch_with_retry(fn, config)

    if not result.success:
        raise result.error  # type: ignore

    return result.data  # type: ignore
