package io.rollgate;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import static org.junit.jupiter.api.Assertions.*;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

class EvaluateTest {

    private UserContext user;

    @BeforeEach
    void setUp() {
        Map<String, Object> attrs = new HashMap<>();
        attrs.put("plan", "pro");
        attrs.put("age", 25);
        attrs.put("version", "1.2.3");
        user = UserContext.builder("user-123")
            .email("test@example.com")
            .attributes(attrs)
            .build();
    }

    @Test
    void testDisabledFlag() {
        Evaluate.FlagRule rule = new Evaluate.FlagRule();
        rule.key = "test";
        rule.enabled = false;
        rule.rollout = 100;

        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testEnabledFlag100Rollout() {
        Evaluate.FlagRule rule = new Evaluate.FlagRule();
        rule.key = "test";
        rule.enabled = true;
        rule.rollout = 100;

        assertTrue(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testEnabledFlag0Rollout() {
        Evaluate.FlagRule rule = new Evaluate.FlagRule();
        rule.key = "test";
        rule.enabled = true;
        rule.rollout = 0;

        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testTargetUser() {
        Evaluate.FlagRule rule = new Evaluate.FlagRule();
        rule.key = "test";
        rule.enabled = true;
        rule.rollout = 0;
        rule.targetUsers = Arrays.asList("user-123", "user-456");

        assertTrue(Evaluate.evaluateFlag(rule, user));

        UserContext otherUser = UserContext.builder("user-999").build();
        assertFalse(Evaluate.evaluateFlag(rule, otherUser));
    }

    @Test
    void testEqualsCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("plan", "equals", "pro");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("plan", "equals", "free");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testNotEqualsCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("plan", "not_equals", "free");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("plan", "not_equals", "pro");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testContainsCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("email", "contains", "example");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("email", "contains", "gmail");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testStartsWithCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("email", "starts_with", "test");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("email", "starts_with", "admin");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testEndsWithCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("email", "ends_with", ".com");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("email", "ends_with", ".org");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testInCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("plan", "in", "free,pro,enterprise");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("plan", "in", "free,basic");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testNotInCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("plan", "not_in", "free,basic");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("plan", "not_in", "free,pro");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testGreaterThanCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("age", "greater_than", "20");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("age", "greater_than", "30");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testLessThanCondition() {
        Evaluate.FlagRule rule = createRuleWithCondition("age", "less_than", "30");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("age", "less_than", "20");
        assertFalse(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testSemverComparison() {
        Evaluate.FlagRule rule = createRuleWithCondition("version", "semver_gt", "1.0.0");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("version", "semver_lt", "2.0.0");
        assertTrue(Evaluate.evaluateFlag(rule, user));

        rule = createRuleWithCondition("version", "semver_eq", "1.2.3");
        assertTrue(Evaluate.evaluateFlag(rule, user));
    }

    @Test
    void testConsistentHashing() {
        Evaluate.FlagRule rule = new Evaluate.FlagRule();
        rule.key = "test-flag";
        rule.enabled = true;
        rule.rollout = 50;

        UserContext consistentUser = UserContext.builder("consistent-user").build();
        boolean firstResult = Evaluate.evaluateFlag(rule, consistentUser);

        for (int i = 0; i < 100; i++) {
            assertEquals(firstResult, Evaluate.evaluateFlag(rule, consistentUser),
                "Consistent hashing should produce same result");
        }
    }

    @Test
    void testEvaluateAllFlags() {
        Map<String, Evaluate.FlagRule> rules = new HashMap<>();

        Evaluate.FlagRule flag1 = new Evaluate.FlagRule();
        flag1.key = "flag-1";
        flag1.enabled = true;
        flag1.rollout = 100;
        rules.put("flag-1", flag1);

        Evaluate.FlagRule flag2 = new Evaluate.FlagRule();
        flag2.key = "flag-2";
        flag2.enabled = false;
        flag2.rollout = 100;
        rules.put("flag-2", flag2);

        Map<String, Boolean> result = Evaluate.evaluateAllFlags(rules, user);

        assertTrue(result.get("flag-1"));
        assertFalse(result.get("flag-2"));
    }

    @Test
    void testLocalEvaluator() {
        Evaluate.LocalEvaluator evaluator = new Evaluate.LocalEvaluator();

        Evaluate.RulesPayload payload = new Evaluate.RulesPayload();
        payload.version = "v1";

        Evaluate.FlagRule featureA = new Evaluate.FlagRule();
        featureA.key = "feature-a";
        featureA.enabled = true;
        featureA.rollout = 100;
        payload.flags.put("feature-a", featureA);

        Evaluate.FlagRule featureB = new Evaluate.FlagRule();
        featureB.key = "feature-b";
        featureB.enabled = false;
        featureB.rollout = 100;
        payload.flags.put("feature-b", featureB);

        evaluator.setRules(payload);

        assertEquals("v1", evaluator.getVersion());
        assertTrue(evaluator.hasFlag("feature-a"));
        assertFalse(evaluator.hasFlag("feature-c"));

        assertTrue(evaluator.evaluate("feature-a", user, false));
        assertFalse(evaluator.evaluate("feature-b", user, true));
        assertTrue(evaluator.evaluate("feature-c", user, true)); // default value
    }

    private Evaluate.FlagRule createRuleWithCondition(String attribute, String operator, String value) {
        Evaluate.FlagRule rule = new Evaluate.FlagRule();
        rule.key = "test";
        rule.enabled = true;
        rule.rollout = 0;

        Evaluate.TargetingRule targetingRule = new Evaluate.TargetingRule();
        targetingRule.id = "rule-1";
        targetingRule.enabled = true;
        targetingRule.rollout = 100;

        Evaluate.Condition condition = new Evaluate.Condition(attribute, operator, value);
        targetingRule.conditions.add(condition);

        rule.rules.add(targetingRule);
        return rule;
    }
}
