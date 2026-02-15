# Changelog

## 1.1.0

- Event tracking: `Track()` for A/B testing conversion events
- Event batching with automatic flush (30s default, 100 max buffer)
- Manual `FlushEventsAsync()` to send pending events immediately

## 1.0.0

- Initial stable release
- Feature flag evaluation with targeting and rollout
- In-memory caching with TTL
- Circuit breaker and retry with exponential backoff
- Evaluation reasons
- User context
- SSE streaming for real-time updates
- Request deduplication
- ETag support for efficient polling
