# Changelog

## 1.2.3 (2026-03-17)

- Updated sdk-browser dependency to 1.2.3

## 1.2.2 (2026-03-16)

- Fix: update documentation links in README to use absolute URLs
- Fix: update repository URLs from private repo to public `rollgate/sdks`

## 1.2.1 (2026-02-18)

- Fix: align SDK API surface with official documentation

## 1.2.0 (2026-02-17)

- Evaluation stats telemetry via sdk-browser dependency update

## 1.1.0

- Event tracking: `track()` for A/B testing conversion events
- Event batching with automatic flush (30s default, 100 max buffer)
- Manual `flush()` to send pending events immediately
- Re-export `TrackEventOptions` type from sdk-browser

## 1.0.0

- Initial stable release
- `RollgatePlugin` for Vue app integration
- `provideRollgate` / `injectRollgate` for Composition API setup
- `useFlag` composable for single flag evaluation (reactive computed ref)
- `useFlagDetail` composable for flag value with evaluation reason
- `useFlags` composable for multiple flags evaluation
- `useRollgate` composable for full context access (identify, reset, refresh, metrics)
- Real-time flag updates via SSE streaming
- Polling mode with configurable refresh interval
- User identification and targeting
- Circuit breaker, retry, and caching via sdk-browser
- Nuxt 3 SSR support (client-side plugin)
- Full TypeScript support
