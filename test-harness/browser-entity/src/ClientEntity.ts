/**
 * ClientEntity - Wraps RollgateBrowserClient for contract testing
 *
 * Based on LaunchDarkly's ClientEntity implementation.
 * Translates test harness commands into SDK method calls.
 */

import {
  createClient,
  RollgateBrowserClient,
  type RollgateOptions,
  type UserContext,
} from "@rollgate/sdk-browser";

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
function makeSdkConfig(options: SDKConfigParams, tag: string): RollgateOptions {
  const config: RollgateOptions = {
    timeout: 5000,
    startWaitTimeMs: options.startWaitTimeMs ?? 5000,
    initCanFail: options.initCanFail ?? false,
  };

  // Service endpoints
  if (options.serviceEndpoints) {
    config.baseUrl =
      options.serviceEndpoints.polling || options.serviceEndpoints.streaming;
    config.sseUrl = options.serviceEndpoints.streaming;
  }

  // Polling config
  if (options.polling) {
    if (options.polling.baseUri) {
      config.baseUrl = options.polling.baseUri;
    }
    if (options.polling.pollIntervalMs) {
      config.refreshInterval = options.polling.pollIntervalMs;
    }
  }

  // Streaming config
  if (options.streaming) {
    if (options.streaming.baseUri) {
      config.sseUrl = options.streaming.baseUri;
    }
    config.streaming = true;
  }

  log(`[${tag}] SDK config: ${JSON.stringify(config)}`);
  return config;
}

/**
 * Create initial user context from config
 */
function makeInitialContext(options: SDKConfigParams): UserContext | null {
  const clientSide = options.clientSide;
  if (!clientSide) return null;

  const user = clientSide.initialUser || clientSide.initialContext;
  if (!user) return null;

  return {
    id: user.id || user.key || "default-user",
    email: user.email,
    attributes: user.attributes as
      | Record<string, string | number | boolean>
      | undefined,
  };
}

/**
 * Entity that wraps an SDK client instance
 */
export class ClientEntity {
  constructor(
    private readonly client: RollgateBrowserClient,
    private readonly tag: string,
  ) {}

  close(): void {
    this.client.close();
    log(`[${this.tag}] Client closed`);
  }

  async doCommand(params: CommandParams): Promise<unknown> {
    log(`[${this.tag}] Command: ${params.command}`);

    switch (params.command) {
      case CommandType.EvaluateFlag: {
        const evalParams = params.evaluate;
        if (!evalParams) {
          throw malformedCommand;
        }

        let value: unknown;

        switch (evalParams.valueType) {
          case ValueType.Bool:
            value = this.client.isEnabled(
              evalParams.flagKey,
              evalParams.defaultValue as boolean,
            );
            break;
          case ValueType.Int:
          case ValueType.Double:
            // SDK doesn't support number flags yet, return default
            value = evalParams.defaultValue;
            break;
          case ValueType.String:
            // SDK doesn't support string flags yet, return default
            value = evalParams.defaultValue;
            break;
          default:
            value = this.client.isEnabled(
              evalParams.flagKey,
              evalParams.defaultValue as boolean,
            );
        }

        log(`[${this.tag}] evaluate ${evalParams.flagKey} = ${value}`);
        return { value };
      }

      case CommandType.EvaluateAllFlags:
        return { state: this.client.allFlags() };

      case CommandType.IdentifyEvent: {
        const identifyParams = params.identifyEvent;
        if (!identifyParams) {
          throw malformedCommand;
        }
        const user = identifyParams.user || identifyParams.context;
        if (user) {
          await this.client.identify({
            id: user.id || user.key || "unknown",
            email: user.email,
            attributes: user.attributes as
              | Record<string, string | number | boolean>
              | undefined,
          });
        }
        log(`[${this.tag}] identify: ${JSON.stringify(user)}`);
        return undefined;
      }

      case CommandType.CustomEvent: {
        // SDK doesn't support custom events yet
        log(`[${this.tag}] customEvent (no-op)`);
        return undefined;
      }

      case CommandType.FlushEvents:
        this.client.flush();
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
 * Create a new SDK client entity from test harness configuration
 */
export async function newSdkClientEntity(
  options: CreateInstanceParams,
): Promise<ClientEntity> {
  const tag = options.tag;
  log(`[${tag}] Creating client...`);

  const timeout = options.configuration.startWaitTimeMs ?? 5000;
  const sdkConfig = makeSdkConfig(options.configuration, tag);
  const initialContext = makeInitialContext(options.configuration);
  const apiKey = options.configuration.credential || "unknown-api-key";

  // Notify mock server about user context BEFORE SDK init (for remote evaluation)
  if (initialContext && sdkConfig.baseUrl) {
    await notifyMockIdentify(sdkConfig.baseUrl, apiKey, initialContext);
  }

  const client = createClient(apiKey, initialContext, sdkConfig);

  let failed = false;
  try {
    await client.waitForInitialization(timeout);
    log(`[${tag}] Client initialized successfully`);
  } catch (error) {
    log(`[${tag}] Client initialization failed: ${error}`);
    failed = true;
  }

  if (failed && !options.configuration.initCanFail) {
    client.close();
    throw new Error("client initialization failed");
  }

  return new ClientEntity(client, tag);
}
