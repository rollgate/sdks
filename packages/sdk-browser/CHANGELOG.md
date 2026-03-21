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

- Event tracking: `track()` method for A/B testing conversion events
- `flush()` to manually flush buffered conversion events
- `getEventStats()` to inspect the event buffer
- Configurable event batching via `events` option (`flushIntervalMs`, `maxBufferSize`)
- Automatic flush on `close()` (best-effort) to avoid losing pending events
- LaunchDarkly-compatible API: `boolVariation()`, `boolVariationDetail()`

## 1.0.0

- Initial stable release
- Feature flag evaluation with server-side targeting
- `createClient()` factory function with auto-initialization
- `waitForInitialization()` with configurable timeout
- `initCanFail` option for graceful degradation
- Evaluation reasons (`OFF`, `TARGET_MATCH`, `RULE_MATCH`, `FALLTHROUGH`, `ERROR`, `UNKNOWN`)
- In-memory caching with TTL and stale-while-revalidate
- Circuit breaker with configurable thresholds
- Retry with exponential backoff and jitter
- Request deduplication
- ETag-based conditional requests (304 Not Modified)
- SSE streaming for real-time flag updates
- Polling with configurable interval
- User context and `identify()` / `reset()` flow
- Typed error hierarchy with category classification
- Metrics collection
