/**
 * Telemetry module for tracking client-side flag evaluations
 * and reporting them to the Rollgate server in batches.
 *
 * This is the shared implementation used by all TypeScript-based SDKs
 * (sdk-node, sdk-browser, sdk-react-native).
 */

export interface TelemetryConfig {
  /** API endpoint for telemetry reporting */
  endpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Flush interval in milliseconds (default: 60000 = 1 minute) */
  flushIntervalMs: number;
  /** Maximum evaluations to buffer before forcing a flush (default: 1000) */
  maxBufferSize: number;
  /** Enable/disable telemetry (default: true) */
  enabled: boolean;
}

export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  endpoint: "",
  apiKey: "",
  flushIntervalMs: 60000, // 1 minute
  maxBufferSize: 1000,
  enabled: true,
};

export interface TelemetryEvaluationStats {
  total: number;
  true: number;
  false: number;
}

export interface TelemetryPayload {
  evaluations: Record<string, TelemetryEvaluationStats>;
  period_ms: number;
}

export interface TelemetryFlushResult {
  flagsReported: number;
  received: number;
  periodMs: number;
}

export interface TelemetryCallbacks {
  onFlush?: (result: TelemetryFlushResult) => void;
  onError?: (error: Error) => void;
}

/**
 * TelemetryCollector tracks flag evaluations and sends them to the server in batches.
 * This is essential for client-side evaluation mode where the server doesn't see
 * individual evaluations.
 */
export class TelemetryCollector {
  private config: TelemetryConfig;
  private callbacks: TelemetryCallbacks;
  private evaluations: Map<string, TelemetryEvaluationStats> = new Map();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private lastFlushTime: number = Date.now();
  private totalBuffered: number = 0;
  private isFlushing: boolean = false;

  constructor(
    config: Partial<TelemetryConfig> = {},
    callbacks: TelemetryCallbacks = {},
  ) {
    this.config = { ...DEFAULT_TELEMETRY_CONFIG, ...config };
    this.callbacks = callbacks;
  }

  /**
   * Start the telemetry collector with periodic flushing
   */
  start(): void {
    if (!this.config.enabled || !this.config.endpoint || !this.config.apiKey) {
      return;
    }

    if (this.flushTimer) {
      return; // Already started
    }

    this.lastFlushTime = Date.now();
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        this.callbacks.onError?.(err as Error);
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

  /**
   * Stop the telemetry collector and flush remaining data
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    await this.flush();
  }

  /**
   * Record a flag evaluation
   */
  recordEvaluation(flagKey: string, result: boolean): void {
    if (!this.config.enabled) {
      return;
    }

    let stats = this.evaluations.get(flagKey);
    if (!stats) {
      stats = { total: 0, true: 0, false: 0 };
      this.evaluations.set(flagKey, stats);
    }

    stats.total++;
    if (result) {
      stats.true++;
    } else {
      stats.false++;
    }

    this.totalBuffered++;

    // Check if we need to flush due to buffer size
    if (this.totalBuffered >= this.config.maxBufferSize) {
      this.flush().catch((err) => {
        this.callbacks.onError?.(err as Error);
      });
    }
  }

  /**
   * Flush buffered evaluations to the server
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.evaluations.size === 0) {
      return;
    }

    if (!this.config.endpoint || !this.config.apiKey) {
      return;
    }

    this.isFlushing = true;

    // Capture current data and reset buffer
    const evaluationsToSend: Record<string, TelemetryEvaluationStats> = {};
    for (const [key, stats] of this.evaluations) {
      evaluationsToSend[key] = { ...stats };
    }

    const periodMs = Date.now() - this.lastFlushTime;
    this.evaluations.clear();
    this.totalBuffered = 0;
    this.lastFlushTime = Date.now();

    const payload: TelemetryPayload = {
      evaluations: evaluationsToSend,
      period_ms: periodMs,
    };

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(
          `Telemetry request failed: ${response.status} ${response.statusText}`,
        );
      }

      const result = (await response.json()) as { received: number };
      this.callbacks.onFlush?.({
        flagsReported: Object.keys(evaluationsToSend).length,
        received: result.received,
        periodMs,
      });
    } catch (error) {
      // Put data back in buffer on failure
      for (const [key, stats] of Object.entries(evaluationsToSend)) {
        const existing = this.evaluations.get(key);
        if (existing) {
          existing.total += stats.total;
          existing.true += stats.true;
          existing.false += stats.false;
        } else {
          this.evaluations.set(key, stats);
        }
        this.totalBuffered += stats.total;
      }
      throw error;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Get current buffer stats (for debugging/monitoring)
   */
  getBufferStats(): { flagCount: number; evaluationCount: number } {
    return {
      flagCount: this.evaluations.size,
      evaluationCount: this.totalBuffered,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TelemetryConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };

    // Restart if configuration changed significantly
    if (
      this.flushTimer &&
      config.flushIntervalMs &&
      config.flushIntervalMs !== this.config.flushIntervalMs
    ) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      this.start();
    }

    // Start if newly enabled
    if (!wasEnabled && this.config.enabled) {
      this.start();
    }

    // Stop if disabled
    if (wasEnabled && !this.config.enabled && this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
