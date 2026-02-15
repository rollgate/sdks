/**
 * Svelte ClientEntity - Wraps Svelte SDK for contract testing
 *
 * Uses createRollgate stores to execute commands from test harness.
 * Svelte stores work without needing actual Svelte components mounted.
 */
import {
  createRollgate,
  type RollgateConfig,
  type UserContext,
  type RollgateStores,
} from "@rollgate/sdk-svelte";

import {
  CommandParams,
  CommandType,
  ValueType,
  CreateInstanceParams,
  SDKConfigParams,
  log,
} from "./types";

export const badCommandError = new Error("unsupported command");
export const malformedCommand = new Error("command was malformed");

/**
 * Convert test harness config to SDK options
 */
function makeSdkConfig(options: SDKConfigParams, tag: string): RollgateConfig {
  let baseUrl: string | undefined;
  let sseUrl: string | undefined;
  let streaming = false;

  if (options.serviceEndpoints) {
    baseUrl =
      options.serviceEndpoints.polling || options.serviceEndpoints.streaming;
    sseUrl = options.serviceEndpoints.streaming;
  }

  if (options.polling?.baseUri) {
    baseUrl = options.polling.baseUri;
  }

  if (options.streaming?.baseUri) {
    sseUrl = options.streaming.baseUri;
    streaming = true;
  }

  const config: RollgateConfig = {
    apiKey: options.credential || "unknown-api-key",
    baseUrl,
    sseUrl,
    streaming,
    timeout: options.startWaitTimeMs ?? 5000,
    refreshInterval: options.polling?.pollIntervalMs,
  };

  log(`[${tag}] SDK config: ${JSON.stringify(config)}`);
  return config;
}

/**
 * Create initial user context from config
 */
function makeInitialContext(options: SDKConfigParams): UserContext | undefined {
  const clientSide = options.clientSide;
  if (!clientSide) return undefined;

  const user = clientSide.initialUser || clientSide.initialContext;
  if (!user) return undefined;

  return {
    id: user.id || user.key || "default-user",
    email: user.email,
    attributes: user.attributes as
      | Record<string, string | number | boolean>
      | undefined,
  };
}

// Store config for identify notifications
let globalBaseUrl: string | undefined;
let globalApiKey: string | undefined;

/**
 * Entity that wraps a Svelte SDK instance
 */
export class ClientEntity {
  private stores: RollgateStores | null = null;
  private cachedFlags: Record<string, boolean> = {};
  private unsubFlags: (() => void) | null = null;

  constructor(private readonly tag: string) {}

  setStores(stores: RollgateStores): void {
    this.stores = stores;
    // Persistent subscription avoids get() subscribe/unsubscribe overhead per call
    this.unsubFlags = stores.flags.subscribe((flags) => {
      this.cachedFlags = flags;
    });
  }

  close(): void {
    if (this.unsubFlags) {
      this.unsubFlags();
      this.unsubFlags = null;
    }
    if (this.stores) {
      this.stores.close();
      this.stores = null;
    }
    this.cachedFlags = {};
    log(`[${this.tag}] Client closed`);
  }

  async doCommand(params: CommandParams): Promise<unknown> {
    if (!this.stores) {
      throw new Error("Svelte SDK not initialized");
    }

    log(`[${this.tag}] Command: ${params.command}`);

    switch (params.command) {
      case CommandType.EvaluateFlag: {
        const evalParams = params.evaluate;
        if (!evalParams) {
          throw malformedCommand;
        }

        let value: unknown;
        let reason: unknown;
        let variationId: string | undefined;

        switch (evalParams.valueType) {
          case ValueType.Bool:
            if (evalParams.detail) {
              const detail = this.stores.isEnabledDetail(
                evalParams.flagKey,
                evalParams.defaultValue as boolean,
              );
              value = detail.value;
              reason = detail.reason;
              variationId = detail.variationId;
            } else {
              value = this.stores.isEnabled(
                evalParams.flagKey,
                evalParams.defaultValue as boolean,
              );
            }
            break;
          case ValueType.Int:
          case ValueType.Double:
          case ValueType.String:
            // SDK doesn't support these types yet
            value = evalParams.defaultValue;
            if (evalParams.detail) {
              reason = { kind: "UNKNOWN" };
            }
            break;
          default:
            if (evalParams.detail) {
              const detail = this.stores.isEnabledDetail(
                evalParams.flagKey,
                evalParams.defaultValue as boolean,
              );
              value = detail.value;
              reason = detail.reason;
              variationId = detail.variationId;
            } else {
              value = this.stores.isEnabled(
                evalParams.flagKey,
                evalParams.defaultValue as boolean,
              );
            }
        }

        log(
          `[${this.tag}] evaluate ${evalParams.flagKey} = ${value}${evalParams.detail ? ` (reason: ${JSON.stringify(reason)})` : ""}`,
        );

        if (evalParams.detail) {
          return { value, reason, variationId };
        }
        return { value };
      }

      case CommandType.EvaluateAllFlags: {
        return { state: this.cachedFlags };
      }

      case CommandType.IdentifyEvent: {
        const identifyParams = params.identifyEvent;
        if (!identifyParams) {
          throw malformedCommand;
        }
        const user = identifyParams.user || identifyParams.context;
        if (user) {
          const userContext = {
            id: user.id || user.key || "unknown",
            email: user.email,
            attributes: user.attributes as
              | Record<string, string | number | boolean>
              | undefined,
          };
          // Notify mock server about user context BEFORE SDK identify
          if (globalBaseUrl && globalApiKey) {
            await notifyMockIdentify(globalBaseUrl, globalApiKey, userContext);
          }
          await this.stores.identify(userContext);
        }
        log(`[${this.tag}] identify: ${JSON.stringify(user)}`);
        return undefined;
      }

      case CommandType.Reset: {
        await this.stores.reset();
        log(`[${this.tag}] reset`);
        return undefined;
      }

      case CommandType.Track: {
        const trackParams = params.track;
        if (!trackParams) {
          throw malformedCommand;
        }
        this.stores.track({
          flagKey: trackParams.flagKey,
          eventName: trackParams.eventName,
          userId: trackParams.userId,
          variationId: trackParams.variationId,
          value: trackParams.value,
          metadata: trackParams.metadata,
        });
        log(`[${this.tag}] track: ${trackParams.eventName} for ${trackParams.flagKey}`);
        return undefined;
      }

      case CommandType.CustomEvent:
        log(`[${this.tag}] customEvent (no-op)`);
        return undefined;

      case CommandType.FlushEvents:
        await this.stores.flush();
        log(`[${this.tag}] flush`);
        return undefined;

      default:
        throw badCommandError;
    }
  }
}

/**
 * Notify mock server about user context for remote evaluation.
 * This must be called BEFORE SDK fetches flags so the mock server
 * has user attributes available for rule evaluation.
 */
async function notifyMockIdentify(
  baseUrl: string,
  apiKey: string,
  user: UserContext,
): Promise<void> {
  try {
    await fetch(`${baseUrl}/api/v1/sdk/identify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ user }),
    });
    log(`[identify] Sent user context to mock server: ${user.id}`);
  } catch (e) {
    // Ignore errors - mock might not support identify
    log(`[identify] Failed to notify mock (non-fatal): ${e}`);
  }
}

/**
 * Create a new Svelte SDK client entity from test harness configuration
 */
export async function newSdkClientEntity(
  options: CreateInstanceParams,
): Promise<ClientEntity> {
  const tag = options.tag;
  log(`[${tag}] Creating Svelte client...`);

  const config = makeSdkConfig(options.configuration, tag);
  const initialUser = makeInitialContext(options.configuration);

  // Store config for identify notifications
  globalBaseUrl = config.baseUrl;
  globalApiKey = config.apiKey;

  // Notify mock server about user context BEFORE SDK init (for remote evaluation)
  if (initialUser && config.baseUrl && config.apiKey) {
    await notifyMockIdentify(config.baseUrl, config.apiKey, initialUser);
  }

  const entity = new ClientEntity(tag);

  // Create Svelte stores - these work without mounting components
  const stores = createRollgate(config, initialUser);
  entity.setStores(stores);

  return new Promise((resolve, reject) => {
    const timeout = options.configuration.startWaitTimeMs ?? 5000;
    const timeoutId = setTimeout(() => {
      if (!options.configuration.initCanFail) {
        entity.close();
        reject(new Error("Svelte SDK initialization timeout"));
      } else {
        resolve(entity);
      }
    }, timeout);

    // Subscribe to isReady store
    const unsubscribe = stores.isReady.subscribe((ready) => {
      if (ready) {
        clearTimeout(timeoutId);
        log(`[${tag}] Svelte client initialized successfully`);
        unsubscribe();
        resolve(entity);
      }
    });
  });
}
