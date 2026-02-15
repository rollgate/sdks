# Changelog

## 1.1.0

- Event tracking: `track()` for A/B testing conversion events
- Event batching with automatic flush (30s default, 100 max buffer)
- Manual `flush()` to send pending events immediately
- Re-export `TrackEventOptions` type from sdk-browser

## 1.0.0

- Initial stable release
- `RollgateProvider` component for React Context
- `useFlag` hook for single flag evaluation
- `useFlags` hook for multiple flags evaluation
- `useFlagDetail` hook for flag value with evaluation reason
- `useRollgate` hook for full context access (identify, reset, refresh, metrics)
- `useMetrics` hook for SDK metrics
- `Feature` component for declarative conditional rendering
- Real-time flag updates via SSE streaming
- Polling mode with configurable refresh interval
- User identification and targeting
- Circuit breaker, retry, and caching via sdk-browser
- Full TypeScript support
