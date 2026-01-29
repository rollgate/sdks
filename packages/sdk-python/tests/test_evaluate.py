"""Tests for local flag evaluation."""

import pytest
from rollgate.evaluate import (
    Condition,
    TargetingRule,
    FlagRule,
    RulesPayload,
    LocalEvaluator,
    UserContext,
    evaluate_flag,
    evaluate_all_flags,
)


@pytest.fixture
def user():
    """Create a test user context."""
    return UserContext(
        id="user-123",
        email="test@example.com",
        attributes={"plan": "pro", "age": 25, "version": "1.2.3"},
    )


class TestEvaluateFlag:
    """Tests for evaluate_flag function."""

    def test_disabled_flag(self, user):
        """Test that disabled flags return false."""
        rule = FlagRule(key="test", enabled=False, rollout=100)
        assert evaluate_flag(rule, user) is False

    def test_enabled_flag_100_rollout(self, user):
        """Test 100% rollout returns true."""
        rule = FlagRule(key="test", enabled=True, rollout=100)
        assert evaluate_flag(rule, user) is True

    def test_enabled_flag_0_rollout(self, user):
        """Test 0% rollout returns false."""
        rule = FlagRule(key="test", enabled=True, rollout=0)
        assert evaluate_flag(rule, user) is False

    def test_target_user(self, user):
        """Test targeted user gets true even with 0% rollout."""
        rule = FlagRule(
            key="test",
            enabled=True,
            rollout=0,
            target_users=["user-123", "user-456"],
        )
        assert evaluate_flag(rule, user) is True

        # Non-targeted user
        other_user = UserContext(id="user-999")
        assert evaluate_flag(rule, other_user) is False

    def test_no_user_context(self):
        """Test evaluation without user context."""
        rule = FlagRule(key="test", enabled=True, rollout=50)
        assert evaluate_flag(rule, None) is False

        rule100 = FlagRule(key="test", enabled=True, rollout=100)
        assert evaluate_flag(rule100, None) is True


class TestConditionOperators:
    """Tests for condition operators."""

    @pytest.fixture
    def make_rule(self):
        """Helper to create rule with single condition."""
        def _make(operator, cond_value, attr_name="plan"):
            return FlagRule(
                key="test",
                enabled=True,
                rollout=0,
                rules=[
                    TargetingRule(
                        id="rule-1",
                        enabled=True,
                        rollout=100,
                        conditions=[
                            Condition(attribute=attr_name, operator=operator, value=cond_value)
                        ],
                    )
                ],
            )
        return _make

    def test_equals(self, user, make_rule):
        """Test equals operator."""
        assert evaluate_flag(make_rule("equals", "pro"), user) is True
        assert evaluate_flag(make_rule("equals", "free"), user) is False

    def test_not_equals(self, user, make_rule):
        """Test not_equals operator."""
        assert evaluate_flag(make_rule("not_equals", "free"), user) is True
        assert evaluate_flag(make_rule("not_equals", "pro"), user) is False

    def test_contains(self, user, make_rule):
        """Test contains operator."""
        assert evaluate_flag(make_rule("contains", "example", "email"), user) is True
        assert evaluate_flag(make_rule("contains", "gmail", "email"), user) is False

    def test_not_contains(self, user, make_rule):
        """Test not_contains operator."""
        assert evaluate_flag(make_rule("not_contains", "gmail", "email"), user) is True
        assert evaluate_flag(make_rule("not_contains", "example", "email"), user) is False

    def test_starts_with(self, user, make_rule):
        """Test starts_with operator."""
        assert evaluate_flag(make_rule("starts_with", "test", "email"), user) is True
        assert evaluate_flag(make_rule("starts_with", "admin", "email"), user) is False

    def test_ends_with(self, user, make_rule):
        """Test ends_with operator."""
        assert evaluate_flag(make_rule("ends_with", ".com", "email"), user) is True
        assert evaluate_flag(make_rule("ends_with", ".org", "email"), user) is False

    def test_in(self, user, make_rule):
        """Test in operator."""
        assert evaluate_flag(make_rule("in", "free,pro,enterprise"), user) is True
        assert evaluate_flag(make_rule("in", "free,basic"), user) is False

    def test_not_in(self, user, make_rule):
        """Test not_in operator."""
        assert evaluate_flag(make_rule("not_in", "free,basic"), user) is True
        assert evaluate_flag(make_rule("not_in", "free,pro"), user) is False

    def test_is_set(self, user, make_rule):
        """Test is_set operator."""
        assert evaluate_flag(make_rule("is_set", ""), user) is True
        assert evaluate_flag(make_rule("is_set", "", "nonexistent"), user) is False

    def test_is_not_set(self, user, make_rule):
        """Test is_not_set operator."""
        assert evaluate_flag(make_rule("is_not_set", "", "nonexistent"), user) is True
        assert evaluate_flag(make_rule("is_not_set", ""), user) is False

    def test_greater_than(self, user, make_rule):
        """Test greater_than operator."""
        assert evaluate_flag(make_rule("greater_than", "20", "age"), user) is True
        assert evaluate_flag(make_rule("greater_than", "30", "age"), user) is False

    def test_less_than(self, user, make_rule):
        """Test less_than operator."""
        assert evaluate_flag(make_rule("less_than", "30", "age"), user) is True
        assert evaluate_flag(make_rule("less_than", "20", "age"), user) is False

    def test_greater_equal(self, user, make_rule):
        """Test greater_equal operator."""
        assert evaluate_flag(make_rule("greater_equal", "25", "age"), user) is True
        assert evaluate_flag(make_rule("greater_equal", "26", "age"), user) is False

    def test_less_equal(self, user, make_rule):
        """Test less_equal operator."""
        assert evaluate_flag(make_rule("less_equal", "25", "age"), user) is True
        assert evaluate_flag(make_rule("less_equal", "24", "age"), user) is False

    def test_regex(self, user, make_rule):
        """Test regex operator."""
        assert evaluate_flag(make_rule("regex", r".*@example\.com", "email"), user) is True
        assert evaluate_flag(make_rule("regex", r".*@gmail\.com", "email"), user) is False

    def test_semver_gt(self, user, make_rule):
        """Test semver_gt operator."""
        assert evaluate_flag(make_rule("semver_gt", "1.0.0", "version"), user) is True
        assert evaluate_flag(make_rule("semver_gt", "2.0.0", "version"), user) is False

    def test_semver_lt(self, user, make_rule):
        """Test semver_lt operator."""
        assert evaluate_flag(make_rule("semver_lt", "2.0.0", "version"), user) is True
        assert evaluate_flag(make_rule("semver_lt", "1.0.0", "version"), user) is False

    def test_semver_eq(self, user, make_rule):
        """Test semver_eq operator."""
        assert evaluate_flag(make_rule("semver_eq", "1.2.3", "version"), user) is True
        assert evaluate_flag(make_rule("semver_eq", "1.2.4", "version"), user) is False


class TestConsistentHashing:
    """Tests for consistent hashing in rollout."""

    def test_consistent_result(self):
        """Test that same user always gets same result."""
        rule = FlagRule(key="test-flag", enabled=True, rollout=50)
        user = UserContext(id="consistent-user")

        first_result = evaluate_flag(rule, user)
        for _ in range(100):
            assert evaluate_flag(rule, user) == first_result

    def test_distribution(self):
        """Test that rollout distribution is roughly correct."""
        rule = FlagRule(key="distribution-test", enabled=True, rollout=50)

        true_count = 0
        total = 10000

        for i in range(total):
            user = UserContext(id=f"user-{i}")
            if evaluate_flag(rule, user):
                true_count += 1

        percentage = true_count / total * 100
        assert 45 <= percentage <= 55, f"Distribution was {percentage}%"


class TestEvaluateAllFlags:
    """Tests for evaluate_all_flags function."""

    def test_evaluate_all(self, user):
        """Test evaluating all flags."""
        rules = {
            "flag-1": FlagRule(key="flag-1", enabled=True, rollout=100),
            "flag-2": FlagRule(key="flag-2", enabled=False, rollout=100),
            "flag-3": FlagRule(key="flag-3", enabled=True, rollout=0),
        }

        result = evaluate_all_flags(rules, user)

        assert result["flag-1"] is True
        assert result["flag-2"] is False
        assert result["flag-3"] is False


class TestLocalEvaluator:
    """Tests for LocalEvaluator class."""

    def test_set_rules(self, user):
        """Test setting rules."""
        evaluator = LocalEvaluator()
        payload = RulesPayload(
            version="v1",
            flags={
                "feature-a": FlagRule(key="feature-a", enabled=True, rollout=100),
                "feature-b": FlagRule(key="feature-b", enabled=False, rollout=100),
            },
        )

        evaluator.set_rules(payload)

        assert evaluator.version == "v1"
        assert evaluator.has_flag("feature-a")
        assert evaluator.has_flag("feature-b")
        assert not evaluator.has_flag("feature-c")

    def test_evaluate(self, user):
        """Test evaluating flags."""
        evaluator = LocalEvaluator()
        evaluator.set_rules(RulesPayload(
            version="v1",
            flags={
                "feature-a": FlagRule(key="feature-a", enabled=True, rollout=100),
            },
        ))

        assert evaluator.evaluate("feature-a", user) is True
        assert evaluator.evaluate("feature-b", user, default_value=True) is True
        assert evaluator.evaluate("feature-c", user, default_value=False) is False

    def test_evaluate_all(self, user):
        """Test evaluating all flags."""
        evaluator = LocalEvaluator()
        evaluator.set_rules(RulesPayload(
            version="v1",
            flags={
                "feature-a": FlagRule(key="feature-a", enabled=True, rollout=100),
                "feature-b": FlagRule(key="feature-b", enabled=False, rollout=100),
            },
        ))

        result = evaluator.evaluate_all(user)

        assert result["feature-a"] is True
        assert result["feature-b"] is False

    def test_set_rules_from_dict(self, user):
        """Test setting rules from dictionary."""
        evaluator = LocalEvaluator()
        evaluator.set_rules_from_dict({
            "version": "v2",
            "flags": {
                "feature-x": {
                    "enabled": True,
                    "rollout": 100,
                    "targetUsers": ["user-123"],
                    "rules": [
                        {
                            "id": "rule-1",
                            "enabled": True,
                            "rollout": 100,
                            "conditions": [
                                {"attribute": "plan", "operator": "equals", "value": "pro"}
                            ],
                        }
                    ],
                }
            },
        })

        assert evaluator.version == "v2"
        assert evaluator.evaluate("feature-x", user) is True
