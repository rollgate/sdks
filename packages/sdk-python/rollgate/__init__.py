"""
Rollgate Python SDK - Feature flags made simple.

Usage:
    from rollgate import RollgateClient

    client = RollgateClient(api_key="your-api-key")
    await client.init()

    if client.is_enabled("my-feature"):
        # Feature is enabled
        pass
"""

from rollgate.client import RollgateClient, RollgateConfig, UserContext
from rollgate.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerConfig,
    CircuitOpenError,
    CircuitState,
)
from rollgate.retry import RetryConfig, calculate_backoff, is_retryable_error
from rollgate.cache import CacheConfig, CacheStats, FlagCache
from rollgate.errors import (
    RollgateError,
    AuthenticationError,
    NetworkError,
    RateLimitError,
    ValidationError,
    InternalError,
    ErrorCategory,
)
from rollgate.dedup import RequestDeduplicator, DedupConfig
from rollgate.metrics import (
    SDKMetrics,
    MetricsSnapshot,
    RequestMetrics,
    FlagStats,
    get_metrics,
    create_metrics,
)
from rollgate.tracing import (
    TraceContext,
    RequestTrace,
    TracingManager,
    get_tracer,
    create_tracer,
)
from rollgate.evaluate import (
    Condition,
    TargetingRule,
    FlagRule,
    RulesPayload,
    EvaluationResult,
    LocalEvaluator,
    evaluate_flag,
    evaluate_all_flags,
)
from rollgate.reasons import (
    EvaluationReason,
    EvaluationDetail,
    EvaluationReasonKind,
    EvaluationErrorKind,
    off_reason,
    target_match_reason,
    rule_match_reason,
    fallthrough_reason,
    error_reason,
    unknown_reason,
)

__version__ = "1.1.0"
__all__ = [
    # Client
    "RollgateClient",
    "RollgateConfig",
    "UserContext",
    # Circuit Breaker
    "CircuitBreaker",
    "CircuitBreakerConfig",
    "CircuitOpenError",
    "CircuitState",
    # Retry
    "RetryConfig",
    "calculate_backoff",
    "is_retryable_error",
    # Cache
    "CacheConfig",
    "CacheStats",
    "FlagCache",
    # Errors
    "RollgateError",
    "AuthenticationError",
    "NetworkError",
    "RateLimitError",
    "ValidationError",
    "InternalError",
    "ErrorCategory",
    # Dedup
    "RequestDeduplicator",
    "DedupConfig",
    # Metrics
    "SDKMetrics",
    "MetricsSnapshot",
    "RequestMetrics",
    "FlagStats",
    "get_metrics",
    "create_metrics",
    # Tracing
    "TraceContext",
    "RequestTrace",
    "TracingManager",
    "get_tracer",
    "create_tracer",
    # Evaluation
    "Condition",
    "TargetingRule",
    "FlagRule",
    "RulesPayload",
    "EvaluationResult",
    "LocalEvaluator",
    "evaluate_flag",
    "evaluate_all_flags",
    # Reasons
    "EvaluationReason",
    "EvaluationDetail",
    "EvaluationReasonKind",
    "EvaluationErrorKind",
    "off_reason",
    "target_match_reason",
    "rule_match_reason",
    "fallthrough_reason",
    "error_reason",
    "unknown_reason",
]
