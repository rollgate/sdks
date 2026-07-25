/**
 * Rollgate provider for the OpenFeature **server** SDK (`@openfeature/server-sdk`).
 *
 * Wraps `@rollgate/sdk-node`, mapping its detailed evaluation API onto the
 * OpenFeature `Provider` contract. Dynamic per-request targeting is supported
 * via the OpenFeature `EvaluationContext` (its `targetingKey` becomes the
 * Rollgate user id), so a single provider instance is safe across tenants.
 */
import {
  OpenFeatureEventEmitter,
  ProviderEvents,
  StandardResolutionReasons,
  TypeMismatchError,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from "@openfeature/server-sdk";
import type { EvaluationDetail } from "@rollgate/sdk-core";
import { RollgateClient, type RollgateConfig } from "@rollgate/sdk-node";
import {
  buildFlagMetadata,
  mapErrorCode,
  mapReason,
  toEvalContext,
} from "./translate";

export type RollgateProviderOptions = RollgateConfig;

type JsType = "boolean" | "string" | "number" | "object";

export class RollgateProvider implements Provider {
  public readonly metadata = {
    name: "rollgate-server-provider",
  } as const;

  public readonly events = new OpenFeatureEventEmitter();

  private readonly client: RollgateClient;
  /** Whether this provider created the client (and must therefore close it). */
  private readonly ownsClient: boolean;
  /** Idempotency guard so repeated initialize() calls don't double-register. */
  private wired = false;

  /**
   * Create a provider that owns and manages its own Rollgate client.
   * @param options Rollgate client configuration (requires `apiKey`).
   */
  constructor(options: RollgateProviderOptions);
  /**
   * Create a provider around an existing, externally managed `RollgateClient`.
   * The provider will NOT close a client it does not own.
   *
   * Note: prefer per-request targeting via the OpenFeature `EvaluationContext`.
   * Do not rely on `client.identify()` on a shared client, or evaluations
   * lacking a `targetingKey` will inherit that identity across tenants.
   */
  constructor(client: RollgateClient);
  constructor(arg: RollgateProviderOptions | RollgateClient) {
    if (arg instanceof RollgateClient) {
      this.client = arg;
      this.ownsClient = false;
    } else {
      this.client = new RollgateClient(arg);
      this.ownsClient = true;
    }
  }

  /** Wrap an existing, externally managed `RollgateClient`. */
  static fromClient(client: RollgateClient): RollgateProvider {
    return new RollgateProvider(client);
  }

  /** Escape hatch for advanced use of the underlying Rollgate client. */
  get rollgateClient(): RollgateClient {
    return this.client;
  }

  async initialize(): Promise<void> {
    this.wireEvents();
    await this.client.init();
  }

  async onClose(): Promise<void> {
    this.unwireEvents();
    if (this.ownsClient) {
      await this.client.close();
    }
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    const detail = this.client.isEnabledDetail(
      flagKey,
      defaultValue,
      toEvalContext(context),
    );
    return this.toResolution(detail, defaultValue, "boolean");
  }

  async resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    return this.resolveValue(flagKey, defaultValue, context, "string");
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    return this.resolveValue(flagKey, defaultValue, context, "number");
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    return this.resolveValue(flagKey, defaultValue, context, "object");
  }

  private resolveValue<T>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
    expected: JsType,
  ): ResolutionDetails<T> {
    const detail = this.client.getValueDetail<T>(
      flagKey,
      defaultValue,
      toEvalContext(context),
    );
    return this.toResolution(detail, defaultValue, expected);
  }

  /**
   * Translate a Rollgate `EvaluationDetail` into OpenFeature `ResolutionDetails`.
   * Throws `TypeMismatchError` when a flag resolved to a value whose runtime
   * type does not match the requested type (OpenFeature then serves the default).
   */
  private toResolution<T>(
    detail: EvaluationDetail<T>,
    defaultValue: T,
    expected: JsType,
  ): ResolutionDetails<T> {
    const { value, reason, variationId } = detail;

    if (reason.kind === "ERROR") {
      return {
        value: defaultValue,
        reason: StandardResolutionReasons.ERROR,
        errorCode: mapErrorCode(reason.errorKind),
        flagMetadata: buildFlagMetadata(reason, variationId),
      };
    }

    // Type guard: only meaningful when the flag actually resolved (non-error).
    // UNKNOWN means the flag was not found and `value` is already the default,
    // so it will match `expected` and skip the mismatch path.
    if (!matchesType(value, expected)) {
      throw new TypeMismatchError(
        `Flag resolved to ${describeType(value)}, expected ${expected}`,
      );
    }

    return {
      value,
      reason: mapReason(reason),
      variant: variationId,
      flagMetadata: buildFlagMetadata(reason, variationId),
    };
  }

  // Stable handler references so they can be removed in onClose().
  private readonly onFlagsUpdated = (): void => this.emitChanged();
  private readonly onFlagChanged = (key: string): void =>
    this.emitChanged([key]);

  /**
   * Forward Rollgate flag updates as OpenFeature configuration-change events.
   * Idempotent: repeated initialize() calls will not stack listeners.
   *
   * Deliberately does NOT forward the client's transient `error` events to
   * `ProviderEvents.Error`: the Rollgate client recovers from fetch failures
   * via cache fallback + retry, so surfacing them would flap the provider into
   * an ERROR state it isn't really in.
   */
  private wireEvents(): void {
    if (this.wired) return;
    this.client.on("flags-updated", this.onFlagsUpdated);
    this.client.on("flag-changed", this.onFlagChanged);
    this.wired = true;
  }

  private unwireEvents(): void {
    if (!this.wired) return;
    this.client.off("flags-updated", this.onFlagsUpdated);
    this.client.off("flag-changed", this.onFlagChanged);
    this.wired = false;
  }

  private emitChanged(flagsChanged?: string[]): void {
    this.events.emit(
      ProviderEvents.ConfigurationChanged,
      flagsChanged ? { flagsChanged } : {},
    );
  }
}

function matchesType(value: unknown, expected: JsType): boolean {
  if (expected === "object") {
    // JsonValue objects and arrays are both `typeof === "object"`. Exclude
    // `null` (also `typeof === "object"`): a flag resolving to null when an
    // object is requested is a mismatch, not a valid structured value.
    return typeof value === "object" && value !== null;
  }
  return typeof value === expected;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
