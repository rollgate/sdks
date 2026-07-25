/**
 * Pure translation helpers between Rollgate SDK types and OpenFeature types.
 *
 * Kept side-effect free so they can be unit-tested in isolation and reused by a
 * future web provider.
 */
import {
  ErrorCode,
  StandardResolutionReasons,
  type EvaluationContext,
  type EvaluationContextValue,
  type FlagMetadata,
  type ResolutionReason,
} from "@openfeature/server-sdk";
import type { EvaluationErrorKind, EvaluationReason } from "@rollgate/sdk-core";
import type { EvalContext } from "@rollgate/sdk-node";

/** Attribute values Rollgate accepts (flat primitives only). */
type RollgateAttribute = string | number | boolean;

/**
 * Convert an OpenFeature EvaluationContext into a Rollgate EvalContext.
 *
 * - `targetingKey` becomes `userId`. When absent, returns `undefined` so the
 *   SDK falls back to its client-level user (server-side callers should always
 *   pass a targetingKey for correct targeting).
 * - Only flat primitives (string/number/boolean) survive as attributes. `Date`
 *   is serialized to ISO string; nested objects/arrays are dropped, since the
 *   Rollgate targeting engine only matches on flat attributes.
 */
export function toEvalContext(
  context: EvaluationContext | undefined,
): EvalContext | undefined {
  if (!context) return undefined;

  const { targetingKey, ...rest } = context;
  const attributes = flattenAttributes(rest);

  if (targetingKey === undefined) {
    // No targeting key: only worth forwarding attributes if any survived.
    return undefined;
  }

  // OpenFeature types targetingKey as string, but coerce defensively so a
  // stray number never reaches the Rollgate user id (which must be a string).
  const userId = String(targetingKey);

  return Object.keys(attributes).length > 0
    ? { userId, attributes }
    : { userId };
}

function flattenAttributes(
  raw: Record<string, EvaluationContextValue>,
): Record<string, RollgateAttribute> {
  const out: Record<string, RollgateAttribute> = {};
  for (const [key, value] of Object.entries(raw)) {
    const coerced = coerceAttribute(value);
    if (coerced !== undefined) out[key] = coerced;
  }
  return out;
}

function coerceAttribute(
  value: EvaluationContextValue,
): RollgateAttribute | undefined {
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object":
      if (value instanceof Date) return value.toISOString();
      // Nested objects and arrays are unsupported by the targeting engine.
      return undefined;
    default:
      return undefined;
  }
}

/** Map a Rollgate reason kind onto an OpenFeature standard resolution reason. */
export function mapReason(reason: EvaluationReason): ResolutionReason {
  switch (reason.kind) {
    case "OFF":
      return StandardResolutionReasons.DISABLED;
    case "TARGET_MATCH":
    case "RULE_MATCH":
      return StandardResolutionReasons.TARGETING_MATCH;
    case "FALLTHROUGH":
      return StandardResolutionReasons.DEFAULT;
    case "ERROR":
      return StandardResolutionReasons.ERROR;
    case "UNKNOWN":
    default:
      return StandardResolutionReasons.UNKNOWN;
  }
}

/** Map a Rollgate error kind onto an OpenFeature ErrorCode. */
export function mapErrorCode(
  errorKind: EvaluationErrorKind | undefined,
): ErrorCode {
  switch (errorKind) {
    case "FLAG_NOT_FOUND":
      return ErrorCode.FLAG_NOT_FOUND;
    case "MALFORMED_FLAG":
      return ErrorCode.PARSE_ERROR;
    case "USER_NOT_SPECIFIED":
      return ErrorCode.TARGETING_KEY_MISSING;
    case "CLIENT_NOT_READY":
      return ErrorCode.PROVIDER_NOT_READY;
    case "EXCEPTION":
    default:
      return ErrorCode.GENERAL;
  }
}

/**
 * Build OpenFeature flagMetadata from the Rollgate reason, exposing the pieces
 * that consumers commonly want for analytics/experiments. Returns `undefined`
 * when there is nothing useful to attach.
 */
export function buildFlagMetadata(
  reason: EvaluationReason,
  variationId: string | undefined,
): FlagMetadata | undefined {
  const meta: FlagMetadata = {};
  if (variationId !== undefined) meta.variationId = variationId;
  if (reason.ruleId !== undefined) meta.ruleId = reason.ruleId;
  if (reason.inExperiment !== undefined)
    meta.inExperiment = reason.inExperiment;
  return Object.keys(meta).length > 0 ? meta : undefined;
}
