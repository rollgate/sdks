/**
 * Test Service for @rollgate/sdk-svelte
 *
 * This HTTP server wraps the createRollgate function and exposes a standard
 * interface for the test harness to interact with.
 *
 * Svelte stores work in Node.js without DOM, making this simpler than React/Vue.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import * as EventSourcePolyfill from "eventsource";

// Setup globals for browser APIs
(global as any).EventSource = EventSourcePolyfill;

// Import SDK after globals are set
import {
  createRollgate,
  type RollgateStores,
  type UserContext,
} from "@rollgate/sdk-svelte";

const PORT = parseInt(process.env.PORT || "8005", 10);

let rollgate: RollgateStores | null = null;
let currentFlags: Record<string, boolean> = {};

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
      if (rollgate) {
        rollgate.destroy();
        rollgate = null;
        currentFlags = {};
      }

      try {
        rollgate = createRollgate({
          apiKey: cmd.config.apiKey,
          baseUrl: cmd.config.baseUrl,
          refreshInterval: cmd.config.refreshInterval ?? 0,
          enableStreaming: cmd.config.enableStreaming ?? false,
          timeout: cmd.config.timeout ?? 5000,
          user: cmd.user,
        });

        // Subscribe to flags store
        const unsubscribe = rollgate.flags.subscribe((flags) => {
          currentFlags = flags;
        });

        // Wait for ready
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Init timeout")),
            10000,
          );
          let isReady = false;
          let hasError: Error | null = null;

          const unsubReady = rollgate!.isReady.subscribe((ready) => {
            isReady = ready;
            if (ready && !hasError) {
              clearTimeout(timeout);
              resolve();
            }
          });

          const unsubError = rollgate!.error.subscribe((err) => {
            if (err) {
              hasError = err;
              clearTimeout(timeout);
              reject(err);
            }
          });

          // Check if already ready
          setTimeout(() => {
            if (isReady && !hasError) {
              clearTimeout(timeout);
              resolve();
            }
          }, 100);
        });

        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "isEnabled": {
      if (!rollgate) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultValue ?? false;
      const value = rollgate.isEnabled(cmd.flagKey, defaultValue);
      return { value };
    }

    case "getString": {
      if (!rollgate) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // Svelte SDK doesn't have getString yet - return default
      const stringValue = cmd.defaultStringValue ?? "";
      return { stringValue };
    }

    case "getNumber": {
      if (!rollgate) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // Svelte SDK doesn't have getNumber yet - return default
      const numberValue = cmd.defaultNumberValue ?? 0;
      return { numberValue };
    }

    case "getJson": {
      if (!rollgate) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // Svelte SDK doesn't have getJSON yet - return default
      const jsonValue = cmd.defaultJsonValue ?? null;
      return { jsonValue };
    }

    case "identify": {
      if (!rollgate) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.user) {
        return { error: "ValidationError", message: "user is required" };
      }

      try {
        await rollgate.identify(cmd.user);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "reset": {
      if (!rollgate) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      try {
        await rollgate.reset();
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "getAllFlags": {
      if (!rollgate) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      return { flags: currentFlags };
    }

    case "getState": {
      if (!rollgate) {
        return {
          isReady: false,
          circuitState: "UNKNOWN",
        };
      }

      let isReady = false;
      let circuitState = "closed";

      rollgate.isReady.subscribe((ready) => {
        isReady = ready;
      })();

      rollgate.circuitState.subscribe((state) => {
        circuitState = state.toLowerCase();
      })();

      const metrics = rollgate.getMetrics();

      return {
        isReady,
        circuitState,
        cacheStats: {
          hits: Number(metrics.cacheHits ?? 0),
          misses: Number(metrics.cacheMisses ?? 0),
        },
      };
    }

    case "close": {
      if (rollgate) {
        rollgate.destroy();
        rollgate = null;
        currentFlags = {};
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
    if (rollgate) {
      rollgate.destroy();
      rollgate = null;
      currentFlags = {};
    }
    sendJSON(res, { success: true });
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[sdk-svelte test-service] Listening on port ${PORT}`);
});

process.on("SIGINT", () => {
  console.log("\n[sdk-svelte test-service] Shutting down...");
  if (rollgate) {
    rollgate.destroy();
  }
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  if (rollgate) {
    rollgate.destroy();
  }
  server.close(() => {
    process.exit(0);
  });
});
