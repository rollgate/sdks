"""
Evaluation reasons for Rollgate SDK.

Provides detailed information about why a flag evaluated to a particular value.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, TypeVar, Generic

T = TypeVar("T")


class EvaluationReasonKind(str, Enum):
    """The category of reason for a flag evaluation."""

    OFF = "OFF"  # Flag is disabled
    TARGET_MATCH = "TARGET_MATCH"  # User is in the target users list
    RULE_MATCH = "RULE_MATCH"  # User matched a targeting rule
    FALLTHROUGH = "FALLTHROUGH"  # No rules matched, using default rollout
    ERROR = "ERROR"  # An error occurred during evaluation
    UNKNOWN = "UNKNOWN"  # Flag not found or unknown reason


class EvaluationErrorKind(str, Enum):
    """Types of errors that can occur during evaluation."""

    FLAG_NOT_FOUND = "FLAG_NOT_FOUND"  # The flag key does not exist
    MALFORMED_FLAG = "MALFORMED_FLAG"  # The flag configuration is invalid
    USER_NOT_SPECIFIED = "USER_NOT_SPECIFIED"  # No user context was provided
    CLIENT_NOT_READY = "CLIENT_NOT_READY"  # The SDK client is not initialized
    EXCEPTION = "EXCEPTION"  # An unexpected error occurred


@dataclass
class EvaluationReason:
    """Explains why a flag evaluated to a particular value."""

    kind: EvaluationReasonKind
    rule_id: Optional[str] = None
    rule_index: Optional[int] = None
    in_rollout: Optional[bool] = None
    error_kind: Optional[EvaluationErrorKind] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        result = {"kind": self.kind.value}
        if self.rule_id is not None:
            result["ruleId"] = self.rule_id
        if self.rule_index is not None:
            result["ruleIndex"] = self.rule_index
        if self.in_rollout is not None:
            result["inRollout"] = self.in_rollout
        if self.error_kind is not None:
            result["errorKind"] = self.error_kind.value
        return result


@dataclass
class EvaluationDetail(Generic[T]):
    """Contains the full result of a flag evaluation."""

    value: T
    reason: EvaluationReason
    variation_index: Optional[int] = None
    variation_id: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        result = {"value": self.value, "reason": self.reason.to_dict()}
        if self.variation_index is not None:
            result["variationIndex"] = self.variation_index
        if self.variation_id is not None:
            result["variationId"] = self.variation_id
        return result


# Helper functions to create common reasons


def off_reason() -> EvaluationReason:
    """Create a reason for a disabled flag."""
    return EvaluationReason(kind=EvaluationReasonKind.OFF)


def target_match_reason() -> EvaluationReason:
    """Create a reason for a target user match."""
    return EvaluationReason(kind=EvaluationReasonKind.TARGET_MATCH)


def rule_match_reason(
    rule_id: str, rule_index: int, in_rollout: bool = True
) -> EvaluationReason:
    """Create a reason for a rule match."""
    return EvaluationReason(
        kind=EvaluationReasonKind.RULE_MATCH,
        rule_id=rule_id,
        rule_index=rule_index,
        in_rollout=in_rollout,
    )


def fallthrough_reason(in_rollout: bool = True) -> EvaluationReason:
    """Create a reason for fallthrough to default rollout."""
    return EvaluationReason(kind=EvaluationReasonKind.FALLTHROUGH, in_rollout=in_rollout)


def error_reason(error_kind: EvaluationErrorKind) -> EvaluationReason:
    """Create a reason for an error."""
    return EvaluationReason(kind=EvaluationReasonKind.ERROR, error_kind=error_kind)


def unknown_reason() -> EvaluationReason:
    """Create a reason for an unknown flag."""
    return EvaluationReason(kind=EvaluationReasonKind.UNKNOWN)
