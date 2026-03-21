# Changelog

## 1.2.3 (2026-03-17)

- Updated sdk-browser dependency to 1.2.3
- Fix: test mocks and SSE init handler updated for V2 format compatibility

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
- `createRollgate()` factory returning Svelte reactive stores
- `setRollgateContext` / `getRollgateContext` for Svelte context API
- `getFlag` helper for single reactive flag store (via context)
- `getFlags` helper for multiple reactive flag stores (via context)
- `getRollgate` helper for full context access
- `isEnabledDetail()` for flag value with evaluation reason
- `flag()` method for derived reactive store of a single flag
- Real-time flag updates via SSE streaming
- Polling mode with configurable refresh interval
- User identification and targeting (`identify`, `reset`)
- Circuit breaker, retry, and caching via sdk-browser
- SvelteKit SSR support (client-side initialization)
- Full TypeScript support
