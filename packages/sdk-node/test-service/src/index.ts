/**
 * Test Service for @rollgate/sdk-node
 *
 * This HTTP server wraps the RollgateClient and exposes a standard interface
 * for the test harness to interact with.
 *
 * Protocol:
 * - GET /  -> Health check
 * - POST / -> Execute command
 * - DELETE / -> Cleanup/shutdown
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { RollgateClient, RollgateConfig } from "@rollgate/sdk-node";

const PORT = parseInt(process.env.PORT || "8001", 10);

let client: RollgateClient | null = null;
let currentBaseUrl: string | null = null;
let currentApiKey: string | null = null;

// Helper to notify mock server about user context (for remote evaluation)
async function notifyMockIdentify(
  user: UserContext,
  apiKey: string,
): Promise<void> {
  if (!currentBaseUrl) return;

  try {
    await fetch(`${currentBaseUrl}/api/v1/sdk/identify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ user }),
    });
  } catch {
    // Ignore errors - mock might not support identify
  }
}

interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, string | number | boolean>;
}

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

      const config: RollgateConfig = {
        apiKey: cmd.config.apiKey,
        baseUrl: cmd.config.baseUrl,
        refreshInterval: cmd.config.refreshInterval ?? 0,
        enableStreaming: cmd.config.enableStreaming ?? false,
        timeout: cmd.config.timeout ?? 5000,
      };

      try {
        currentBaseUrl = cmd.config.baseUrl;
        currentApiKey = cmd.config.apiKey;
        client = new RollgateClient(config);

        // Notify mock about user context before init (for remote evaluation)
        if (cmd.user) {
          await notifyMockIdentify(cmd.user, cmd.config.apiKey);
        }

        await client.init(cmd.user || undefined);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "isEnabled": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultValue ?? false;
      const value = client.isEnabled(cmd.flagKey, defaultValue);
      return { value };
    }

    case "identify": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.user) {
        return { error: "ValidationError", message: "user is required" };
      }

      try {
        // Notify mock about user context before identify (for remote evaluation)
        if (currentApiKey) {
          await notifyMockIdentify(cmd.user, currentApiKey);
        }
        await client.identify(cmd.user);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "reset": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      try {
        await client.reset();
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "getAllFlags": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      const flags = client.getAllFlags();
      return { flags };
    }

    case "getState": {
      if (!client) {
        return {
          isReady: false,
          circuitState: "UNKNOWN",
        };
      }

      const circuitState = client.getCircuitState();
      const cacheStats = client.getCacheStats();

      return {
        isReady: true, // If client exists and init completed, it's ready
        circuitState: circuitState,
        cacheStats: {
          hits: Number(cacheStats.hits),
          misses: Number(cacheStats.misses),
        },
      };
    }

    case "getString": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultStringValue ?? "";
      const stringValue = client.getString(cmd.flagKey, defaultValue);
      return { stringValue };
    }

    case "getNumber": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultNumberValue ?? 0;
      const numberValue = client.getNumber(cmd.flagKey, defaultValue);
      return { numberValue };
    }

    case "getJson": {
      if (!client) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultJsonValue ?? null;
      const jsonValue = client.getJSON(cmd.flagKey, defaultValue);
      return { jsonValue };
    }

    case "close": {
      if (client) {
        try {
          await client.close();
        } catch {
          // Ignore close errors
        }
        client = null;
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
  // Health check
  if (req.method === "GET") {
    sendJSON(res, { success: true });
    return;
  }

  // Execute command
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

  // Cleanup
  if (req.method === "DELETE") {
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }
      client = null;
    }
    sendJSON(res, { success: true });
    return;
  }

  // Method not allowed
  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[sdk-node test-service] Listening on port ${PORT}`);
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[sdk-node test-service] Shutting down...");
  if (client) {
    await client.close();
  }
  server.close(() => {
    console.log("[sdk-node test-service] Server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", async () => {
  console.log("[sdk-node test-service] Received SIGTERM");
  if (client) {
    await client.close();
  }
  server.close(() => {
    process.exit(0);
  });
});
