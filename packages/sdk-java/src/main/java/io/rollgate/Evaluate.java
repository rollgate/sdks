package io.rollgate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Client-side flag evaluation logic.
 * Mirrors the server-side evaluation for consistency.
 */
public class Evaluate {

    /**
     * Represents a targeting condition.
     */
    public static class Condition {
        public String attribute;
        public String operator;
        public String value;

        public Condition() {}

        public Condition(String attribute, String operator, String value) {
            this.attribute = attribute;
            this.operator = operator;
            this.value = value;
        }
    }

    /**
     * Represents a targeting rule with conditions.
     */
    public static class TargetingRule {
        public String id;
        public String name;
        public boolean enabled;
        public int rollout;
        public List<Condition> conditions;

        public TargetingRule() {
            this.conditions = new ArrayList<>();
        }
    }

    /**
     * Represents a feature flag with targeting rules.
     */
    public static class FlagRule {
        public String key;
        public boolean enabled;
        public int rollout;
        public List<String> targetUsers;
        public List<TargetingRule> rules;

        public FlagRule() {
            this.targetUsers = new ArrayList<>();
            this.rules = new ArrayList<>();
        }
    }

    /**
     * Represents the rules response from the API.
     */
    public static class RulesPayload {
        public String version;
        public Map<String, FlagRule> flags;

        public RulesPayload() {
            this.flags = new HashMap<>();
        }
    }

    /**
     * Represents the result of a flag evaluation.
     */
    public static class EvaluationResult {
        public boolean enabled;
        public Object value;
        public String variationId;

        public EvaluationResult(boolean enabled, Object value) {
            this.enabled = enabled;
            this.value = value;
        }

        public EvaluationResult(boolean enabled, Object value, String variationId) {
            this.enabled = enabled;
            this.value = value;
            this.variationId = variationId;
        }
    }

    /**
     * Evaluate a flag for a given user context using client-side rules.
     *
     * Evaluation priority:
     * 1. If flag is disabled, return false
     * 2. If user is in targetUsers list, return true
     * 3. If user matches any enabled targeting rule, use rule's rollout
     * 4. Otherwise, use flag's default rollout percentage
     */
    public static boolean evaluateFlag(FlagRule rule, UserContext user) {
        // 1. If flag is disabled, always return false
        if (!rule.enabled) {
            return false;
        }

        // 2. Check if user is in target list
        if (user != null && user.getId() != null && rule.targetUsers != null) {
            if (rule.targetUsers.contains(user.getId())) {
                return true;
            }
        }

        // 3. Check targeting rules
        if (user != null && rule.rules != null && !rule.rules.isEmpty()) {
            for (TargetingRule targetingRule : rule.rules) {
                if (targetingRule.enabled && matchesRule(targetingRule, user)) {
                    if (targetingRule.rollout >= 100) {
                        return true;
                    }
                    if (targetingRule.rollout <= 0) {
                        return false;
                    }
                    return isInRollout(rule.key, user.getId(), targetingRule.rollout);
                }
            }
        }

        // 4. Default rollout percentage
        if (rule.rollout >= 100) {
            return true;
        }
        if (rule.rollout <= 0) {
            return false;
        }

        // Use consistent hashing for rollout (requires user ID)
        if (user == null || user.getId() == null) {
            return false;
        }
        return isInRollout(rule.key, user.getId(), rule.rollout);
    }

    /**
     * Check if a user matches a targeting rule.
     * All conditions within a rule must match (AND logic).
     */
    private static boolean matchesRule(TargetingRule rule, UserContext user) {
        if (rule.conditions == null || rule.conditions.isEmpty()) {
            return false;
        }

        for (Condition condition : rule.conditions) {
            if (!matchesCondition(condition, user)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Check if a user matches a single condition.
     */
    private static boolean matchesCondition(Condition condition, UserContext user) {
        Object attrValue = getAttributeValue(condition.attribute, user);
        boolean exists = attrValue != null && !attrValue.toString().isEmpty();

        // Handle is_set / is_not_set operators first
        switch (condition.operator) {
            case "is_set":
                return exists;
            case "is_not_set":
                return !exists;
        }

        // For other operators, if attribute doesn't exist, condition fails
        if (!exists) {
            return false;
        }

        String value = attrValue.toString().toLowerCase();
        String condValue = condition.value.toLowerCase();

        switch (condition.operator) {
            case "equals":
                return value.equals(condValue);
            case "not_equals":
                return !value.equals(condValue);
            case "contains":
                return value.contains(condValue);
            case "not_contains":
                return !value.contains(condValue);
            case "starts_with":
                return value.startsWith(condValue);
            case "ends_with":
                return value.endsWith(condValue);
            case "in": {
                String[] values = condition.value.split(",");
                for (String v : values) {
                    if (v.trim().toLowerCase().equals(value)) {
                        return true;
                    }
                }
                return false;
            }
            case "not_in": {
                String[] values = condition.value.split(",");
                for (String v : values) {
                    if (v.trim().toLowerCase().equals(value)) {
                        return false;
                    }
                }
                return true;
            }
            case "greater_than":
                return compareNumeric(attrValue, condition.value, ">");
            case "greater_equal":
                return compareNumeric(attrValue, condition.value, ">=");
            case "less_than":
                return compareNumeric(attrValue, condition.value, "<");
            case "less_equal":
                return compareNumeric(attrValue, condition.value, "<=");
            case "regex":
                try {
                    return Pattern.matches(condition.value, attrValue.toString());
                } catch (PatternSyntaxException e) {
                    return false;
                }
            case "semver_gt":
                return compareSemver(attrValue.toString(), condition.value, ">");
            case "semver_lt":
                return compareSemver(attrValue.toString(), condition.value, "<");
            case "semver_eq":
                return compareSemver(attrValue.toString(), condition.value, "=");
            default:
                return false;
        }
    }

    /**
     * Get an attribute value from user context.
     */
    private static Object getAttributeValue(String attribute, UserContext user) {
        if (user == null) {
            return null;
        }
        switch (attribute) {
            case "id":
                return user.getId();
            case "email":
                return user.getEmail();
            default:
                Map<String, Object> attrs = user.getAttributes();
                return attrs != null ? attrs.get(attribute) : null;
        }
    }

    /**
     * Compare two numeric values.
     */
    private static boolean compareNumeric(Object attrVal, String condVal, String op) {
        try {
            double a = Double.parseDouble(attrVal.toString());
            double b = Double.parseDouble(condVal);

            switch (op) {
                case ">": return a > b;
                case ">=": return a >= b;
                case "<": return a < b;
                case "<=": return a <= b;
                default: return false;
            }
        } catch (NumberFormatException e) {
            return false;
        }
    }

    /**
     * Compare two semantic versions.
     */
    private static boolean compareSemver(String attrVal, String condVal, String op) {
        int[] a = parseVersion(attrVal);
        int[] b = parseVersion(condVal);
        if (a == null || b == null) {
            return false;
        }

        // Pad arrays to same length
        int maxLen = Math.max(a.length, b.length);
        a = padArray(a, maxLen);
        b = padArray(b, maxLen);

        // Compare each part
        for (int i = 0; i < a.length; i++) {
            if (a[i] > b[i]) {
                return op.equals(">") || op.equals(">=");
            }
            if (a[i] < b[i]) {
                return op.equals("<") || op.equals("<=");
            }
        }
        // Equal
        return op.equals("=") || op.equals(">=") || op.equals("<=");
    }

    /**
     * Parse a semantic version string.
     */
    private static int[] parseVersion(String v) {
        String clean = v.startsWith("v") ? v.substring(1) : v;
        String[] parts = clean.split("\\.");
        int[] result = new int[parts.length];
        try {
            for (int i = 0; i < parts.length; i++) {
                result[i] = Integer.parseInt(parts[i]);
            }
            return result;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * Pad an int array to a specific length with zeros.
     */
    private static int[] padArray(int[] arr, int length) {
        if (arr.length >= length) {
            return arr;
        }
        int[] result = new int[length];
        System.arraycopy(arr, 0, result, 0, arr.length);
        return result;
    }

    /**
     * Consistent hashing for rollout percentage.
     * Uses SHA-256 hash of flagKey:userId to ensure:
     * - Same user always gets same result for a given flag
     * - Distribution is statistically uniform
     */
    private static boolean isInRollout(String flagKey, String userId, int percentage) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest((flagKey + ":" + userId).getBytes(StandardCharsets.UTF_8));
            // Use first 4 bytes as uint32 and mod 100 to get a value 0-99
            int value = ((hash[0] & 0xFF) << 24 | (hash[1] & 0xFF) << 16 |
                        (hash[2] & 0xFF) << 8 | (hash[3] & 0xFF)) & 0x7FFFFFFF;
            return (value % 100) < percentage;
        } catch (NoSuchAlgorithmException e) {
            return false;
        }
    }

    /**
     * Evaluate all flags for a user context.
     */
    public static Map<String, Boolean> evaluateAllFlags(Map<String, FlagRule> rules, UserContext user) {
        Map<String, Boolean> result = new HashMap<>();
        for (Map.Entry<String, FlagRule> entry : rules.entrySet()) {
            result.put(entry.getKey(), evaluateFlag(entry.getValue(), user));
        }
        return result;
    }

    /**
     * Local evaluator for client-side flag evaluation.
     */
    public static class LocalEvaluator {
        private Map<String, FlagRule> rules = new HashMap<>();
        private String version;

        /**
         * Set the rules for local evaluation.
         */
        public void setRules(RulesPayload payload) {
            this.rules = payload.flags;
            this.version = payload.version;
        }

        /**
         * Get the current rules version.
         */
        public String getVersion() {
            return version;
        }

        /**
         * Evaluate a single flag.
         */
        public boolean evaluate(String flagKey, UserContext user, boolean defaultValue) {
            FlagRule rule = rules.get(flagKey);
            if (rule == null) {
                return defaultValue;
            }
            return evaluateFlag(rule, user);
        }

        /**
         * Evaluate all flags.
         */
        public Map<String, Boolean> evaluateAll(UserContext user) {
            return evaluateAllFlags(rules, user);
        }

        /**
         * Check if a flag exists.
         */
        public boolean hasFlag(String flagKey) {
            return rules.containsKey(flagKey);
        }
    }
}
