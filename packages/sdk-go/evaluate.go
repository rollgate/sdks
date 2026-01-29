package rollgate

import (
	"crypto/sha256"
	"encoding/binary"
	"regexp"
	"strconv"
	"strings"
)

// Condition represents a targeting condition.
type Condition struct {
	Attribute string `json:"attribute"`
	Operator  string `json:"operator"`
	Value     string `json:"value"`
}

// TargetingRule represents a targeting rule with conditions.
type TargetingRule struct {
	ID         string      `json:"id"`
	Name       string      `json:"name,omitempty"`
	Enabled    bool        `json:"enabled"`
	Rollout    int         `json:"rollout"`
	Conditions []Condition `json:"conditions"`
}

// FlagRule represents a feature flag with targeting rules.
type FlagRule struct {
	Key         string          `json:"key"`
	Enabled     bool            `json:"enabled"`
	Rollout     int             `json:"rollout"`
	TargetUsers []string        `json:"targetUsers,omitempty"`
	Rules       []TargetingRule `json:"rules,omitempty"`
}

// RulesPayload represents the rules response from the API.
type RulesPayload struct {
	Version string              `json:"version"`
	Flags   map[string]FlagRule `json:"flags"`
}

// EvaluationResult represents the result of a flag evaluation.
type EvaluationResult struct {
	Enabled     bool        `json:"enabled"`
	Value       interface{} `json:"value"`
	VariationID string      `json:"variationId,omitempty"`
}

// EvaluateFlag evaluates a flag for a given user context using client-side rules.
//
// Evaluation priority:
// 1. If flag is disabled, return false
// 2. If user is in targetUsers list, return true
// 3. If user matches any enabled targeting rule, use rule's rollout
// 4. Otherwise, use flag's default rollout percentage
func EvaluateFlag(rule FlagRule, user *UserContext) bool {
	// 1. If flag is disabled, always return false
	if !rule.Enabled {
		return false
	}

	// 2. Check if user is in target list
	if user != nil && user.ID != "" {
		for _, targetUser := range rule.TargetUsers {
			if targetUser == user.ID {
				return true
			}
		}
	}

	// 3. Check targeting rules
	if user != nil && len(rule.Rules) > 0 {
		for _, targetingRule := range rule.Rules {
			if targetingRule.Enabled && matchesRule(targetingRule, user) {
				if targetingRule.Rollout >= 100 {
					return true
				}
				if targetingRule.Rollout <= 0 {
					return false
				}
				return isInRollout(rule.Key, user.ID, targetingRule.Rollout)
			}
		}
	}

	// 4. Default rollout percentage
	if rule.Rollout >= 100 {
		return true
	}
	if rule.Rollout <= 0 {
		return false
	}

	// Use consistent hashing for rollout (requires user ID)
	if user == nil || user.ID == "" {
		return false
	}
	return isInRollout(rule.Key, user.ID, rule.Rollout)
}

// matchesRule checks if a user matches a targeting rule.
// All conditions within a rule must match (AND logic).
func matchesRule(rule TargetingRule, user *UserContext) bool {
	if len(rule.Conditions) == 0 {
		return false
	}

	for _, condition := range rule.Conditions {
		if !matchesCondition(condition, user) {
			return false
		}
	}
	return true
}

// matchesCondition checks if a user matches a single condition.
func matchesCondition(condition Condition, user *UserContext) bool {
	attrValue := getAttributeValue(condition.Attribute, user)
	exists := attrValue != nil && attrValue != ""

	// Handle is_set / is_not_set operators first
	switch condition.Operator {
	case "is_set":
		return exists
	case "is_not_set":
		return !exists
	}

	// For other operators, if attribute doesn't exist, condition fails
	if !exists {
		return false
	}

	value := strings.ToLower(toString(attrValue))
	condValue := strings.ToLower(condition.Value)

	switch condition.Operator {
	case "equals":
		return value == condValue
	case "not_equals":
		return value != condValue
	case "contains":
		return strings.Contains(value, condValue)
	case "not_contains":
		return !strings.Contains(value, condValue)
	case "starts_with":
		return strings.HasPrefix(value, condValue)
	case "ends_with":
		return strings.HasSuffix(value, condValue)
	case "in":
		values := splitAndTrim(condition.Value)
		for _, v := range values {
			if strings.ToLower(v) == value {
				return true
			}
		}
		return false
	case "not_in":
		values := splitAndTrim(condition.Value)
		for _, v := range values {
			if strings.ToLower(v) == value {
				return false
			}
		}
		return true
	case "greater_than":
		return compareNumeric(attrValue, condition.Value, ">")
	case "greater_equal":
		return compareNumeric(attrValue, condition.Value, ">=")
	case "less_than":
		return compareNumeric(attrValue, condition.Value, "<")
	case "less_equal":
		return compareNumeric(attrValue, condition.Value, "<=")
	case "regex":
		re, err := regexp.Compile(condition.Value)
		if err != nil {
			return false
		}
		return re.MatchString(toString(attrValue))
	case "semver_gt":
		return compareSemver(toString(attrValue), condition.Value, ">")
	case "semver_lt":
		return compareSemver(toString(attrValue), condition.Value, "<")
	case "semver_eq":
		return compareSemver(toString(attrValue), condition.Value, "=")
	default:
		return false
	}
}

// getAttributeValue gets an attribute value from user context.
func getAttributeValue(attribute string, user *UserContext) interface{} {
	if user == nil {
		return nil
	}
	switch attribute {
	case "id":
		return user.ID
	case "email":
		return user.Email
	default:
		if user.Attributes != nil {
			return user.Attributes[attribute]
		}
		return nil
	}
}

// toString converts an interface value to string.
func toString(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(val)
	default:
		return ""
	}
}

// splitAndTrim splits a comma-separated string and trims whitespace.
func splitAndTrim(s string) []string {
	parts := strings.Split(s, ",")
	result := make([]string, len(parts))
	for i, p := range parts {
		result[i] = strings.TrimSpace(p)
	}
	return result
}

// compareNumeric compares two numeric values.
func compareNumeric(attrVal interface{}, condVal string, op string) bool {
	a, err := toFloat64(attrVal)
	if err != nil {
		return false
	}
	b, err := strconv.ParseFloat(condVal, 64)
	if err != nil {
		return false
	}

	switch op {
	case ">":
		return a > b
	case ">=":
		return a >= b
	case "<":
		return a < b
	case "<=":
		return a <= b
	default:
		return false
	}
}

// toFloat64 converts an interface to float64.
func toFloat64(v interface{}) (float64, error) {
	switch val := v.(type) {
	case float64:
		return val, nil
	case int:
		return float64(val), nil
	case int64:
		return float64(val), nil
	case string:
		return strconv.ParseFloat(val, 64)
	default:
		return 0, strconv.ErrSyntax
	}
}

// compareSemver compares two semantic versions.
func compareSemver(attrVal, condVal, op string) bool {
	a := parseVersion(attrVal)
	b := parseVersion(condVal)
	if a == nil || b == nil {
		return false
	}

	// Pad arrays to same length
	for len(a) < len(b) {
		a = append(a, 0)
	}
	for len(b) < len(a) {
		b = append(b, 0)
	}

	// Compare each part
	for i := 0; i < len(a); i++ {
		if a[i] > b[i] {
			return op == ">" || op == ">="
		}
		if a[i] < b[i] {
			return op == "<" || op == "<="
		}
	}
	// Equal
	return op == "=" || op == ">=" || op == "<="
}

// parseVersion parses a semantic version string.
func parseVersion(v string) []int {
	clean := strings.TrimPrefix(v, "v")
	parts := strings.Split(clean, ".")
	result := make([]int, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil
		}
		result = append(result, n)
	}
	return result
}

// isInRollout uses consistent hashing to determine if a user is in the rollout.
// Uses SHA-256 hash of flagKey:userId to ensure:
// - Same user always gets same result for a given flag
// - Distribution is statistically uniform
func isInRollout(flagKey, userID string, percentage int) bool {
	hash := sha256.Sum256([]byte(flagKey + ":" + userID))
	// Use first 4 bytes as uint32 and mod 100 to get a value 0-99
	value := binary.BigEndian.Uint32(hash[:4]) % 100
	return int(value) < percentage
}

// EvaluateAllFlags evaluates all flags for a user context.
func EvaluateAllFlags(rules map[string]FlagRule, user *UserContext) map[string]bool {
	result := make(map[string]bool)
	for key, rule := range rules {
		result[key] = EvaluateFlag(rule, user)
	}
	return result
}

// LocalEvaluator provides client-side flag evaluation.
type LocalEvaluator struct {
	rules   map[string]FlagRule
	version string
}

// NewLocalEvaluator creates a new local evaluator.
func NewLocalEvaluator() *LocalEvaluator {
	return &LocalEvaluator{
		rules: make(map[string]FlagRule),
	}
}

// SetRules sets the rules for local evaluation.
func (e *LocalEvaluator) SetRules(payload RulesPayload) {
	e.rules = payload.Flags
	e.version = payload.Version
}

// GetVersion returns the current rules version.
func (e *LocalEvaluator) GetVersion() string {
	return e.version
}

// Evaluate evaluates a single flag.
func (e *LocalEvaluator) Evaluate(flagKey string, user *UserContext, defaultValue bool) bool {
	rule, ok := e.rules[flagKey]
	if !ok {
		return defaultValue
	}
	return EvaluateFlag(rule, user)
}

// EvaluateAll evaluates all flags.
func (e *LocalEvaluator) EvaluateAll(user *UserContext) map[string]bool {
	return EvaluateAllFlags(e.rules, user)
}

// HasFlag checks if a flag exists.
func (e *LocalEvaluator) HasFlag(flagKey string) bool {
	_, ok := e.rules[flagKey]
	return ok
}
