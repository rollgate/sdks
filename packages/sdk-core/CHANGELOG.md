# Changelog

## 1.1.0

- Event tracking: `EventCollector` class for A/B testing conversion events
- `TrackEventOptions` interface for structured conversion event data
- `EventCollectorConfig` with configurable flush interval and buffer size
- Event batching with automatic flush (30s default, 100 max buffer)
- On-failure retry: events are placed back in the buffer on flush failure
- `EventCollector.on()` / `off()` for subscribing to `flush` and `error` events
- `getBufferStats()` to inspect current buffer state
- `updateConfig()` to modify collector configuration at runtime

## 1.0.0

- Initial stable release
- `FlagCache`: in-memory caching with TTL and stale-while-revalidate
- `CircuitBreaker`: circuit breaker pattern with configurable thresholds
- `fetchWithRetry`: retry with exponential backoff and jitter
- `RequestDeduplicator`: deduplication of concurrent identical requests
- `RollgateError` hierarchy: typed errors with category classification
- `SDKMetrics`: metrics collection with Prometheus export
- `TraceContext`: distributed tracing with W3C Trace Context support
- Evaluation reasons: `offReason`, `targetMatchReason`, `ruleMatchReason`, `fallthroughReason`, `errorReason`, `unknownReason`
- Analytics event types: `FeatureEvent`, `IdentifyEvent`, `CustomEvent`
- `EventBuffer` interface for event buffering and flushing
