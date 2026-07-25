/**
 * `@rollgate/openfeature-server-provider`
 *
 * OpenFeature server-side provider for Rollgate feature flags.
 *
 * @example
 * ```ts
 * import { OpenFeature } from "@openfeature/server-sdk";
 * import { RollgateProvider } from "@rollgate/openfeature-server-provider";
 *
 * await OpenFeature.setProviderAndWait(
 *   new RollgateProvider({ apiKey: process.env.ROLLGATE_API_KEY! }),
 * );
 *
 * const client = OpenFeature.getClient();
 * const enabled = await client.getBooleanValue("new-checkout", false, {
 *   targetingKey: "user-123",
 *   plan: "pro",
 * });
 * ```
 */
export { RollgateProvider, type RollgateProviderOptions } from "./provider";
export {
  buildFlagMetadata,
  mapErrorCode,
  mapReason,
  toEvalContext,
} from "./translate";
