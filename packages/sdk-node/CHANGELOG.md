# Changelog

## 1.1.0

- Event tracking: `track()` method for A/B testing conversion events
- `flushEvents()` to manually flush buffered conversion events
- `getEventStats()` to inspect the event buffer
- Configurable event batching via `events` option (`flushIntervalMs`, `maxBufferSize`)
- Automatic flush on `close()` to avoid losing pending events
- `events-flush` and `events-error` client events for monitoring event delivery
- Typed values: `getValue()`, `getString()`, `getNumber()`, `getJSON()` for non-boolean flags
- `getValueDetail()` for typed values with evaluation reasons
- `isClientSideEvaluation()` and `getRulesVersion()` for debugging

## 1.0.0

- Initial stable release
- Feature flag evaluation with targeting rules and rollout percentages
- Client-side evaluation with SSE-streamed rules
- Server-side evaluation with polling
- In-memory caching with TTL and stale-while-revalidate
- Circuit breaker with configurable thresholds
- Retry with exponential backoff and jitter
- Request deduplication
- ETag-based conditional requests (304 Not Modified)
- Evaluation reasons (`OFF`, `TARGET_MATCH`, `RULE_MATCH`, `FALLTHROUGH`, `ERROR`, `UNKNOWN`)
- User context and `identify()` / `reset()` flow
- Telemetry collector for client-side evaluation analytics
- Metrics collection with Prometheus export
- Distributed tracing with W3C Trace Context
- Typed error hierarchy with category classification
