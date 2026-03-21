# Changelog

## 1.2.3 (2026-03-17)

- Fix: restore V1 flag format compatibility for production API alignment

## 1.2.2 (2026-03-16)

- Fix: update documentation links in README to use absolute URLs
- Fix: update repository URLs from private repo to public `rollgate/sdks`

## 1.2.1 (2026-02-18)

- Fix: align SDK API surface with official documentation

## 1.2.0 (2026-02-17)

- Evaluation stats telemetry: automatic collection of flag evaluation metrics
- Telemetry data sent alongside flag requests for server-side analytics

## 1.1.0

- Event tracking: `track()` for A/B testing conversion events
- Event batching with automatic flush (30s default, 100 max buffer)
- `flushEvents()` to manually send pending events
- `EventCollector.TrackEventOptions` with fluent builder: `.variationId()`, `.value()`, `.metadata()`
- Configurable flush interval and buffer size via `EventCollector` constructor
- Events re-buffered on flush failure for reliability
- Thread-safe event buffering with `ScheduledExecutorService`
- Daemon thread for background flushing (does not prevent JVM shutdown)
- Best-effort final flush on `close()`

## 1.0.0

- Initial stable release
- Feature flag evaluation with user targeting and percentage rollout
- `isEnabled()` and `isEnabledDetail()` with evaluation reasons
- `UserContext` builder pattern with custom attributes
- In-memory caching with TTL and stale-while-revalidate
- Circuit breaker with configurable failure threshold and recovery
- Retry with exponential backoff and jitter
- Request deduplication to prevent duplicate concurrent requests
- ETag support for efficient 304 Not Modified responses
- SSE streaming for real-time flag updates
- `AutoCloseable` support (try-with-resources)
- Full thread safety
