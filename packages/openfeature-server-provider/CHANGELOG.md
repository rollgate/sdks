# Changelog

All notable changes to `@rollgate/openfeature-server-provider` are documented here.

## 0.1.0

Initial release.

- OpenFeature server-side `Provider` implementation wrapping `@rollgate/sdk-node`.
- Supports boolean, string, number, and object (JSON) evaluation.
- Per-request targeting via `EvaluationContext` (`targetingKey` → Rollgate `userId`, flat primitive attributes forwarded; `Date` serialized to ISO, nested values dropped).
- Reason and error-code mapping to OpenFeature standards; `variant` + `flagMetadata` (`variationId`, `ruleId`, `inExperiment`) exposed.
- `TYPE_MISMATCH` when a flag resolves to an unexpected runtime type.
- Lifecycle: `initialize()` starts the client, `onClose()` closes it (only when the provider owns the client; `RollgateProvider.fromClient` injects an externally managed one).
- Flag updates forwarded as `ProviderEvents.ConfigurationChanged`.
