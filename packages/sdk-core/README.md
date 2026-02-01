# @rollgate/sdk-core

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Internal core utilities for Rollgate TypeScript SDKs.

> **Note**: This is an internal package. Do not use directly. Use `@rollgate/sdk-node` for server-side or `@rollgate/sdk-browser` for client-side applications.

## Purpose

This package provides shared utilities used by all Rollgate TypeScript SDKs:

- **Types & Interfaces**: Common type definitions for flags, users, and configuration
- **HTTP Client**: Base HTTP client with retry logic and circuit breaker
- **Event Emitter**: Type-safe event system for SDK events
- **Cache Utilities**: Flag caching with ETag support
- **Error Types**: Standardized error handling across SDKs
- **Evaluation Logic**: Flag evaluation with operators and targeting rules

## Architecture

```
sdk-core (this package)
    │
    ├── sdk-node (server-side)
    │
    └── sdk-browser (client-side)
            │
            ├── sdk-react
            ├── sdk-vue
            ├── sdk-angular
            └── sdk-svelte
```

## Exports

| Module      | Description                          |
| ----------- | ------------------------------------ |
| `types`     | TypeScript interfaces and types      |
| `errors`    | RollgateError and error categories   |
| `http`      | HTTP client with retry/circuit       |
| `cache`     | In-memory and persistent caching     |
| `evaluate`  | Flag evaluation engine               |
| `events`    | Type-safe event emitter              |
| `retry`     | Retry logic with exponential backoff |

## For SDK Developers

If you're building a new Rollgate SDK wrapper:

```typescript
import {
  RollgateConfig,
  User,
  Flags,
  RollgateError,
  ErrorCategory,
} from "@rollgate/sdk-core";
```

## License

MIT
