package rollgate

// EvaluationReasonKind represents the category of reason for a flag evaluation.
type EvaluationReasonKind string

const (
	// ReasonOff indicates the flag is disabled.
	ReasonOff EvaluationReasonKind = "OFF"
	// ReasonTargetMatch indicates the user is in the target users list.
	ReasonTargetMatch EvaluationReasonKind = "TARGET_MATCH"
	// ReasonRuleMatch indicates the user matched a targeting rule.
	ReasonRuleMatch EvaluationReasonKind = "RULE_MATCH"
	// ReasonFallthrough indicates no rules matched, using default rollout.
	ReasonFallthrough EvaluationReasonKind = "FALLTHROUGH"
	// ReasonError indicates an error occurred during evaluation.
	ReasonError EvaluationReasonKind = "ERROR"
	// ReasonUnknown indicates the flag was not found or reason is unknown.
	ReasonUnknown EvaluationReasonKind = "UNKNOWN"
)

// EvaluationErrorKind represents types of errors during evaluation.
type EvaluationErrorKind string

const (
	// ErrorFlagNotFound indicates the flag key does not exist.
	ErrorFlagNotFound EvaluationErrorKind = "FLAG_NOT_FOUND"
	// ErrorMalformedFlag indicates the flag configuration is invalid.
	ErrorMalformedFlag EvaluationErrorKind = "MALFORMED_FLAG"
	// ErrorUserNotSpecified indicates no user context was provided.
	ErrorUserNotSpecified EvaluationErrorKind = "USER_NOT_SPECIFIED"
	// ErrorClientNotReady indicates the SDK client is not initialized.
	ErrorClientNotReady EvaluationErrorKind = "CLIENT_NOT_READY"
	// ErrorException indicates an unexpected error occurred.
	ErrorException EvaluationErrorKind = "EXCEPTION"
)

// EvaluationReason explains why a flag evaluated to a particular value.
type EvaluationReason struct {
	// Kind is the general category of the reason.
	Kind EvaluationReasonKind `json:"kind"`
	// RuleID is the unique identifier of the matched rule (for RULE_MATCH).
	RuleID string `json:"ruleId,omitempty"`
	// RuleIndex is the 0-based index of the matched rule (for RULE_MATCH).
	RuleIndex int `json:"ruleIndex,omitempty"`
	// InRollout indicates whether the user was included in the rollout percentage.
	InRollout bool `json:"inRollout,omitempty"`
	// ErrorKind is the specific error type if Kind is ERROR.
	ErrorKind EvaluationErrorKind `json:"errorKind,omitempty"`
}

// EvaluationDetail contains the full result of a flag evaluation.
type EvaluationDetail[T any] struct {
	// Value is the evaluated flag value.
	Value T `json:"value"`
	// Reason explains why this value was returned.
	Reason EvaluationReason `json:"reason"`
	// VariationIndex is the index of the selected variation (for multi-variate flags).
	VariationIndex int `json:"variationIndex,omitempty"`
	// VariationID is the ID of the selected variation (for multi-variate flags).
	VariationID string `json:"variationId,omitempty"`
}

// BoolEvaluationDetail is an alias for EvaluationDetail[bool] for convenience.
type BoolEvaluationDetail = EvaluationDetail[bool]

// Helper functions to create common reasons

// OffReason creates a reason for a disabled flag.
func OffReason() EvaluationReason {
	return EvaluationReason{Kind: ReasonOff}
}

// TargetMatchReason creates a reason for a target user match.
func TargetMatchReason() EvaluationReason {
	return EvaluationReason{Kind: ReasonTargetMatch}
}

// RuleMatchReason creates a reason for a rule match.
func RuleMatchReason(ruleID string, ruleIndex int, inRollout bool) EvaluationReason {
	return EvaluationReason{
		Kind:      ReasonRuleMatch,
		RuleID:    ruleID,
		RuleIndex: ruleIndex,
		InRollout: inRollout,
	}
}

// FallthroughReason creates a reason for fallthrough to default rollout.
func FallthroughReason(inRollout bool) EvaluationReason {
	return EvaluationReason{
		Kind:      ReasonFallthrough,
		InRollout: inRollout,
	}
}

// ErrorReason creates a reason for an error.
func ErrorReason(errorKind EvaluationErrorKind) EvaluationReason {
	return EvaluationReason{
		Kind:      ReasonError,
		ErrorKind: errorKind,
	}
}

// UnknownReason creates a reason for an unknown flag.
func UnknownReason() EvaluationReason {
	return EvaluationReason{Kind: ReasonUnknown}
}
