/**
 * Vue ClientEntity - Wraps Vue SDK for contract testing
 *
 * Uses provideRollgate and useRollgate to execute commands from test harness.
 */
import { createApp, ref, watch, type App, defineComponent, h } from "vue";
import {
  provideRollgate,
  useRollgate,
  type RollgateConfig,
  type UserContext,
  type RollgateContext,
} from "@rollgate/sdk-vue";

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

// Global context that will be set by the mounted component
let globalContext: RollgateContext | null = null;

// Store config for identify notifications
let globalBaseUrl: string | undefined;
let globalApiKey: string | undefined;

/**
 * Entity that wraps a Vue SDK instance
 */
export class ClientEntity {
  private app: App | null = null;
  private container: HTMLDivElement | null = null;

  constructor(private readonly tag: string) {}

  close(): void {
    if (this.app) {
      this.app.unmount();
      this.app = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    globalContext = null;
    log(`[${this.tag}] Client closed`);
  }

  async doCommand(params: CommandParams): Promise<unknown> {
    if (!globalContext) {
      throw new Error("Vue SDK not initialized");
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
            if (evalParams.detail && globalContext.client) {
              const detail = globalContext.client.isEnabledDetail(
                evalParams.flagKey,
                evalParams.defaultValue as boolean,
              );
              value = detail.value;
              reason = detail.reason;
              variationId = detail.variationId;
            } else {
              value = globalContext.isEnabled(
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
            if (evalParams.detail && globalContext.client) {
              const detail = globalContext.client.isEnabledDetail(
                evalParams.flagKey,
                evalParams.defaultValue as boolean,
              );
              value = detail.value;
              reason = detail.reason;
              variationId = detail.variationId;
            } else {
              value = globalContext.isEnabled(
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

      case CommandType.EvaluateAllFlags:
        return { state: globalContext.flags.value };

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
          await globalContext.identify(userContext);
        }
        log(`[${this.tag}] identify: ${JSON.stringify(user)}`);
        return undefined;
      }

      case CommandType.Reset: {
        await globalContext.reset();
        log(`[${this.tag}] reset`);
        return undefined;
      }

      case CommandType.Track: {
        const trackParams = params.track;
        if (!trackParams) {
          throw malformedCommand;
        }
        globalContext.track({
          flagKey: trackParams.flagKey,
          eventName: trackParams.eventName,
          userId: trackParams.userId,
          variationId: trackParams.variationId,
          value: trackParams.value,
          metadata: trackParams.metadata,
        });
        log(
          `[${this.tag}] track: ${trackParams.eventName} for ${trackParams.flagKey}`,
        );
        return undefined;
      }

      case CommandType.CustomEvent:
        log(`[${this.tag}] customEvent (no-op)`);
        return undefined;

      case CommandType.FlushEvents:
        await globalContext.flush();
        log(`[${this.tag}] flush`);
        return undefined;

      case CommandType.FlushTelemetry:
        await globalContext.client?.flushTelemetry();
        log(`[${this.tag}] flushTelemetry`);
        return undefined;

      case CommandType.GetTelemetryStats: {
        const stats = globalContext.client?.getTelemetryStats() ?? {
          flagCount: 0,
          evaluationCount: 0,
        };
        log(
          `[${this.tag}] getTelemetryStats: ${stats.flagCount} flags, ${stats.evaluationCount} evals`,
        );
        return {
          flagCount: stats.flagCount,
          evaluationCount: stats.evaluationCount,
        };
      }

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
 * Create a new Vue SDK client entity from test harness configuration
 */
export async function newSdkClientEntity(
  options: CreateInstanceParams,
): Promise<ClientEntity> {
  const tag = options.tag;
  log(`[${tag}] Creating Vue client...`);

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

  // Create container for Vue app
  const container = document.createElement("div");
  container.id = `rollgate-${tag}`;
  document.body.appendChild(container);
  (entity as any).container = container;

  return new Promise((resolve, reject) => {
    const timeout = options.configuration.startWaitTimeMs ?? 5000;
    const timeoutId = setTimeout(() => {
      if (!options.configuration.initCanFail) {
        entity.close();
        reject(new Error("Vue SDK initialization timeout"));
      } else {
        resolve(entity);
      }
    }, timeout);

    // Create Vue app with Rollgate provider
    const RollgateWrapper = defineComponent({
      name: "RollgateWrapper",
      setup() {
        const context = provideRollgate(config, initialUser);
        globalContext = context;

        // Watch for ready state
        const stopWatch = watch(
          () => context.isLoading.value,
          (isLoading) => {
            if (!isLoading) {
              clearTimeout(timeoutId);
              log(`[${tag}] Vue client initialized successfully`);
              stopWatch();
              resolve(entity);
            }
          },
          { immediate: true },
        );

        return () => h("div", { id: `rollgate-inner-${tag}` });
      },
    });

    const app = createApp(RollgateWrapper);
    (entity as any).app = app;
    app.mount(container);
  });
}
