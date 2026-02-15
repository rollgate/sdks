# Changelog

## 1.1.0

- Event tracking: `Track()` for A/B testing conversion events
- Event batching with automatic flush (30s default, 100 max buffer)
- `FlushEvents()` to manually send pending events
- `EventCollectorConfig` for customizing flush interval, buffer size, and enable/disable
- Events re-buffered on flush failure for reliability
- Thread-safe event buffering with goroutine-based flush loop
- Best-effort final flush on `Close()`

## 1.0.0

- Initial stable release
- Feature flag evaluation with user targeting and percentage rollout
- `IsEnabled()` and `IsEnabledDetail()` with evaluation reasons
- In-memory caching with TTL and stale-while-revalidate
- Circuit breaker with configurable failure threshold and recovery
- Retry with exponential backoff and jitter
- Request deduplication to prevent duplicate concurrent requests
- ETag support for efficient 304 Not Modified responses
- Error classification (Network, Auth, RateLimit, Server)
- User context with custom attributes for targeting
- SDK metrics: request latency, success rates, cache hit rates
- SSE streaming for real-time flag updates
- Configurable logger
- Full thread safety
