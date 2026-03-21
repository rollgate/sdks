# Changelog

## 1.2.3 (2026-03-17)

- Fix: restore V1 flag format compatibility for production API alignment
- Internal test improvements for typed flag format

## 1.2.2 (2026-03-16)

- Fix: update documentation links in README to use absolute URLs
- Fix: update repository URLs from private repo to public `rollgate/sdks`

## 1.2.1 (2026-02-18)

- Fix: align SDK API surface with official documentation

## 1.2.0 (2026-02-17)

- Evaluation stats telemetry: automatic collection of flag evaluation metrics
- Telemetry data sent alongside flag requests for server-side analytics

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
