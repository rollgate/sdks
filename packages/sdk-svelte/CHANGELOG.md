# Changelog

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
