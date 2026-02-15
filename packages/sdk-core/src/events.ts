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

// ─── Conversion Event Tracking (A/B Testing) ────────────────────────

/**
 * Configuration for the EventCollector.
 */
export interface EventCollectorConfig {
  /** API endpoint for event tracking (e.g. https://api.rollgate.io/api/v1/sdk/events) */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Flush interval in milliseconds (default: 30000 = 30 seconds) */
  flushIntervalMs: number;
  /** Maximum events to buffer before forcing a flush (default: 100) */
  maxBufferSize: number;
  /** Enable/disable event tracking (default: true) */
  enabled: boolean;
}

export const DEFAULT_EVENT_COLLECTOR_CONFIG: EventCollectorConfig = {
  endpoint: "",
  apiKey: "",
  flushIntervalMs: 30000,
  maxBufferSize: 100,
  enabled: true,
};

/**
 * Options for tracking a conversion event.
 */
export interface TrackEventOptions {
  /** The flag key this event is associated with */
  flagKey: string;
  /** The event name (e.g., 'purchase', 'signup', 'click') */
  eventName: string;
  /** User ID */
  userId: string;
  /** Variation ID the user was exposed to */
  variationId?: string;
  /** Optional numeric value (e.g., revenue amount) */
  value?: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A single buffered conversion event matching the backend TrackEventItem schema.
 */
interface BufferedConversionEvent {
  flagKey: string;
  eventName: string;
  userId: string;
  variationId?: string;
  value?: number;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

type EventCollectorListener = (...args: unknown[]) => void;

/**
 * EventCollector buffers conversion events and sends them to the server in batches.
 * Used for A/B testing conversion tracking.
 *
 * Works in both Node.js and browser environments (uses global fetch).
 */
export class EventCollector {
  private config: EventCollectorConfig;
  private buffer: BufferedConversionEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushing: boolean = false;
  private listeners: Map<string, Set<EventCollectorListener>> = new Map();

  constructor(config: Partial<EventCollectorConfig> = {}) {
    this.config = { ...DEFAULT_EVENT_COLLECTOR_CONFIG, ...config };
  }

  /** Start the event collector with periodic flushing */
  start(): void {
    if (!this.config.enabled || !this.config.endpoint || !this.config.apiKey) {
      return;
    }

    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.emit("error", err);
      });
    }, this.config.flushIntervalMs);

    // Don't prevent Node.js from exiting
    if (
      this.flushTimer &&
      typeof this.flushTimer === "object" &&
      "unref" in this.flushTimer
    ) {
      (this.flushTimer as { unref: () => void }).unref();
    }
  }

  /** Stop the event collector and flush remaining data */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** Track a conversion event */
  track(options: TrackEventOptions): void {
    if (!this.config.enabled) {
      return;
    }

    if (!options.flagKey || !options.eventName || !options.userId) {
      return;
    }

    const event: BufferedConversionEvent = {
      flagKey: options.flagKey,
      eventName: options.eventName,
      userId: options.userId,
      timestamp: new Date().toISOString(),
    };
    if (options.variationId !== undefined)
      event.variationId = options.variationId;
    if (options.value !== undefined) event.value = options.value;
    if (options.metadata !== undefined) event.metadata = options.metadata;

    this.buffer.push(event);

    if (this.buffer.length >= this.config.maxBufferSize) {
      this.flush().catch((err) => {
        this.emit("error", err);
      });
    }
  }

  /** Flush buffered events to the server */
  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return;
    }

    if (!this.config.endpoint || !this.config.apiKey) {
      return;
    }

    this.isFlushing = true;

    const eventsToSend = [...this.buffer];
    this.buffer = [];

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ events: eventsToSend }),
      });

      if (!response.ok) {
        throw new Error(
          `Event tracking request failed: ${response.status} ${response.statusText}`,
        );
      }

      const result = (await response.json()) as { received: number };
      this.emit("flush", {
        eventsSent: eventsToSend.length,
        received: result.received,
      });
    } catch (error) {
      // Put events back in buffer on failure
      this.buffer = [...eventsToSend, ...this.buffer];
      throw error;
    } finally {
      this.isFlushing = false;
    }
  }

  /** Get current buffer stats */
  getBufferStats(): { eventCount: number } {
    return { eventCount: this.buffer.length };
  }

  /** Update configuration */
  updateConfig(config: Partial<EventCollectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Subscribe to events */
  on(event: string, callback: EventCollectorListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /** Unsubscribe from events */
  off(event: string, callback: EventCollectorListener): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }
}
