package rollgate

import (
	"testing"
)

func TestEvaluateFlag_DisabledFlag(t *testing.T) {
	rule := FlagRule{
		Key:     "test-flag",
		Enabled: false,
		Rollout: 100,
	}

	result := EvaluateFlag(rule, &UserContext{ID: "user-1"})
	if result != false {
		t.Errorf("Expected disabled flag to return false, got %v", result)
	}
}

func TestEvaluateFlag_EnabledFlag100Rollout(t *testing.T) {
	rule := FlagRule{
		Key:     "test-flag",
		Enabled: true,
		Rollout: 100,
	}

	result := EvaluateFlag(rule, &UserContext{ID: "user-1"})
	if result != true {
		t.Errorf("Expected 100%% rollout to return true, got %v", result)
	}
}

func TestEvaluateFlag_EnabledFlag0Rollout(t *testing.T) {
	rule := FlagRule{
		Key:     "test-flag",
		Enabled: true,
		Rollout: 0,
	}

	result := EvaluateFlag(rule, &UserContext{ID: "user-1"})
	if result != false {
		t.Errorf("Expected 0%% rollout to return false, got %v", result)
	}
}

func TestEvaluateFlag_TargetUser(t *testing.T) {
	rule := FlagRule{
		Key:         "test-flag",
		Enabled:     true,
		Rollout:     0,
		TargetUsers: []string{"user-1", "user-2"},
	}

	// Targeted user should get true even with 0% rollout
	result := EvaluateFlag(rule, &UserContext{ID: "user-1"})
	if result != true {
		t.Errorf("Expected targeted user to return true, got %v", result)
	}

	// Non-targeted user should get false with 0% rollout
	result = EvaluateFlag(rule, &UserContext{ID: "user-3"})
	if result != false {
		t.Errorf("Expected non-targeted user to return false, got %v", result)
	}
}

func TestEvaluateFlag_TargetingRuleEquals(t *testing.T) {
	rule := FlagRule{
		Key:     "test-flag",
		Enabled: true,
		Rollout: 0,
		Rules: []TargetingRule{
			{
				ID:      "rule-1",
				Enabled: true,
				Rollout: 100,
				Conditions: []Condition{
					{Attribute: "email", Operator: "ends_with", Value: "@example.com"},
				},
			},
		},
	}

	// User matching rule should get true
	result := EvaluateFlag(rule, &UserContext{
		ID:    "user-1",
		Email: "test@example.com",
	})
	if result != true {
		t.Errorf("Expected matching user to return true, got %v", result)
	}

	// User not matching rule should get false (0% default rollout)
	result = EvaluateFlag(rule, &UserContext{
		ID:    "user-2",
		Email: "test@other.com",
	})
	if result != false {
		t.Errorf("Expected non-matching user to return false, got %v", result)
	}
}

func TestEvaluateFlag_ConditionOperators(t *testing.T) {
	tests := []struct {
		name      string
		operator  string
		condValue string
		attrValue string
		expected  bool
	}{
		{"equals_match", "equals", "test", "test", true},
		{"equals_no_match", "equals", "test", "other", false},
		{"not_equals_match", "not_equals", "test", "other", true},
		{"not_equals_no_match", "not_equals", "test", "test", false},
		{"contains_match", "contains", "test", "this is a test", true},
		{"contains_no_match", "contains", "test", "no match", false},
		{"starts_with_match", "starts_with", "hello", "hello world", true},
		{"starts_with_no_match", "starts_with", "hello", "world hello", false},
		{"ends_with_match", "ends_with", "world", "hello world", true},
		{"ends_with_no_match", "ends_with", "world", "world hello", false},
		{"in_match", "in", "a,b,c", "b", true},
		{"in_no_match", "in", "a,b,c", "d", false},
		{"not_in_match", "not_in", "a,b,c", "d", true},
		{"not_in_no_match", "not_in", "a,b,c", "b", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := FlagRule{
				Key:     "test-flag",
				Enabled: true,
				Rollout: 0,
				Rules: []TargetingRule{
					{
						ID:      "rule-1",
						Enabled: true,
						Rollout: 100,
						Conditions: []Condition{
							{Attribute: "name", Operator: tt.operator, Value: tt.condValue},
						},
					},
				},
			}

			result := EvaluateFlag(rule, &UserContext{
				ID:         "user-1",
				Attributes: map[string]interface{}{"name": tt.attrValue},
			})

			if result != tt.expected {
				t.Errorf("Expected %v for operator %s, got %v", tt.expected, tt.operator, result)
			}
		})
	}
}

func TestEvaluateFlag_NumericComparison(t *testing.T) {
	tests := []struct {
		name      string
		operator  string
		condValue string
		attrValue int
		expected  bool
	}{
		{"greater_than_true", "greater_than", "10", 15, true},
		{"greater_than_false", "greater_than", "10", 5, false},
		{"greater_equal_true", "greater_equal", "10", 10, true},
		{"less_than_true", "less_than", "10", 5, true},
		{"less_than_false", "less_than", "10", 15, false},
		{"less_equal_true", "less_equal", "10", 10, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := FlagRule{
				Key:     "test-flag",
				Enabled: true,
				Rollout: 0,
				Rules: []TargetingRule{
					{
						ID:      "rule-1",
						Enabled: true,
						Rollout: 100,
						Conditions: []Condition{
							{Attribute: "age", Operator: tt.operator, Value: tt.condValue},
						},
					},
				},
			}

			result := EvaluateFlag(rule, &UserContext{
				ID:         "user-1",
				Attributes: map[string]interface{}{"age": tt.attrValue},
			})

			if result != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestEvaluateFlag_SemverComparison(t *testing.T) {
	tests := []struct {
		name      string
		operator  string
		condValue string
		attrValue string
		expected  bool
	}{
		{"semver_gt_true", "semver_gt", "1.0.0", "2.0.0", true},
		{"semver_gt_false", "semver_gt", "2.0.0", "1.0.0", false},
		{"semver_lt_true", "semver_lt", "2.0.0", "1.0.0", true},
		{"semver_eq_true", "semver_eq", "1.2.3", "1.2.3", true},
		{"semver_eq_false", "semver_eq", "1.2.3", "1.2.4", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := FlagRule{
				Key:     "test-flag",
				Enabled: true,
				Rollout: 0,
				Rules: []TargetingRule{
					{
						ID:      "rule-1",
						Enabled: true,
						Rollout: 100,
						Conditions: []Condition{
							{Attribute: "version", Operator: tt.operator, Value: tt.condValue},
						},
					},
				},
			}

			result := EvaluateFlag(rule, &UserContext{
				ID:         "user-1",
				Attributes: map[string]interface{}{"version": tt.attrValue},
			})

			if result != tt.expected {
				t.Errorf("Expected %v, got %v", tt.expected, result)
			}
		})
	}
}

func TestEvaluateFlag_ConsistentHashing(t *testing.T) {
	rule := FlagRule{
		Key:     "test-flag",
		Enabled: true,
		Rollout: 50,
	}

	// Same user should always get same result
	user := &UserContext{ID: "consistent-user"}
	firstResult := EvaluateFlag(rule, user)

	for i := 0; i < 100; i++ {
		result := EvaluateFlag(rule, user)
		if result != firstResult {
			t.Errorf("Inconsistent result for same user: expected %v, got %v", firstResult, result)
		}
	}
}

func TestEvaluateFlag_RolloutDistribution(t *testing.T) {
	rule := FlagRule{
		Key:     "distribution-test",
		Enabled: true,
		Rollout: 50,
	}

	trueCount := 0
	totalUsers := 10000

	for i := 0; i < totalUsers; i++ {
		user := &UserContext{ID: string(rune(i))}
		if EvaluateFlag(rule, user) {
			trueCount++
		}
	}

	// With 50% rollout, we expect roughly 50% true
	// Allow 5% margin for statistical variance
	percentage := float64(trueCount) / float64(totalUsers) * 100
	if percentage < 45 || percentage > 55 {
		t.Errorf("Rollout distribution out of expected range: %.2f%%", percentage)
	}
}

func TestEvaluateAllFlags(t *testing.T) {
	rules := map[string]FlagRule{
		"flag-1": {Key: "flag-1", Enabled: true, Rollout: 100},
		"flag-2": {Key: "flag-2", Enabled: false, Rollout: 100},
		"flag-3": {Key: "flag-3", Enabled: true, Rollout: 0},
	}

	result := EvaluateAllFlags(rules, &UserContext{ID: "user-1"})

	if result["flag-1"] != true {
		t.Error("flag-1 should be true")
	}
	if result["flag-2"] != false {
		t.Error("flag-2 should be false")
	}
	if result["flag-3"] != false {
		t.Error("flag-3 should be false")
	}
}

func TestLocalEvaluator(t *testing.T) {
	evaluator := NewLocalEvaluator()

	payload := RulesPayload{
		Version: "v1",
		Flags: map[string]FlagRule{
			"feature-a": {Key: "feature-a", Enabled: true, Rollout: 100},
			"feature-b": {Key: "feature-b", Enabled: false, Rollout: 100},
		},
	}

	evaluator.SetRules(payload)

	if evaluator.GetVersion() != "v1" {
		t.Errorf("Expected version v1, got %s", evaluator.GetVersion())
	}

	if !evaluator.HasFlag("feature-a") {
		t.Error("Should have feature-a")
	}

	if evaluator.HasFlag("feature-c") {
		t.Error("Should not have feature-c")
	}

	user := &UserContext{ID: "user-1"}

	if !evaluator.Evaluate("feature-a", user, false) {
		t.Error("feature-a should be enabled")
	}

	if evaluator.Evaluate("feature-b", user, true) {
		t.Error("feature-b should be disabled")
	}

	if evaluator.Evaluate("feature-c", user, true) != true {
		t.Error("Unknown flag should return default value")
	}
}
