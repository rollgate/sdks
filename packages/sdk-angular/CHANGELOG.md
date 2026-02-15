# Changelog

## 1.1.0

- Event tracking: `track()` for A/B testing conversion events
- Event batching with automatic flush (30s default, 100 max buffer)
- Manual `flush()` to send pending events immediately
- Re-export `TrackEventOptions` type from sdk-browser

## 1.0.0

- Initial stable release
- `RollgateModule` with `forRoot()` for NgModule-based apps
- `ROLLGATE_CONFIG` injection token for standalone components (Angular 17+)
- `RollgateService` injectable service with synchronous and observable APIs
- `FeatureDirective` (`*rollgateFeature`) for structural conditional rendering with else template support
- Reactive observables: `flags$`, `isReady$`, `isLoading$`, `isError$`, `isStale$`, `circuitState$`
- Synchronous accessors: `isEnabled()`, `isEnabledDetail()`, `flags`, `isLoading`, `isError`, `isStale`, `circuitState`, `isReady`
- User identification and targeting (`identify`, `reset`)
- Real-time flag updates via SSE streaming
- Polling mode with configurable refresh interval
- Circuit breaker, retry, and caching via sdk-browser
- Full TypeScript support
