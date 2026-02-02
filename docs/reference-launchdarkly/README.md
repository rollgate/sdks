# LaunchDarkly Reference Implementation

> **Note**: This is reference code from LaunchDarkly, kept for historical purposes. It is **not part of the Rollgate SDK**.

This folder contains reference code from LaunchDarkly's browser SDK contract tests that was used as inspiration when implementing Rollgate's contract test infrastructure.

**Original Source**: [launchdarkly/js-core](https://github.com/launchdarkly/js-core/tree/main/packages/sdk/browser/contract-tests)

## Files

| File                      | Purpose                          |
| ------------------------- | -------------------------------- |
| `adapter-index.ts`        | Reference adapter implementation |
| `ClientEntity.ts`         | Reference entity implementation  |
| `TestHarnessWebSocket.ts` | WebSocket communication pattern  |
| `CommandParams.ts`        | Command parameter types          |
| `ConfigParams.ts`         | Configuration types              |
| `entity-main.ts`          | Entity entry point               |
| `*-package.json`          | Reference package configurations |

## Rollgate Implementations

The actual Rollgate implementations are in:

| Component      | Location                               | Purpose                  |
| -------------- | -------------------------------------- | ------------------------ |
| Adapter        | `test-harness/browser-adapter/`        | HTTP to WebSocket bridge |
| Browser Entity | `test-harness/browser-entity/`         | sdk-browser test entity  |
| React Entity   | `test-harness/browser-entity-react/`   | sdk-react test entity    |
| Vue Entity     | `test-harness/browser-entity-vue/`     | sdk-vue test entity      |
| Svelte Entity  | `test-harness/browser-entity-svelte/`  | sdk-svelte test entity   |
| Angular Entity | `test-harness/browser-entity-angular/` | sdk-angular test entity  |

## Architecture Differences

| Aspect         | LaunchDarkly          | Rollgate                     |
| -------------- | --------------------- | ---------------------------- |
| Adapter Port   | 8000                  | 8010                         |
| WebSocket Port | 8001                  | 8011                         |
| Test Harness   | Go (sdk-test-harness) | Go (custom, integrated)      |
| Dashboard      | None                  | Real-time dashboard on :8080 |
