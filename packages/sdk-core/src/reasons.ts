/**
 * Evaluation Reasons for Rollgate SDKs
 *
 * Provides detailed information about why a flag evaluated to a particular value.
 * Compatible with LaunchDarkly's evaluation reason format.
 */

/**
 * The kind of reason that caused a particular flag evaluation result.
 */
export type EvaluationReasonKind =
  | "OFF" // Flag is disabled
  | "TARGET_MATCH" // User is in the target users list
  | "RULE_MATCH" // User matched a targeting rule
  | "FALLTHROUGH" // No rules matched, using default rollout
  | "ERROR" // An error occurred during evaluation
  | "UNKNOWN"; // Flag not found or unknown reason

/**
 * Detailed evaluation reason explaining why a flag returned a particular value.
 */
export interface EvaluationReason {
  /** The general category of the reason */
  kind: EvaluationReasonKind;

  /** The unique identifier of the matched rule (for RULE_MATCH) */
  ruleId?: string;

  /** The 0-based index of the matched rule (for RULE_MATCH) */
  ruleIndex?: number;

  /** Whether this evaluation is part of an experiment (for RULE_MATCH or FALLTHROUGH) */
  inExperiment?: boolean;

  /** The specific error type if kind is ERROR */
  errorKind?: EvaluationErrorKind;

  /** Whether the user was included in the rollout percentage */
  inRollout?: boolean;
}

/**
 * Types of errors that can occur during evaluation.
 */
export type EvaluationErrorKind =
  | "FLAG_NOT_FOUND" // The flag key does not exist
  | "MALFORMED_FLAG" // The flag configuration is invalid
  | "USER_NOT_SPECIFIED" // No user context was provided for targeting
  | "CLIENT_NOT_READY" // The SDK client is not initialized
  | "EXCEPTION"; // An unexpected error occurred

/**
 * Detailed evaluation result including the value and reason.
 */
export interface EvaluationDetail<T = boolean> {
  /** The evaluated flag value */
  value: T;

  /** The reason for this evaluation result */
  reason: EvaluationReason;

  /** Index of the selected variation (for multi-variate flags) */
  variationIndex?: number;

  /** ID of the selected variation (for multi-variate flags) */
  variationId?: string;
}

/**
 * Create a reason for a disabled flag.
 */
export function offReason(): EvaluationReason {
  return { kind: "OFF" };
}

/**
 * Create a reason for a target user match.
 */
export function targetMatchReason(): EvaluationReason {
  return { kind: "TARGET_MATCH" };
}

/**
 * Create a reason for a rule match.
 */
export function ruleMatchReason(
  ruleId: string,
  ruleIndex: number,
  inRollout: boolean = true,
): EvaluationReason {
  return {
    kind: "RULE_MATCH",
    ruleId,
    ruleIndex,
    inRollout,
  };
}

/**
 * Create a reason for fallthrough to default rollout.
 */
export function fallthroughReason(inRollout: boolean = true): EvaluationReason {
  return {
    kind: "FALLTHROUGH",
    inRollout,
  };
}

/**
 * Create a reason for an error.
 */
export function errorReason(errorKind: EvaluationErrorKind): EvaluationReason {
  return {
    kind: "ERROR",
    errorKind,
  };
}

/**
 * Create a reason for an unknown flag.
 */
export function unknownReason(): EvaluationReason {
  return { kind: "UNKNOWN" };
}
