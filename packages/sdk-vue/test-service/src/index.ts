/**
 * Test Service for @rollgate/sdk-vue
 *
 * This HTTP server wraps the RollgatePlugin and exposes a standard interface
 * for the test harness to interact with.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { createApp, App, ref } from "vue";
import EventSourcePolyfill from "eventsource";

// Setup globals for browser APIs
(global as any).EventSource = EventSourcePolyfill;

// Import SDK after globals are set
import {
  RollgatePlugin,
  type RollgateContext,
  type UserContext,
} from "@rollgate/sdk-vue";

const PORT = parseInt(process.env.PORT || "8004", 10);

let app: App | null = null;
let rollgateContext: RollgateContext | null = null;

interface Config {
  apiKey: string;
  baseUrl: string;
  refreshInterval?: number;
  enableStreaming?: boolean;
  timeout?: number;
}

interface Command {
  command: string;
  config?: Config;
  user?: UserContext;
  flagKey?: string;
  defaultValue?: boolean;
  defaultStringValue?: string;
  defaultNumberValue?: number;
  defaultJsonValue?: unknown;
}

interface Response {
  value?: boolean;
  stringValue?: string;
  numberValue?: number;
  jsonValue?: unknown;
  flags?: Record<string, boolean>;
  isReady?: boolean;
  circuitState?: string;
  cacheStats?: { hits: number; misses: number };
  success?: boolean;
  error?: string;
  message?: string;
}

function getRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJSON(res: ServerResponse, data: Response, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleCommand(cmd: Command): Promise<Response> {
  switch (cmd.command) {
    case "init": {
      if (!cmd.config) {
        return { error: "ValidationError", message: "config is required" };
      }

      // Cleanup previous instance
      if (app) {
        app.unmount();
        app = null;
        rollgateContext = null;
      }

      try {
        // Create a minimal Vue app
        app = createApp({
          template: "<div></div>",
          setup() {
            return {};
          },
        });

        // Install the Rollgate plugin
        app.use(RollgatePlugin, {
          apiKey: cmd.config.apiKey,
          baseUrl: cmd.config.baseUrl,
          refreshInterval: cmd.config.refreshInterval ?? 0,
          enableStreaming: cmd.config.enableStreaming ?? false,
          timeout: cmd.config.timeout ?? 5000,
          user: cmd.user,
        });

        // Mount to a virtual element
        const mockElement = { nodeType: 1 } as any;

        // The plugin provides context via app.config.globalProperties
        // We need to access it after the plugin is installed
        rollgateContext = app.config.globalProperties
          .$rollgate as RollgateContext;

        // Wait for the SDK to be ready
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Init timeout")),
            10000,
          );

          const checkReady = () => {
            if (rollgateContext && rollgateContext.isReady.value) {
              clearTimeout(timeout);
              resolve();
            } else if (rollgateContext && rollgateContext.error.value) {
              clearTimeout(timeout);
              reject(rollgateContext.error.value);
            } else {
              setTimeout(checkReady, 50);
            }
          };

          // Start checking after a small delay
          setTimeout(checkReady, 100);
        });

        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "isEnabled": {
      if (!rollgateContext) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultValue ?? false;
      const value = rollgateContext.isEnabled(cmd.flagKey, defaultValue);
      return { value };
    }

    case "getString": {
      if (!rollgateContext) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // Vue SDK doesn't have getString yet - return default
      const stringValue = cmd.defaultStringValue ?? "";
      return { stringValue };
    }

    case "getNumber": {
      if (!rollgateContext) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // Vue SDK doesn't have getNumber yet - return default
      const numberValue = cmd.defaultNumberValue ?? 0;
      return { numberValue };
    }

    case "getJson": {
      if (!rollgateContext) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // Vue SDK doesn't have getJSON yet - return default
      const jsonValue = cmd.defaultJsonValue ?? null;
      return { jsonValue };
    }

    case "identify": {
      if (!rollgateContext) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.user) {
        return { error: "ValidationError", message: "user is required" };
      }

      try {
        await rollgateContext.identify(cmd.user);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "reset": {
      if (!rollgateContext) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      try {
        await rollgateContext.reset();
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "getAllFlags": {
      if (!rollgateContext) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      return { flags: rollgateContext.flags.value };
    }

    case "getState": {
      if (!rollgateContext) {
        return {
          isReady: false,
          circuitState: "UNKNOWN",
        };
      }

      const metrics = rollgateContext.getMetrics();

      return {
        isReady: rollgateContext.isReady.value,
        circuitState: rollgateContext.circuitState.value.toLowerCase(),
        cacheStats: {
          hits: Number(metrics.cache?.hits ?? 0),
          misses: Number(metrics.cache?.misses ?? 0),
        },
      };
    }

    case "close": {
      if (rollgateContext) {
        rollgateContext.close();
      }
      if (app) {
        app.unmount();
        app = null;
        rollgateContext = null;
      }
      return { success: true };
    }

    default:
      return {
        error: "UnknownCommand",
        message: `Unknown command: ${cmd.command}`,
      };
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "GET") {
    sendJSON(res, { success: true });
    return;
  }

  if (req.method === "POST") {
    try {
      const body = await getRequestBody(req);
      const cmd: Command = JSON.parse(body);
      const result = await handleCommand(cmd);
      sendJSON(res, result);
    } catch (err) {
      const error = err as Error;
      sendJSON(res, { error: "ParseError", message: error.message }, 400);
    }
    return;
  }

  if (req.method === "DELETE") {
    if (rollgateContext) {
      rollgateContext.close();
    }
    if (app) {
      app.unmount();
      app = null;
      rollgateContext = null;
    }
    sendJSON(res, { success: true });
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[sdk-vue test-service] Listening on port ${PORT}`);
});

process.on("SIGINT", () => {
  console.log("\n[sdk-vue test-service] Shutting down...");
  if (rollgateContext) {
    rollgateContext.close();
  }
  if (app) {
    app.unmount();
  }
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  if (rollgateContext) {
    rollgateContext.close();
  }
  if (app) {
    app.unmount();
  }
  server.close(() => {
    process.exit(0);
  });
});
