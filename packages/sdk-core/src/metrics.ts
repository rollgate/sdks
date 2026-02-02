/**
 * SDK Metrics Collection
 * Tracks request performance, cache efficiency, error rates, and flag evaluations
 */

// Time window durations in milliseconds
const TIME_WINDOWS = {
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
} as const;

export interface MetricsSnapshot {
  // Request metrics
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  errorRate: number;

  // Latency metrics (in milliseconds)
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;

  // Cache metrics
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  notModifiedResponses: number;

  // Error metrics
  errorsByCategory: Record<string, number>;

  // Circuit breaker metrics
  circuitOpens: number;
  circuitCloses: number;
  circuitState: "closed" | "open" | "half-open";

  // Flag evaluation metrics
  flagEvaluations: FlagEvaluationMetrics;

  // Time-windowed metrics
  windows: TimeWindowMetrics;

  // Timing
  uptimeMs: number;
  lastRequestAt: number | null;
}

export interface FlagEvaluationMetrics {
  totalEvaluations: number;
  evaluationsPerFlag: Record<string, FlagStats>;
  avgEvaluationTimeMs: number;
}

export interface FlagStats {
  evaluations: number;
  trueCount: number;
  falseCount: number;
  trueRate: number;
  avgEvaluationTimeMs: number;
}

export interface TimeWindowMetrics {
  "1m": WindowedStats;
  "5m": WindowedStats;
  "15m": WindowedStats;
  "1h": WindowedStats;
}

export interface WindowedStats {
  requests: number;
  errors: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface RequestMetrics {
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  cacheHit: boolean;
  notModified: boolean;
  error?: string;
  errorCategory?: string;
}

export interface FlagEvaluationRecord {
  flagKey: string;
  result: boolean;
  evaluationTimeMs: number;
  timestamp: number;
}

interface TimestampedRequest {
  timestamp: number;
  latencyMs: number;
  success: boolean;
}

interface TimestampedEvaluation {
  flagKey: string;
  result: boolean;
  evaluationTimeMs: number;
  timestamp: number;
}

export class SDKMetrics {
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private notModifiedResponses = 0;
  private circuitOpens = 0;
  private circuitCloses = 0;
  private circuitState: "closed" | "open" | "half-open" = "closed";

  private latencies: number[] = [];
  private maxLatencyHistory = 1000;

  private errorsByCategory: Map<string, number> = new Map();

  // Time-windowed request tracking
  private timestampedRequests: TimestampedRequest[] = [];
  private maxTimestampedRequests = 10000;

  // Flag evaluation tracking
  private flagEvaluations: Map<
    string,
    { count: number; trueCount: number; totalTimeMs: number }
  > = new Map();
  private timestampedEvaluations: TimestampedEvaluation[] = [];
  private maxTimestampedEvaluations = 10000;
  private totalEvaluations = 0;
  private totalEvaluationTimeMs = 0;

  private startTime = Date.now();
  private lastRequestAt: number | null = null;

  // Event listeners for metrics updates
  private listeners: Map<string, Set<(metrics: MetricsSnapshot) => void>> =
    new Map();

  /**
   * Record a completed request
   */
  recordRequest(metrics: RequestMetrics): void {
    const now = Date.now();
    this.totalRequests++;
    this.lastRequestAt = now;

    const success = metrics.statusCode >= 200 && metrics.statusCode < 400;

    if (success) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
    }

    // Track cache metrics
    if (metrics.notModified) {
      this.notModifiedResponses++;
      this.cacheHits++;
    } else if (metrics.cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    // Track latency
    this.latencies.push(metrics.latencyMs);
    if (this.latencies.length > this.maxLatencyHistory) {
      this.latencies.shift();
    }

    // Track timestamped request for time windows
    this.timestampedRequests.push({
      timestamp: now,
      latencyMs: metrics.latencyMs,
      success,
    });
    if (this.timestampedRequests.length > this.maxTimestampedRequests) {
      this.timestampedRequests.shift();
    }

    // Track errors by category
    if (metrics.errorCategory) {
      const current = this.errorsByCategory.get(metrics.errorCategory) || 0;
      this.errorsByCategory.set(metrics.errorCategory, current + 1);
    }

    // Emit update event
    this.emit("request", this.snapshot());
  }

  /**
   * Record a flag evaluation
   */
  recordEvaluation(
    flagKey: string,
    result: boolean,
    evaluationTimeMs: number = 0,
  ): void {
    const now = Date.now();
    this.totalEvaluations++;
    this.totalEvaluationTimeMs += evaluationTimeMs;

    // Update per-flag stats
    const existing = this.flagEvaluations.get(flagKey) || {
      count: 0,
      trueCount: 0,
      totalTimeMs: 0,
    };
    existing.count++;
    if (result) existing.trueCount++;
    existing.totalTimeMs += evaluationTimeMs;
    this.flagEvaluations.set(flagKey, existing);

    // Track timestamped evaluation for time windows
    this.timestampedEvaluations.push({
      flagKey,
      result,
      evaluationTimeMs,
      timestamp: now,
    });
    if (this.timestampedEvaluations.length > this.maxTimestampedEvaluations) {
      this.timestampedEvaluations.shift();
    }

    // Emit update event
    this.emit("evaluation", this.snapshot());
  }

  /**
   * Record a circuit breaker state change
   */
  recordCircuitStateChange(newState: "closed" | "open" | "half-open"): void {
    const oldState = this.circuitState;
    this.circuitState = newState;

    if (newState === "open" && oldState !== "open") {
      this.circuitOpens++;
    } else if (newState === "closed" && oldState !== "closed") {
      this.circuitCloses++;
    }

    this.emit("circuit-change", this.snapshot());
  }

  /**
   * Get current circuit breaker state
   */
  getCircuitState(): "closed" | "open" | "half-open" {
    return this.circuitState;
  }

  /**
   * Subscribe to metrics events
   */
  on(
    event: "request" | "evaluation" | "circuit-change",
    callback: (metrics: MetricsSnapshot) => void,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  /**
   * Unsubscribe from metrics events
   */
  off(
    event: "request" | "evaluation" | "circuit-change",
    callback: (metrics: MetricsSnapshot) => void,
  ): void {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Remove all event listeners (for cleanup)
   */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  private emit(event: string, data: MetricsSnapshot): void {
    this.listeners.get(event)?.forEach((callback) => callback(data));
  }

  /**
   * Get a snapshot of all metrics
   */
  snapshot(): MetricsSnapshot {
    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const totalCacheRequests = this.cacheHits + this.cacheMisses;

    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      successRate:
        this.totalRequests > 0
          ? (this.successfulRequests / this.totalRequests) * 100
          : 0,
      errorRate:
        this.totalRequests > 0
          ? (this.failedRequests / this.totalRequests) * 100
          : 0,

      avgLatencyMs: this.calculateAverage(sortedLatencies),
      minLatencyMs: sortedLatencies.length > 0 ? sortedLatencies[0] : 0,
      maxLatencyMs:
        sortedLatencies.length > 0
          ? sortedLatencies[sortedLatencies.length - 1]
          : 0,
      p50LatencyMs: this.calculatePercentile(sortedLatencies, 50),
      p95LatencyMs: this.calculatePercentile(sortedLatencies, 95),
      p99LatencyMs: this.calculatePercentile(sortedLatencies, 99),

      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate:
        totalCacheRequests > 0
          ? (this.cacheHits / totalCacheRequests) * 100
          : 0,
      notModifiedResponses: this.notModifiedResponses,

      errorsByCategory: Object.fromEntries(this.errorsByCategory),

      circuitOpens: this.circuitOpens,
      circuitCloses: this.circuitCloses,
      circuitState: this.circuitState,

      flagEvaluations: this.getFlagEvaluationMetrics(),
      windows: this.getTimeWindowMetrics(),

      uptimeMs: Date.now() - this.startTime,
      lastRequestAt: this.lastRequestAt,
    };
  }

  /**
   * Get flag evaluation metrics
   */
  private getFlagEvaluationMetrics(): FlagEvaluationMetrics {
    const evaluationsPerFlag: Record<string, FlagStats> = {};

    for (const [flagKey, stats] of this.flagEvaluations.entries()) {
      evaluationsPerFlag[flagKey] = {
        evaluations: stats.count,
        trueCount: stats.trueCount,
        falseCount: stats.count - stats.trueCount,
        trueRate: stats.count > 0 ? (stats.trueCount / stats.count) * 100 : 0,
        avgEvaluationTimeMs:
          stats.count > 0 ? stats.totalTimeMs / stats.count : 0,
      };
    }

    return {
      totalEvaluations: this.totalEvaluations,
      evaluationsPerFlag,
      avgEvaluationTimeMs:
        this.totalEvaluations > 0
          ? this.totalEvaluationTimeMs / this.totalEvaluations
          : 0,
    };
  }

  /**
   * Get time-windowed metrics
   */
  private getTimeWindowMetrics(): TimeWindowMetrics {
    const now = Date.now();

    const result: TimeWindowMetrics = {
      "1m": this.calculateWindowStats(now, TIME_WINDOWS["1m"]),
      "5m": this.calculateWindowStats(now, TIME_WINDOWS["5m"]),
      "15m": this.calculateWindowStats(now, TIME_WINDOWS["15m"]),
      "1h": this.calculateWindowStats(now, TIME_WINDOWS["1h"]),
    };

    return result;
  }

  private calculateWindowStats(now: number, windowMs: number): WindowedStats {
    const cutoff = now - windowMs;
    const windowRequests = this.timestampedRequests.filter(
      (r) => r.timestamp >= cutoff,
    );

    const requests = windowRequests.length;
    const errors = windowRequests.filter((r) => !r.success).length;
    const totalLatency = windowRequests.reduce(
      (sum, r) => sum + r.latencyMs,
      0,
    );

    return {
      requests,
      errors,
      avgLatencyMs: requests > 0 ? totalLatency / requests : 0,
      errorRate: requests > 0 ? (errors / requests) * 100 : 0,
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  toPrometheus(prefix: string = "rollgate_sdk"): string {
    const snap = this.snapshot();
    const lines: string[] = [];

    // Helper to format metric
    const metric = (
      name: string,
      value: number,
      help?: string,
      type?: string,
    ) => {
      const fullName = `${prefix}_${name}`;
      if (help) lines.push(`# HELP ${fullName} ${help}`);
      if (type) lines.push(`# TYPE ${fullName} ${type}`);
      lines.push(`${fullName} ${value}`);
    };

    // Request metrics
    metric(
      "requests_total",
      snap.totalRequests,
      "Total number of requests",
      "counter",
    );
    metric(
      "requests_success_total",
      snap.successfulRequests,
      "Total successful requests",
      "counter",
    );
    metric(
      "requests_failed_total",
      snap.failedRequests,
      "Total failed requests",
      "counter",
    );

    // Latency metrics
    metric(
      "latency_avg_ms",
      snap.avgLatencyMs,
      "Average request latency in milliseconds",
      "gauge",
    );
    metric(
      "latency_p50_ms",
      snap.p50LatencyMs,
      "50th percentile latency",
      "gauge",
    );
    metric(
      "latency_p95_ms",
      snap.p95LatencyMs,
      "95th percentile latency",
      "gauge",
    );
    metric(
      "latency_p99_ms",
      snap.p99LatencyMs,
      "99th percentile latency",
      "gauge",
    );

    // Cache metrics
    metric("cache_hits_total", snap.cacheHits, "Total cache hits", "counter");
    metric(
      "cache_misses_total",
      snap.cacheMisses,
      "Total cache misses",
      "counter",
    );
    metric(
      "cache_hit_rate",
      snap.cacheHitRate,
      "Cache hit rate percentage",
      "gauge",
    );

    // Circuit breaker metrics
    metric(
      "circuit_opens_total",
      snap.circuitOpens,
      "Total circuit breaker opens",
      "counter",
    );
    metric(
      "circuit_state",
      snap.circuitState === "closed"
        ? 0
        : snap.circuitState === "open"
          ? 1
          : 0.5,
      "Circuit breaker state (0=closed, 0.5=half-open, 1=open)",
      "gauge",
    );

    // Flag evaluation metrics
    metric(
      "evaluations_total",
      snap.flagEvaluations.totalEvaluations,
      "Total flag evaluations",
      "counter",
    );
    metric(
      "evaluation_avg_time_ms",
      snap.flagEvaluations.avgEvaluationTimeMs,
      "Average evaluation time in milliseconds",
      "gauge",
    );

    // Uptime
    metric(
      "uptime_seconds",
      snap.uptimeMs / 1000,
      "SDK uptime in seconds",
      "gauge",
    );

    return lines.join("\n");
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.notModifiedResponses = 0;
    this.circuitOpens = 0;
    this.circuitCloses = 0;
    this.circuitState = "closed";
    this.latencies = [];
    this.errorsByCategory.clear();
    this.timestampedRequests = [];
    this.flagEvaluations.clear();
    this.timestampedEvaluations = [];
    this.totalEvaluations = 0;
    this.totalEvaluationTimeMs = 0;
    this.startTime = Date.now();
    this.lastRequestAt = null;
  }

  private calculateAverage(sortedValues: number[]): number {
    if (sortedValues.length === 0) return 0;
    const sum = sortedValues.reduce((a, b) => a + b, 0);
    return sum / sortedValues.length;
  }

  private calculatePercentile(
    sortedValues: number[],
    percentile: number,
  ): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }
}

// Default global instance
let globalMetrics: SDKMetrics | null = null;

/**
 * Get or create the global metrics instance
 */
export function getMetrics(): SDKMetrics {
  if (!globalMetrics) {
    globalMetrics = new SDKMetrics();
  }
  return globalMetrics;
}

/**
 * Create a new metrics instance (useful for testing)
 */
export function createMetrics(): SDKMetrics {
  return new SDKMetrics();
}
