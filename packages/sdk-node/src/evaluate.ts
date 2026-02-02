/**
 * Client-side flag evaluation logic.
 * Mirrors the server-side evaluation in Go for consistency.
 */

import { createHash } from "crypto";
import type {
  EvaluationReason,
  EvaluationDetail,
  EvaluationReasonKind,
} from "@rollgate/sdk-core";
import {
  offReason,
  targetMatchReason,
  ruleMatchReason,
  fallthroughReason,
  unknownReason,
} from "@rollgate/sdk-core";

export interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, string | number | boolean>;
}

// Re-export reason types for convenience
export type { EvaluationReason, EvaluationDetail, EvaluationReasonKind };

export interface Condition {
  attribute: string;
  operator: string;
  value: string;
}

export interface TargetingRule {
  id: string;
  name?: string;
  enabled: boolean;
  rollout: number;
  conditions: Condition[];
}

export interface FlagRule {
  key: string;
  enabled: boolean;
  rollout: number;
  targetUsers?: string[];
  rules?: TargetingRule[];
}

export interface RulesPayload {
  version: string;
  flags: Record<string, FlagRule>;
}

// V2 types with variation support
export type FlagType = "boolean" | "string" | "number" | "json";

export interface Variation {
  id: string;
  name: string;
  value: unknown;
}

export interface TargetingRuleV2 extends TargetingRule {
  variationId?: string; // Which variation to serve when rule matches
}

export interface FlagRuleV2 {
  key: string;
  type: FlagType;
  enabled: boolean;
  rollout: number;
  defaultValue: unknown;
  targetUsers?: string[];
  variations?: Variation[];
  rules?: TargetingRuleV2[];
}

export interface RulesPayloadV2 {
  version: string;
  flags: Record<string, FlagRuleV2>;
}

export interface EvaluationResult<T = unknown> {
  enabled: boolean;
  value: T;
  variationId?: string;
  reason?: EvaluationReason;
}

/**
 * Evaluate a flag for a given user context using client-side rules.
 * This mirrors the server-side evaluation logic exactly.
 *
 * Evaluation priority:
 * 1. If flag is disabled, return false
 * 2. If user is in targetUsers list, return true
 * 3. If user matches any enabled targeting rule, use rule's rollout
 * 4. Otherwise, use flag's default rollout percentage
 */
export function evaluateFlag(
  rule: FlagRule,
  user: UserContext | null,
): boolean {
  // 1. If flag is disabled, always return false
  if (!rule.enabled) {
    return false;
  }

  // 2. Check if user is in target list (always enabled for targeted users)
  if (user?.id && rule.targetUsers?.includes(user.id)) {
    return true;
  }

  // 3. Check targeting rules (if user context is provided)
  if (user && rule.rules && rule.rules.length > 0) {
    for (const targetingRule of rule.rules) {
      if (targetingRule.enabled && matchesRule(targetingRule, user)) {
        // User matches this rule, use rule's rollout percentage
        if (targetingRule.rollout >= 100) {
          return true;
        }
        if (targetingRule.rollout <= 0) {
          return false;
        }
        return isInRollout(rule.key, user.id, targetingRule.rollout);
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
  if (!user?.id) {
    return false;
  }
  return isInRollout(rule.key, user.id, rule.rollout);
}

/**
 * Evaluate a flag and return the result with detailed reason.
 * This provides the same evaluation logic as evaluateFlag but includes
 * the reason why the flag evaluated to its value.
 */
export function evaluateFlagWithReason(
  rule: FlagRule,
  user: UserContext | null,
): EvaluationDetail<boolean> {
  // 1. If flag is disabled, always return false
  if (!rule.enabled) {
    return { value: false, reason: offReason() };
  }

  // 2. Check if user is in target list (always enabled for targeted users)
  if (user?.id && rule.targetUsers?.includes(user.id)) {
    return { value: true, reason: targetMatchReason() };
  }

  // 3. Check targeting rules (if user context is provided)
  if (user && rule.rules && rule.rules.length > 0) {
    for (let i = 0; i < rule.rules.length; i++) {
      const targetingRule = rule.rules[i];
      if (targetingRule.enabled && matchesRule(targetingRule, user)) {
        // User matches this rule, use rule's rollout percentage
        if (targetingRule.rollout >= 100) {
          return {
            value: true,
            reason: ruleMatchReason(targetingRule.id, i, true),
          };
        }
        if (targetingRule.rollout <= 0) {
          return {
            value: false,
            reason: ruleMatchReason(targetingRule.id, i, false),
          };
        }
        const inRollout = isInRollout(rule.key, user.id, targetingRule.rollout);
        return {
          value: inRollout,
          reason: ruleMatchReason(targetingRule.id, i, inRollout),
        };
      }
    }
  }

  // 4. Default rollout percentage (FALLTHROUGH)
  if (rule.rollout >= 100) {
    return { value: true, reason: fallthroughReason(true) };
  }
  if (rule.rollout <= 0) {
    return { value: false, reason: fallthroughReason(false) };
  }

  // Use consistent hashing for rollout (requires user ID)
  if (!user?.id) {
    return { value: false, reason: fallthroughReason(false) };
  }

  const inRollout = isInRollout(rule.key, user.id, rule.rollout);
  return { value: inRollout, reason: fallthroughReason(inRollout) };
}

/**
 * Check if a user matches a targeting rule.
 * All conditions within a rule must match (AND logic).
 */
function matchesRule(rule: TargetingRule, user: UserContext): boolean {
  if (!rule.conditions || rule.conditions.length === 0) {
    return false;
  }

  // All conditions must match (AND)
  for (const condition of rule.conditions) {
    if (!matchesCondition(condition, user)) {
      return false;
    }
  }
  return true;
}

/**
 * Check if a user matches a single condition.
 */
function matchesCondition(condition: Condition, user: UserContext): boolean {
  const attrValue = getAttributeValue(condition.attribute, user);
  const exists = attrValue !== undefined && attrValue !== "";

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

  const value = String(attrValue).toLowerCase();
  const condValue = condition.value.toLowerCase();

  switch (condition.operator) {
    case "equals":
      return value === condValue;
    case "not_equals":
      return value !== condValue;
    case "contains":
      return value.includes(condValue);
    case "not_contains":
      return !value.includes(condValue);
    case "starts_with":
      return value.startsWith(condValue);
    case "ends_with":
      return value.endsWith(condValue);
    case "in": {
      const values = condition.value
        .split(",")
        .map((v) => v.trim().toLowerCase());
      return values.includes(value);
    }
    case "not_in": {
      const values = condition.value
        .split(",")
        .map((v) => v.trim().toLowerCase());
      return !values.includes(value);
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
        return new RegExp(condition.value).test(String(attrValue));
      } catch {
        return false;
      }
    case "semver_gt":
      return compareSemver(String(attrValue), condition.value, ">");
    case "semver_lt":
      return compareSemver(String(attrValue), condition.value, "<");
    case "semver_eq":
      return compareSemver(String(attrValue), condition.value, "=");
    default:
      return false;
  }
}

/**
 * Get an attribute value from user context.
 */
function getAttributeValue(
  attribute: string,
  user: UserContext,
): string | number | boolean | undefined {
  switch (attribute) {
    case "id":
      return user.id;
    case "email":
      return user.email;
    default:
      return user.attributes?.[attribute];
  }
}

/**
 * Compare two numeric values.
 */
function compareNumeric(
  attrVal: string | number | boolean | undefined,
  condVal: string,
  op: string,
): boolean {
  const a = parseFloat(String(attrVal));
  const b = parseFloat(condVal);
  if (isNaN(a) || isNaN(b)) {
    return false;
  }
  switch (op) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    default:
      return false;
  }
}

/**
 * Compare two semantic versions.
 */
function compareSemver(attrVal: string, condVal: string, op: string): boolean {
  // Normalize versions (add 'v' prefix if missing for parsing)
  const parseVersion = (v: string): number[] | null => {
    const clean = v.replace(/^v/, "");
    const parts = clean.split(".").map((p) => parseInt(p, 10));
    if (parts.some(isNaN)) return null;
    return parts;
  };

  const a = parseVersion(attrVal);
  const b = parseVersion(condVal);
  if (!a || !b) return false;

  // Pad arrays to same length
  while (a.length < b.length) a.push(0);
  while (b.length < a.length) b.push(0);

  // Compare each part
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i]) return op === ">" || op === ">=";
    if (a[i] < b[i]) return op === "<" || op === "<=";
  }
  // Equal
  return op === "=" || op === ">=" || op === "<=";
}

/**
 * Consistent hashing for rollout percentage.
 * Uses SHA-256 hash of flagKey:userId to ensure:
 * - Same user always gets same result for a given flag
 * - Distribution is statistically uniform
 */
function isInRollout(
  flagKey: string,
  userId: string,
  percentage: number,
): boolean {
  const hash = createHash("sha256").update(`${flagKey}:${userId}`).digest();
  // Use first 4 bytes as uint32 and mod 100 to get a value 0-99
  const value = hash.readUInt32BE(0) % 100;
  return value < percentage;
}

/**
 * Evaluate all flags for a user context.
 */
export function evaluateAllFlags(
  rules: Record<string, FlagRule>,
  user: UserContext | null,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [key, rule] of Object.entries(rules)) {
    result[key] = evaluateFlag(rule, user);
  }
  return result;
}

/**
 * Evaluate a flag and return the full value (supports all types).
 * For V2 rules with type and variations support.
 */
export function evaluateFlagValue<T = unknown>(
  rule: FlagRuleV2,
  user: UserContext | null,
): EvaluationResult<T> {
  // If flag is disabled, return default value
  if (!rule.enabled) {
    return {
      enabled: false,
      value: getDefaultValue(rule) as T,
      reason: offReason(),
    };
  }

  // Check if user is in target list
  if (user?.id && rule.targetUsers?.includes(user.id)) {
    return {
      enabled: true,
      value: getEnabledValue(rule, undefined) as T,
      reason: targetMatchReason(),
    };
  }

  // Check targeting rules
  if (user && rule.rules && rule.rules.length > 0) {
    for (let i = 0; i < rule.rules.length; i++) {
      const targetingRule = rule.rules[i];
      if (targetingRule.enabled && matchesRuleV2(targetingRule, user)) {
        // Rule matches - check rollout
        if (targetingRule.rollout <= 0) {
          return {
            enabled: false,
            value: getDefaultValue(rule) as T,
            reason: ruleMatchReason(targetingRule.id, i, false),
          };
        }
        const inRollout =
          targetingRule.rollout >= 100 ||
          isInRollout(rule.key, user.id, targetingRule.rollout);
        if (inRollout) {
          return {
            enabled: true,
            value: getEnabledValue(rule, targetingRule.variationId) as T,
            variationId: targetingRule.variationId,
            reason: ruleMatchReason(targetingRule.id, i, true),
          };
        }
        return {
          enabled: false,
          value: getDefaultValue(rule) as T,
          reason: ruleMatchReason(targetingRule.id, i, false),
        };
      }
    }
  }

  // Default rollout (FALLTHROUGH)
  if (rule.rollout >= 100) {
    return {
      enabled: true,
      value: getEnabledValue(rule, undefined) as T,
      reason: fallthroughReason(true),
    };
  }
  if (rule.rollout <= 0 || !user?.id) {
    return {
      enabled: false,
      value: getDefaultValue(rule) as T,
      reason: fallthroughReason(false),
    };
  }

  const inRollout = isInRollout(rule.key, user.id, rule.rollout);
  if (inRollout) {
    return {
      enabled: true,
      value: getEnabledValue(rule, undefined) as T,
      reason: fallthroughReason(true),
    };
  }

  return {
    enabled: false,
    value: getDefaultValue(rule) as T,
    reason: fallthroughReason(false),
  };
}

/**
 * Get the default/disabled value for a flag based on its type.
 */
function getDefaultValue(rule: FlagRuleV2): unknown {
  if (rule.defaultValue !== undefined) {
    return rule.defaultValue;
  }

  // Type-specific defaults
  switch (rule.type) {
    case "boolean":
      return false;
    case "string":
      return "";
    case "number":
      return 0;
    case "json":
      return null;
    default:
      return false;
  }
}

/**
 * Get the enabled value, optionally selecting a specific variation.
 */
function getEnabledValue(rule: FlagRuleV2, variationId?: string): unknown {
  // If variationId specified, find that variation
  if (variationId && rule.variations) {
    const variation = rule.variations.find((v) => v.id === variationId);
    if (variation) {
      return variation.value;
    }
  }

  // For boolean flags, enabled = true
  if (rule.type === "boolean") {
    return true;
  }

  // Return first variation or default
  if (rule.variations && rule.variations.length > 0) {
    return rule.variations[0].value;
  }

  return rule.defaultValue;
}

/**
 * Check if a user matches a targeting rule (V2 version).
 */
function matchesRuleV2(rule: TargetingRuleV2, user: UserContext): boolean {
  if (!rule.conditions || rule.conditions.length === 0) {
    return false;
  }

  for (const condition of rule.conditions) {
    if (!matchesCondition(condition, user)) {
      return false;
    }
  }
  return true;
}

/**
 * Evaluate all V2 flags and return typed values.
 */
export function evaluateAllFlagsV2(
  rules: Record<string, FlagRuleV2>,
  user: UserContext | null,
): Record<string, EvaluationResult> {
  const result: Record<string, EvaluationResult> = {};
  for (const [key, rule] of Object.entries(rules)) {
    result[key] = evaluateFlagValue(rule, user);
  }
  return result;
}
