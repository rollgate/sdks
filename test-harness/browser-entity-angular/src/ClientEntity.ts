/**
 * Angular ClientEntity - Wraps Angular SDK for contract testing
 *
 * Uses RollgateService to execute commands from test harness.
 * Creates a minimal Angular app with dependency injection.
 */
import "zone.js";
import {
  Component,
  NgModule,
  Injector,
  createComponent,
  ApplicationRef,
  EnvironmentInjector,
} from "@angular/core";
import { BrowserModule, platformBrowser } from "@angular/platform-browser";
import { firstValueFrom, filter, take } from "rxjs";
import {
  RollgateModule,
  RollgateService,
  ROLLGATE_CONFIG,
  type RollgateConfig,
  type UserContext,
} from "@rollgate/sdk-angular";

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
 * Entity that wraps an Angular SDK instance
 */
export class ClientEntity {
  private service: RollgateService | null = null;
  private appRef: ApplicationRef | null = null;

  constructor(private readonly tag: string) {}

  setService(service: RollgateService): void {
    this.service = service;
  }

  setAppRef(appRef: ApplicationRef): void {
    this.appRef = appRef;
  }

  close(): void {
    if (this.appRef) {
      this.appRef.destroy();
      this.appRef = null;
    }
    this.service = null;
    log(`[${this.tag}] Client closed`);
  }

  async doCommand(params: CommandParams): Promise<unknown> {
    if (!this.service) {
      throw new Error("Angular SDK not initialized");
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
            value = this.service.isEnabled(
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
            value = this.service.isEnabled(
              evalParams.flagKey,
              evalParams.defaultValue as boolean,
            );
        }

        log(`[${this.tag}] evaluate ${evalParams.flagKey} = ${value}`);
        return { value };
      }

      case CommandType.EvaluateAllFlags:
        return { state: this.service.flags };

      case CommandType.IdentifyEvent: {
        const identifyParams = params.identifyEvent;
        if (!identifyParams) {
          throw malformedCommand;
        }
        const user = identifyParams.user || identifyParams.context;
        if (user) {
          await this.service.identify({
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
        log(`[${this.tag}] flush (no-op for Angular SDK)`);
        return undefined;

      default:
        throw badCommandError;
    }
  }
}

/**
 * Create a new Angular SDK client entity from test harness configuration
 */
export async function newSdkClientEntity(
  options: CreateInstanceParams,
): Promise<ClientEntity> {
  const tag = options.tag;
  log(`[${tag}] Creating Angular client...`);

  const config = makeSdkConfig(options.configuration, tag);
  const initialUser = makeInitialContext(options.configuration);

  if (initialUser) {
    config.user = initialUser;
  }

  const entity = new ClientEntity(tag);

  // Create a container element for this Angular app instance
  const containerId = `rollgate-entity-${tag}`;
  const container = document.createElement("div");
  container.id = containerId;
  document.body.appendChild(container);

  // Create an element for the Angular component to bootstrap into
  const hostElement = document.createElement("app-rollgate-entity");
  container.appendChild(hostElement);

  // Create a minimal Angular app dynamically
  // Note: Cannot use constructor DI in JIT mode with dynamically defined components
  @Component({
    selector: "app-rollgate-entity",
    template: `<div id="rollgate-${tag}">Rollgate Entity</div>`,
  })
  class RollgateEntityComponent {}

  @NgModule({
    imports: [BrowserModule, RollgateModule.forRoot(config)],
    declarations: [RollgateEntityComponent],
    bootstrap: [RollgateEntityComponent],
    providers: [{ provide: ROLLGATE_CONFIG, useValue: config }],
  })
  class AppModule {}

  return new Promise(async (resolve, reject) => {
    const timeout = options.configuration.startWaitTimeMs ?? 5000;
    const timeoutId = setTimeout(() => {
      if (!options.configuration.initCanFail) {
        entity.close();
        reject(new Error("Angular SDK initialization timeout"));
      } else {
        resolve(entity);
      }
    }, timeout);

    try {
      // Bootstrap the Angular module
      const moduleRef = await platformBrowser().bootstrapModule(AppModule);
      const injector = moduleRef.injector;
      const service = injector.get(RollgateService);
      const appRef = injector.get(ApplicationRef);

      entity.setService(service);
      entity.setAppRef(appRef);

      // Wait for the service to be ready
      await firstValueFrom(
        service.isReady$.pipe(
          filter((ready) => ready),
          take(1),
        ),
      );

      clearTimeout(timeoutId);
      log(`[${tag}] Angular client initialized successfully`);
      resolve(entity);
    } catch (error) {
      clearTimeout(timeoutId);
      if (!options.configuration.initCanFail) {
        reject(error);
      } else {
        resolve(entity);
      }
    }
  });
}
