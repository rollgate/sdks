## 1.1.0

- Event tracking: `track()` for A/B testing conversion events
- Event batching with automatic flush (30s default, 100 max buffer)
- Manual `flushEvents()` to send pending events immediately

## 1.0.0

- Initial stable release
- Feature flag evaluation with targeting and rollout
- In-memory caching with TTL and stale-while-revalidate
- Circuit breaker and retry with exponential backoff
- Evaluation reasons support
- User context and identify flow
