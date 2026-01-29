"""
Error types for Rollgate SDK.

Provides structured error handling with categories for better error management.
"""

from enum import Enum
from typing import Optional


class ErrorCategory(str, Enum):
    """Categories of errors for classification."""

    AUTH = "auth"
    NETWORK = "network"
    RATE_LIMIT = "rate_limit"
    VALIDATION = "validation"
    NOT_FOUND = "not_found"
    INTERNAL = "internal"
    UNKNOWN = "unknown"


class RollgateError(Exception):
    """Base exception for all Rollgate SDK errors."""

    def __init__(
        self,
        message: str,
        category: ErrorCategory = ErrorCategory.UNKNOWN,
        status_code: Optional[int] = None,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.message = message
        self.category = category
        self.status_code = status_code
        self.retryable = retryable

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(message={self.message!r}, category={self.category})"


class AuthenticationError(RollgateError):
    """Raised when authentication fails (401/403)."""

    def __init__(self, message: str = "Authentication failed", status_code: int = 401):
        super().__init__(
            message,
            category=ErrorCategory.AUTH,
            status_code=status_code,
            retryable=False,
        )


class NetworkError(RollgateError):
    """Raised when a network error occurs."""

    def __init__(self, message: str = "Network error"):
        super().__init__(
            message,
            category=ErrorCategory.NETWORK,
            status_code=None,
            retryable=True,
        )


class RateLimitError(RollgateError):
    """Raised when rate limited (429)."""

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        retry_after: Optional[int] = None,
    ):
        super().__init__(
            message,
            category=ErrorCategory.RATE_LIMIT,
            status_code=429,
            retryable=True,
        )
        self.retry_after = retry_after


class ValidationError(RollgateError):
    """Raised when validation fails (400)."""

    def __init__(self, message: str = "Validation error"):
        super().__init__(
            message,
            category=ErrorCategory.VALIDATION,
            status_code=400,
            retryable=False,
        )


class NotFoundError(RollgateError):
    """Raised when resource not found (404)."""

    def __init__(self, message: str = "Resource not found"):
        super().__init__(
            message,
            category=ErrorCategory.NOT_FOUND,
            status_code=404,
            retryable=False,
        )


class InternalError(RollgateError):
    """Raised when server error occurs (5xx)."""

    def __init__(self, message: str = "Internal server error", status_code: int = 500):
        super().__init__(
            message,
            category=ErrorCategory.INTERNAL,
            status_code=status_code,
            retryable=True,
        )


def classify_error(error: Exception, status_code: Optional[int] = None) -> RollgateError:
    """
    Classify an exception into a RollgateError.

    Args:
        error: The original exception
        status_code: Optional HTTP status code

    Returns:
        A classified RollgateError
    """
    if isinstance(error, RollgateError):
        return error

    message = str(error)

    # Network errors
    network_indicators = [
        "connection",
        "timeout",
        "econnrefused",
        "etimedout",
        "enotfound",
        "network",
        "dns",
    ]
    if any(indicator in message.lower() for indicator in network_indicators):
        return NetworkError(message)

    # HTTP status code based classification
    if status_code:
        if status_code == 401 or status_code == 403:
            return AuthenticationError(message, status_code)
        if status_code == 404:
            return NotFoundError(message)
        if status_code == 429:
            return RateLimitError(message)
        if status_code == 400:
            return ValidationError(message)
        if 500 <= status_code < 600:
            return InternalError(message, status_code)

    return RollgateError(message)
