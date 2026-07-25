# @rollgate/openfeature-server-provider

[OpenFeature](https://openfeature.dev) **server-side** provider for [Rollgate](https://rollgate.io) feature flags. Wraps [`@rollgate/sdk-node`](https://www.npmjs.com/package/@rollgate/sdk-node) so you can evaluate Rollgate flags through the vendor-neutral OpenFeature API.

## Install

```bash
npm install @openfeature/server-sdk @rollgate/openfeature-server-provider
```

`@openfeature/server-sdk` is a peer dependency.

## Usage

```ts
import { OpenFeature } from "@openfeature/server-sdk";
import { RollgateProvider } from "@rollgate/openfeature-server-provider";

// Provider owns the Rollgate client and initializes it on registration.
await OpenFeature.setProviderAndWait(
  new RollgateProvider({ apiKey: process.env.ROLLGATE_API_KEY! }),
);

const client = OpenFeature.getClient();

const enabled = await client.getBooleanValue("new-checkout", false, {
  targetingKey: "user-123",
  plan: "pro",
});
```

### Bring your own client

If you already manage a `RollgateClient` (e.g. shared across your app), inject it — the provider will **not** close a client it does not own:

```ts
import { RollgateClient } from "@rollgate/sdk-node";
import { RollgateProvider } from "@rollgate/openfeature-server-provider";

const rollgate = new RollgateClient({ apiKey: process.env.ROLLGATE_API_KEY! });
await rollgate.init();

await OpenFeature.setProviderAndWait(RollgateProvider.fromClient(rollgate));
```

## Targeting

The OpenFeature `EvaluationContext` maps to Rollgate as follows:

| OpenFeature                                         | Rollgate                                         |
| --------------------------------------------------- | ------------------------------------------------ |
| `targetingKey`                                      | `userId`                                         |
| other flat attributes (`string`/`number`/`boolean`) | `attributes`                                     |
| `Date` attributes                                   | ISO-8601 string                                  |
| nested objects / arrays                             | dropped (targeting matches flat attributes only) |

## Value types & reasons

All four evaluation types are supported: `boolean`, `string`, `number`, and `object` (JSON). A flag that resolves to a value whose runtime type differs from the requested type yields OpenFeature's `TYPE_MISMATCH` error and serves your default.

Rollgate reasons map to OpenFeature standard reasons:

| Rollgate                     | OpenFeature                    |
| ---------------------------- | ------------------------------ |
| `OFF`                        | `DISABLED`                     |
| `TARGET_MATCH`, `RULE_MATCH` | `TARGETING_MATCH`              |
| `FALLTHROUGH`                | `DEFAULT`                      |
| `ERROR`                      | `ERROR` (+ mapped `errorCode`) |
| `UNKNOWN`                    | `UNKNOWN`                      |

The selected `variationId` is exposed as `variant`; `variationId`, `ruleId`, and `inExperiment` are attached to `flagMetadata`.

## Events

Rollgate flag updates are forwarded as `ProviderEvents.ConfigurationChanged`. Transient client fetch errors are intentionally **not** forwarded (the Rollgate client recovers via cache fallback + retry), so the provider does not flap into an `ERROR` state.

## Scope

This is the **server** provider. For client-side/browser usage via `@openfeature/web-sdk`, a separate web provider is planned.

## License

MIT
