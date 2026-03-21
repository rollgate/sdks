# Changelog

## 1.2.3 (2026-03-17)

- Updated sdk-core dependency to 1.2.3

## 1.2.2 (2026-03-16)

- Fix: update documentation links in README to use absolute URLs
- Fix: update repository URLs from private repo to public `rollgate/sdks`

## 1.2.1 (2026-02-18)

- Fix: align SDK API surface with official documentation

## 1.2.0 (2026-02-17)

- Evaluation stats telemetry via sdk-core dependency update

## 1.1.0

- Event tracking: `track()` for A/B testing conversion events (via `useRollgate` hook or client)
- `flush()` to manually send pending events
- `TrackEventOptions` type with `flagKey`, `eventName`, `userId`, `variationId`, `value`, `metadata`
- `EventCollectorConfig` for customizing flush interval and buffer size via provider config
- Event collector powered by `@rollgate/sdk-core` `EventCollector`
- `track` exposed in `RollgateContext` for hook-based usage
- Best-effort final flush on `close()`

## 1.0.0

- Initial stable release
- `RollgateProvider` component with React Context
- Hooks: `useFlag`, `useFlagDetail`, `useFlags`, `useStringFlag`, `useNumberFlag`, `useJSONFlag`
- `useRollgate` hook for full context access (identify, reset, refresh, flags)
- `useMetrics` hook for SDK metrics
- `Feature` component for declarative flag-gated rendering
- Feature flag evaluation with user targeting and percentage rollout
- Offline support via AsyncStorage persistence
- In-memory caching with TTL and stale-while-revalidate
- Circuit breaker with configurable failure threshold and recovery
- Retry with exponential backoff and jitter
- Request deduplication to prevent duplicate concurrent requests
- ETag support for efficient 304 Not Modified responses
- Error classification (Network, Auth, RateLimit)
- Polling with configurable interval
- User context with custom attributes for targeting
- Powered by `@rollgate/sdk-core` shared utilities
