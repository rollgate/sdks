/**
 * Analytics Events for Rollgate SDKs
 *
 * Types for tracking flag evaluations and custom analytics events.
 */

import type { EvaluationReason } from "./reasons";

/**
 * Types of analytics events that can be sent.
 */
export type AnalyticsEventKind = "feature" | "identify" | "custom";

/**
 * Base interface for all analytics events.
 */
export interface BaseAnalyticsEvent {
  /** The type of event */
  kind: AnalyticsEventKind;

  /** Timestamp when the event occurred (milliseconds since epoch) */
  timestamp: number;
}

/**
 * Feature flag evaluation event.
 * Sent when a flag is evaluated with detailed tracking enabled.
 */
export interface FeatureEvent extends BaseAnalyticsEvent {
  kind: "feature";

  /** The flag key that was evaluated */
  key: string;

  /** The evaluated value */
  value: unknown;

  /** The user ID if available */
  userId?: string;

  /** The evaluation reason */
  reason?: EvaluationReason;

  /** The variation ID if applicable */
  variationId?: string;

  /** Evaluation latency in milliseconds */
  latencyMs?: number;
}

/**
 * User identification event.
 * Sent when a user is identified or their attributes change.
 */
export interface IdentifyEvent extends BaseAnalyticsEvent {
  kind: "identify";

  /** The user identifier */
  userId: string;

  /** User attributes */
  attributes?: Record<string, unknown>;

  /** User email if provided */
  email?: string;
}

/**
 * Custom analytics event.
 * For tracking custom metrics and conversions.
 */
export interface CustomEvent extends BaseAnalyticsEvent {
  kind: "custom";

  /** Custom event key */
  key: string;

  /** The user ID if available */
  userId?: string;

  /** Event value (for numeric events like revenue) */
  value?: number;

  /** Additional event data */
  data?: Record<string, unknown>;
}

/**
 * Union type of all analytics events.
 */
export type AnalyticsEvent = FeatureEvent | IdentifyEvent | CustomEvent;

/**
 * Payload for sending analytics events to the server.
 */
export interface AnalyticsPayload {
  /** Aggregated evaluation statistics (backward compatible) */
  evaluations?: Record<string, EvaluationStats>;

  /** Detailed analytics events */
  events?: AnalyticsEvent[];

  /** Time period covered by this payload in milliseconds */
  period_ms?: number;
}

/**
 * Aggregated evaluation statistics for a single flag.
 */
export interface EvaluationStats {
  /** Total number of evaluations */
  total: number;

  /** Number of evaluations that returned true */
  true: number;

  /** Number of evaluations that returned false */
  false: number;
}

/**
 * Interface for event buffering and flushing.
 */
export interface EventBuffer {
  /**
   * Add an event to the buffer.
   */
  add(event: AnalyticsEvent): void;

  /**
   * Flush all buffered events to the server.
   */
  flush(): Promise<void>;

  /**
   * Clear all buffered events without sending.
   */
  clear(): void;

  /**
   * Get the current number of buffered events.
   */
  size(): number;
}

/**
 * Create a feature event.
 */
export function createFeatureEvent(
  key: string,
  value: unknown,
  options?: {
    userId?: string;
    reason?: EvaluationReason;
    variationId?: string;
    latencyMs?: number;
  },
): FeatureEvent {
  return {
    kind: "feature",
    key,
    value,
    timestamp: Date.now(),
    ...options,
  };
}

/**
 * Create an identify event.
 */
export function createIdentifyEvent(
  userId: string,
  options?: {
    email?: string;
    attributes?: Record<string, unknown>;
  },
): IdentifyEvent {
  return {
    kind: "identify",
    userId,
    timestamp: Date.now(),
    ...options,
  };
}

/**
 * Create a custom event.
 */
export function createCustomEvent(
  key: string,
  options?: {
    userId?: string;
    value?: number;
    data?: Record<string, unknown>;
  },
): CustomEvent {
  return {
    kind: "custom",
    key,
    timestamp: Date.now(),
    ...options,
  };
}
