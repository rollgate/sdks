package mock

import "sync"

// EvaluationReason explains why a flag evaluated to a particular value.
type EvaluationReason struct {
	Kind       string `json:"kind"`                 // OFF, TARGET_MATCH, RULE_MATCH, FALLTHROUGH, ERROR, UNKNOWN
	RuleID     string `json:"ruleId,omitempty"`     // For RULE_MATCH
	RuleIndex  int    `json:"ruleIndex,omitempty"`  // For RULE_MATCH
	InRollout  bool   `json:"inRollout,omitempty"`  // Whether user was in rollout percentage
	ErrorKind  string `json:"errorKind,omitempty"`  // For ERROR
}

// EvaluationResult contains the value and reason for an evaluation.
type EvaluationResult struct {
	Value     bool             `json:"value"`
	Variation string           `json:"variation,omitempty"` // Variation key from matched rule
	Reason    EvaluationReason `json:"reason"`
}

// FlagState represents a flag's configuration.
type FlagState struct {
	Key               string            `json:"key"`
	Enabled           bool              `json:"enabled"`
	RolloutPercentage int               `json:"rolloutPercentage,omitempty"` // 0-100
	TargetUsers       []string          `json:"targetUsers,omitempty"`
	Rules             []Rule            `json:"rules,omitempty"`
	Variations        map[string]any    `json:"variations,omitempty"` // For typed flags
	DefaultVariation  string            `json:"defaultVariation,omitempty"`
}

// Rule represents a targeting rule.
type Rule struct {
	ID                string      `json:"id"`
	Enabled           bool        `json:"enabled"`
	Conditions        []Condition `json:"conditions"`
	RolloutPercentage int         `json:"rolloutPercentage"` // 0-100
	Variation         string      `json:"variation,omitempty"`
}

// Condition represents a rule condition.
type Condition struct {
	Attribute string `json:"attribute"`
	Operator  string `json:"operator"` // eq, neq, contains, gt, gte, lt, lte, in
	Value     any    `json:"value"`
}

// FlagStore manages flag configurations for the mock server.
type FlagStore struct {
	mu    sync.RWMutex
	flags map[string]*FlagState
}

// NewFlagStore creates a new flag store.
func NewFlagStore() *FlagStore {
	return &FlagStore{
		flags: make(map[string]*FlagState),
	}
}

// Set adds or updates a flag.
func (fs *FlagStore) Set(flag *FlagState) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	fs.flags[flag.Key] = flag
}

// Get retrieves a flag by key.
func (fs *FlagStore) Get(key string) (*FlagState, bool) {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	f, ok := fs.flags[key]
	return f, ok
}

// GetAll returns all flags.
func (fs *FlagStore) GetAll() map[string]*FlagState {
	fs.mu.RLock()
	defer fs.mu.RUnlock()
	result := make(map[string]*FlagState, len(fs.flags))
	for k, v := range fs.flags {
		result[k] = v
	}
	return result
}

// Delete removes a flag.
func (fs *FlagStore) Delete(key string) {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	delete(fs.flags, key)
}

// Clear removes all flags.
func (fs *FlagStore) Clear() {
	fs.mu.Lock()
	defer fs.mu.Unlock()
	fs.flags = make(map[string]*FlagState)
}

// LoadScenario loads a predefined scenario of flags.
func (fs *FlagStore) LoadScenario(scenario string) {
	fs.Clear()

	switch scenario {
	case "basic":
		fs.loadBasicScenario()
	case "targeting":
		fs.loadTargetingScenario()
	case "rollout":
		fs.loadRolloutScenario()
	case "segments":
		fs.loadSegmentsScenario()
	case "empty":
		// Leave empty
	default:
		fs.loadBasicScenario()
	}
}

func (fs *FlagStore) loadBasicScenario() {
	fs.Set(&FlagState{Key: "enabled-flag", Enabled: true, RolloutPercentage: 100})
	fs.Set(&FlagState{Key: "disabled-flag", Enabled: false})
	fs.Set(&FlagState{Key: "rollout-50", Enabled: true, RolloutPercentage: 50})

	// Typed flags
	fs.Set(&FlagState{
		Key:              "banner-text",
		Enabled:          true,
		RolloutPercentage: 100,
		Variations:       map[string]any{"default": "Welcome"},
		DefaultVariation: "default",
	})
	fs.Set(&FlagState{
		Key:              "max-items",
		Enabled:          true,
		RolloutPercentage: 100,
		Variations:       map[string]any{"default": 10},
		DefaultVariation: "default",
	})
	fs.Set(&FlagState{
		Key:              "config",
		Enabled:          true,
		RolloutPercentage: 100,
		Variations:       map[string]any{"default": map[string]interface{}{"theme": "dark"}},
		DefaultVariation: "default",
	})
}

func (fs *FlagStore) loadTargetingScenario() {
	fs.loadBasicScenario()

	// Pro-only flag
	fs.Set(&FlagState{
		Key:     "pro-only",
		Enabled: true,
		Rules: []Rule{
			{
				ID:      "pro-rule",
				Enabled: true,
				Conditions: []Condition{
					{Attribute: "plan", Operator: "eq", Value: "pro"},
				},
				RolloutPercentage: 100,
			},
		},
	})

	// Beta users flag
	fs.Set(&FlagState{
		Key:     "beta-feature",
		Enabled: true,
		Rules: []Rule{
			{
				ID:      "beta-rule",
				Enabled: true,
				Conditions: []Condition{
					{Attribute: "beta", Operator: "eq", Value: true},
				},
				RolloutPercentage: 100,
			},
		},
	})

	// Target specific users
	fs.Set(&FlagState{
		Key:         "vip-feature",
		Enabled:     true,
		TargetUsers: []string{"user-vip-1", "user-vip-2"},
	})
}

func (fs *FlagStore) loadSegmentsScenario() {
	fs.loadBasicScenario()

	// Flag that uses a segment reference — segment conditions will be set via Server.SetSegment()
	fs.Set(&FlagState{
		Key:     "pro-feature",
		Enabled: true,
		Rules: []Rule{
			{
				ID:      "segment-rule",
				Enabled: true,
				Conditions: []Condition{
					{Attribute: "segment", Operator: "in", Value: "pro-users"},
				},
				RolloutPercentage: 100,
			},
		},
		RolloutPercentage: 0, // Disabled by default, only enabled via segment rule
	})
}

func (fs *FlagStore) loadRolloutScenario() {
	fs.Set(&FlagState{Key: "rollout-0", Enabled: true, RolloutPercentage: 0})
	fs.Set(&FlagState{Key: "rollout-10", Enabled: true, RolloutPercentage: 10})
	fs.Set(&FlagState{Key: "rollout-25", Enabled: true, RolloutPercentage: 25})
	fs.Set(&FlagState{Key: "rollout-50", Enabled: true, RolloutPercentage: 50})
	fs.Set(&FlagState{Key: "rollout-75", Enabled: true, RolloutPercentage: 75})
	fs.Set(&FlagState{Key: "rollout-90", Enabled: true, RolloutPercentage: 90})
	fs.Set(&FlagState{Key: "rollout-100", Enabled: true, RolloutPercentage: 100})
}
