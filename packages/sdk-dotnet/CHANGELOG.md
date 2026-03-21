# Changelog

## 1.2.3 (2026-03-17)

- Fix: restore V1 flag format compatibility for production API alignment
- Fix: restore corrupted csproj file

## 1.2.2 (2026-03-16)

- Fix: update documentation links in README to use absolute URLs
- Fix: update repository URLs from private repo to public `rollgate/sdks`

## 1.2.1 (2026-02-18)

- Fix: align SDK API surface with official documentation

## 1.2.0 (2026-02-17)

- Evaluation stats telemetry: automatic collection of flag evaluation metrics
- Telemetry data sent alongside flag requests for server-side analytics

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
