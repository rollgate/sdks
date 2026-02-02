/**
 * React ClientEntity - Wraps React SDK for contract testing
 *
 * Uses RollgateProvider and hooks to execute commands from test harness.
 */
import { useRef, useEffect } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  RollgateProvider,
  useRollgate,
  type RollgateConfig,
  type UserContext,
} from "@rollgate/sdk-react";

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
    timeout: 5000,
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

// Command handler type
type CommandHandler = (params: CommandParams) => Promise<unknown>;

// Global command handler that will be set by the mounted component
let globalCommandHandler: CommandHandler | null = null;

// Store config for identify notifications
let globalBaseUrl: string | undefined;
let globalApiKey: string | undefined;

/**
 * Inner component that has access to Rollgate context
 */
function RollgateCommandHandler({
  tag,
  onReady,
}: {
  tag: string;
  onReady: () => void;
}) {
  const rollgate = useRollgate();
  const readyRef = useRef(false);

  useEffect(() => {
    if (!rollgate.isLoading && !readyRef.current) {
      readyRef.current = true;
      log(`[${tag}] React SDK ready`);
      onReady();
    }
  }, [rollgate.isLoading, tag, onReady]);

  useEffect(() => {
    globalCommandHandler = async (params: CommandParams): Promise<unknown> => {
      log(`[${tag}] Command: ${params.command}`);

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
              if (evalParams.detail && rollgate.client) {
                const detail = rollgate.client.isEnabledDetail(
                  evalParams.flagKey,
                  evalParams.defaultValue as boolean,
                );
                value = detail.value;
                reason = detail.reason;
                variationId = detail.variationId;
              } else {
                value = rollgate.isEnabled(
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
              if (evalParams.detail && rollgate.client) {
                const detail = rollgate.client.isEnabledDetail(
                  evalParams.flagKey,
                  evalParams.defaultValue as boolean,
                );
                value = detail.value;
                reason = detail.reason;
                variationId = detail.variationId;
              } else {
                value = rollgate.isEnabled(
                  evalParams.flagKey,
                  evalParams.defaultValue as boolean,
                );
              }
          }

          log(`[${tag}] evaluate ${evalParams.flagKey} = ${value}${evalParams.detail ? ` (reason: ${JSON.stringify(reason)})` : ""}`);

          if (evalParams.detail) {
            return { value, reason, variationId };
          }
          return { value };
        }

        case CommandType.EvaluateAllFlags:
          return { state: rollgate.flags };

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
              await notifyMockIdentify(
                globalBaseUrl,
                globalApiKey,
                userContext,
              );
            }
            await rollgate.identify(userContext);
          }
          log(`[${tag}] identify: ${JSON.stringify(user)}`);
          return undefined;
        }

        case CommandType.Reset: {
          await rollgate.reset();
          log(`[${tag}] reset`);
          return undefined;
        }

        case CommandType.CustomEvent:
          log(`[${tag}] customEvent (no-op)`);
          return undefined;

        case CommandType.FlushEvents:
          log(`[${tag}] flush (no-op for React SDK)`);
          return undefined;

        default:
          throw badCommandError;
      }
    };

    return () => {
      globalCommandHandler = null;
    };
  }, [rollgate, tag]);

  return null;
}

/**
 * Entity that wraps a React SDK instance
 */
export class ClientEntity {
  private root: Root | null = null;
  private container: HTMLDivElement | null = null;

  constructor(private readonly tag: string) {}

  close(): void {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    globalCommandHandler = null;
    log(`[${this.tag}] Client closed`);
  }

  async doCommand(params: CommandParams): Promise<unknown> {
    if (!globalCommandHandler) {
      throw new Error("React SDK not initialized");
    }
    return globalCommandHandler(params);
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
 * Create a new React SDK client entity from test harness configuration
 */
export async function newSdkClientEntity(
  options: CreateInstanceParams,
): Promise<ClientEntity> {
  const tag = options.tag;
  log(`[${tag}] Creating React client...`);

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

  // Create container for React app
  const container = document.createElement("div");
  container.id = `rollgate-${tag}`;
  document.body.appendChild(container);
  (entity as any).container = container;

  // Create React root and render
  const root = createRoot(container);
  (entity as any).root = root;

  return new Promise((resolve, reject) => {
    const timeout = options.configuration.startWaitTimeMs ?? 5000;
    const timeoutId = setTimeout(() => {
      if (!options.configuration.initCanFail) {
        entity.close();
        reject(new Error("React SDK initialization timeout"));
      } else {
        resolve(entity);
      }
    }, timeout);

    const handleReady = () => {
      clearTimeout(timeoutId);
      log(`[${tag}] React client initialized successfully`);
      resolve(entity);
    };

    root.render(
      <RollgateProvider config={config} user={initialUser}>
        <RollgateCommandHandler tag={tag} onReady={handleReady} />
      </RollgateProvider>,
    );
  });
}
