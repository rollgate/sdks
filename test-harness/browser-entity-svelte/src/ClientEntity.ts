/**
 * Svelte ClientEntity - Wraps Svelte SDK for contract testing
 *
 * Uses createRollgate stores to execute commands from test harness.
 * Svelte stores work without needing actual Svelte components mounted.
 */
import { get } from "svelte/store";
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

/**
 * Entity that wraps a Svelte SDK instance
 */
export class ClientEntity {
  private stores: RollgateStores | null = null;

  constructor(private readonly tag: string) {}

  setStores(stores: RollgateStores): void {
    this.stores = stores;
  }

  close(): void {
    if (this.stores) {
      this.stores.close();
      this.stores = null;
    }
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

        switch (evalParams.valueType) {
          case ValueType.Bool:
            value = this.stores.isEnabled(
              evalParams.flagKey,
              evalParams.defaultValue as boolean,
            );
            break;
          case ValueType.Int:
          case ValueType.Double:
          case ValueType.String:
            // SDK doesn't support these types yet
            value = evalParams.defaultValue;
            break;
          default:
            value = this.stores.isEnabled(
              evalParams.flagKey,
              evalParams.defaultValue as boolean,
            );
        }

        log(`[${this.tag}] evaluate ${evalParams.flagKey} = ${value}`);
        return { value };
      }

      case CommandType.EvaluateAllFlags: {
        const flags = get(this.stores.flags);
        return { state: flags };
      }

      case CommandType.IdentifyEvent: {
        const identifyParams = params.identifyEvent;
        if (!identifyParams) {
          throw malformedCommand;
        }
        const user = identifyParams.user || identifyParams.context;
        if (user) {
          await this.stores.identify({
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

      case CommandType.CustomEvent:
        log(`[${this.tag}] customEvent (no-op)`);
        return undefined;

      case CommandType.FlushEvents:
        log(`[${this.tag}] flush (no-op for Svelte SDK)`);
        return undefined;

      default:
        throw badCommandError;
    }
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
