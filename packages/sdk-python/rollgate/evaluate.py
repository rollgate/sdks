"""
Client-side flag evaluation logic.
Mirrors the server-side evaluation for consistency.
"""

import hashlib
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Union


@dataclass
class Condition:
    """Represents a targeting condition."""
    attribute: str
    operator: str
    value: str


@dataclass
class TargetingRule:
    """Represents a targeting rule with conditions."""
    id: str
    enabled: bool
    rollout: int
    conditions: List[Condition] = field(default_factory=list)
    name: Optional[str] = None


@dataclass
class FlagRule:
    """Represents a feature flag with targeting rules."""
    key: str
    enabled: bool
    rollout: int
    target_users: List[str] = field(default_factory=list)
    rules: List[TargetingRule] = field(default_factory=list)


@dataclass
class RulesPayload:
    """Represents the rules response from the API."""
    version: str
    flags: Dict[str, FlagRule] = field(default_factory=dict)


@dataclass
class EvaluationResult:
    """Represents the result of a flag evaluation."""
    enabled: bool
    value: Any
    variation_id: Optional[str] = None


@dataclass
class UserContext:
    """User context for targeting."""
    id: str
    email: Optional[str] = None
    attributes: Optional[Dict[str, Any]] = None


def evaluate_flag(rule: FlagRule, user: Optional[UserContext]) -> bool:
    """
    Evaluate a flag for a given user context using client-side rules.

    Evaluation priority:
    1. If flag is disabled, return false
    2. If user is in targetUsers list, return true
    3. If user matches any enabled targeting rule, use rule's rollout
    4. Otherwise, use flag's default rollout percentage
    """
    # 1. If flag is disabled, always return false
    if not rule.enabled:
        return False

    # 2. Check if user is in target list
    if user and user.id and rule.target_users:
        if user.id in rule.target_users:
            return True

    # 3. Check targeting rules
    if user and rule.rules:
        for targeting_rule in rule.rules:
            if targeting_rule.enabled and _matches_rule(targeting_rule, user):
                if targeting_rule.rollout >= 100:
                    return True
                if targeting_rule.rollout <= 0:
                    return False
                return _is_in_rollout(rule.key, user.id, targeting_rule.rollout)

    # 4. Default rollout percentage
    if rule.rollout >= 100:
        return True
    if rule.rollout <= 0:
        return False

    # Use consistent hashing for rollout (requires user ID)
    if not user or not user.id:
        return False
    return _is_in_rollout(rule.key, user.id, rule.rollout)


def _matches_rule(rule: TargetingRule, user: UserContext) -> bool:
    """
    Check if a user matches a targeting rule.
    All conditions within a rule must match (AND logic).
    """
    if not rule.conditions:
        return False

    for condition in rule.conditions:
        if not _matches_condition(condition, user):
            return False
    return True


def _matches_condition(condition: Condition, user: UserContext) -> bool:
    """Check if a user matches a single condition."""
    attr_value = _get_attribute_value(condition.attribute, user)
    exists = attr_value is not None and str(attr_value) != ""

    # Handle is_set / is_not_set operators first
    if condition.operator == "is_set":
        return exists
    if condition.operator == "is_not_set":
        return not exists

    # For other operators, if attribute doesn't exist, condition fails
    if not exists:
        return False

    value = str(attr_value).lower()
    cond_value = condition.value.lower()

    if condition.operator == "equals":
        return value == cond_value
    elif condition.operator == "not_equals":
        return value != cond_value
    elif condition.operator == "contains":
        return cond_value in value
    elif condition.operator == "not_contains":
        return cond_value not in value
    elif condition.operator == "starts_with":
        return value.startswith(cond_value)
    elif condition.operator == "ends_with":
        return value.endswith(cond_value)
    elif condition.operator == "in":
        values = [v.strip().lower() for v in condition.value.split(",")]
        return value in values
    elif condition.operator == "not_in":
        values = [v.strip().lower() for v in condition.value.split(",")]
        return value not in values
    elif condition.operator == "greater_than":
        return _compare_numeric(attr_value, condition.value, ">")
    elif condition.operator == "greater_equal":
        return _compare_numeric(attr_value, condition.value, ">=")
    elif condition.operator == "less_than":
        return _compare_numeric(attr_value, condition.value, "<")
    elif condition.operator == "less_equal":
        return _compare_numeric(attr_value, condition.value, "<=")
    elif condition.operator == "regex":
        try:
            return bool(re.match(condition.value, str(attr_value)))
        except re.error:
            return False
    elif condition.operator == "semver_gt":
        return _compare_semver(str(attr_value), condition.value, ">")
    elif condition.operator == "semver_lt":
        return _compare_semver(str(attr_value), condition.value, "<")
    elif condition.operator == "semver_eq":
        return _compare_semver(str(attr_value), condition.value, "=")
    else:
        return False


def _get_attribute_value(attribute: str, user: UserContext) -> Any:
    """Get an attribute value from user context."""
    if user is None:
        return None
    if attribute == "id":
        return user.id
    elif attribute == "email":
        return user.email
    elif user.attributes:
        return user.attributes.get(attribute)
    return None


def _compare_numeric(attr_val: Any, cond_val: str, op: str) -> bool:
    """Compare two numeric values."""
    try:
        a = float(str(attr_val))
        b = float(cond_val)

        if op == ">":
            return a > b
        elif op == ">=":
            return a >= b
        elif op == "<":
            return a < b
        elif op == "<=":
            return a <= b
        else:
            return False
    except (ValueError, TypeError):
        return False


def _compare_semver(attr_val: str, cond_val: str, op: str) -> bool:
    """Compare two semantic versions."""
    a = _parse_version(attr_val)
    b = _parse_version(cond_val)
    if a is None or b is None:
        return False

    # Pad lists to same length
    while len(a) < len(b):
        a.append(0)
    while len(b) < len(a):
        b.append(0)

    # Compare each part
    for i in range(len(a)):
        if a[i] > b[i]:
            return op in (">", ">=")
        if a[i] < b[i]:
            return op in ("<", "<=")

    # Equal
    return op in ("=", ">=", "<=")


def _parse_version(v: str) -> Optional[List[int]]:
    """Parse a semantic version string."""
    clean = v.lstrip("v")
    parts = clean.split(".")
    try:
        return [int(p) for p in parts]
    except ValueError:
        return None


def _is_in_rollout(flag_key: str, user_id: str, percentage: int) -> bool:
    """
    Consistent hashing for rollout percentage.
    Uses SHA-256 hash of flagKey:userId to ensure:
    - Same user always gets same result for a given flag
    - Distribution is statistically uniform
    """
    hash_input = f"{flag_key}:{user_id}".encode("utf-8")
    hash_bytes = hashlib.sha256(hash_input).digest()
    # Use first 4 bytes as uint32 and mod 100 to get a value 0-99
    value = int.from_bytes(hash_bytes[:4], byteorder="big") % 100
    return value < percentage


def evaluate_all_flags(
    rules: Dict[str, FlagRule],
    user: Optional[UserContext]
) -> Dict[str, bool]:
    """Evaluate all flags for a user context."""
    return {key: evaluate_flag(rule, user) for key, rule in rules.items()}


class LocalEvaluator:
    """
    Local evaluator for client-side flag evaluation.

    Example:
        ```python
        evaluator = LocalEvaluator()
        evaluator.set_rules(rules_payload)

        user = UserContext(id="user-123", email="user@example.com")
        enabled = evaluator.evaluate("my-feature", user, default_value=False)
        ```
    """

    def __init__(self):
        """Initialize the local evaluator."""
        self._rules: Dict[str, FlagRule] = {}
        self._version: str = ""

    def set_rules(self, payload: RulesPayload) -> None:
        """Set the rules for local evaluation."""
        self._rules = payload.flags
        self._version = payload.version

    def set_rules_from_dict(self, data: Dict[str, Any]) -> None:
        """Set rules from a dictionary (e.g., from JSON)."""
        self._version = data.get("version", "")
        self._rules = {}

        for key, flag_data in data.get("flags", {}).items():
            rules = []
            for rule_data in flag_data.get("rules", []):
                conditions = [
                    Condition(
                        attribute=c.get("attribute", ""),
                        operator=c.get("operator", ""),
                        value=c.get("value", ""),
                    )
                    for c in rule_data.get("conditions", [])
                ]
                rules.append(TargetingRule(
                    id=rule_data.get("id", ""),
                    name=rule_data.get("name"),
                    enabled=rule_data.get("enabled", False),
                    rollout=rule_data.get("rollout", 0),
                    conditions=conditions,
                ))

            self._rules[key] = FlagRule(
                key=key,
                enabled=flag_data.get("enabled", False),
                rollout=flag_data.get("rollout", 0),
                target_users=flag_data.get("targetUsers", []),
                rules=rules,
            )

    @property
    def version(self) -> str:
        """Get the current rules version."""
        return self._version

    def evaluate(
        self,
        flag_key: str,
        user: Optional[UserContext],
        default_value: bool = False
    ) -> bool:
        """Evaluate a single flag."""
        rule = self._rules.get(flag_key)
        if rule is None:
            return default_value
        return evaluate_flag(rule, user)

    def evaluate_all(self, user: Optional[UserContext]) -> Dict[str, bool]:
        """Evaluate all flags."""
        return evaluate_all_flags(self._rules, user)

    def has_flag(self, flag_key: str) -> bool:
        """Check if a flag exists."""
        return flag_key in self._rules
