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
- `flush_events()` to manually send pending events
- `TrackEventOptions` dataclass with `flag_key`, `event_name`, `user_id`, `variation_id`, `value`, `metadata`
- `EventCollectorConfig` for customizing flush interval, buffer size, and enable/disable
- Events re-buffered on flush failure for reliability
- Async event flushing with `asyncio.Task`
- Best-effort final flush on `close()`

## 1.0.0

- Initial stable release
- Feature flag evaluation with user targeting and percentage rollout
- `is_enabled()` and `is_enabled_detail()` with evaluation reasons
- Async client with `httpx` (`async/await`)
- Context manager support (`async with`)
- In-memory caching with TTL, stale-while-revalidate, and optional file persistence
- Circuit breaker with configurable failure threshold and recovery
- Retry with exponential backoff and jitter
- Request deduplication to prevent duplicate concurrent requests
- ETag support for efficient 304 Not Modified responses
- Error classification (`AuthenticationError`, `NetworkError`, `RateLimitError`)
- Event callbacks (`on`, `off`) for `ready`, `flags_updated`, `flag_changed`, `error`
- User context with custom attributes for targeting
- SSE streaming for real-time flag updates
- Polling with configurable interval
