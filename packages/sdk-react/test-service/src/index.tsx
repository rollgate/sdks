/**
 * Test Service for @rollgate/sdk-react
 *
 * This HTTP server wraps the RollgateProvider and hooks, exposing a standard
 * interface for the test harness to interact with.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { JSDOM } from "jsdom";
import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import EventSourcePolyfill from "eventsource";

// Setup global browser environment
const dom = new JSDOM(
  "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
  {
    url: "http://localhost",
    pretendToBeVisual: true,
  },
);

(global as any).window = dom.window;
(global as any).document = dom.window.document;
(global as any).navigator = dom.window.navigator;
(global as any).EventSource = EventSourcePolyfill;

// Now import the SDK (after globals are set up)
import {
  RollgateProvider,
  useRollgate,
  type RollgateConfig,
  type UserContext,
} from "@rollgate/sdk-react";

const PORT = parseInt(process.env.PORT || "8003", 10);

// Store for test harness communication
let resolveReady: (() => void) | null = null;
let contextRef: ReturnType<typeof useRollgate> | null = null;
let rootRef: ReturnType<typeof createRoot> | null = null;

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

// Component that captures the Rollgate context
function ContextCapture({ onReady }: { onReady: () => void }) {
  const context = useRollgate();
  const hasNotified = useRef(false);

  useEffect(() => {
    contextRef = context;
    if (!hasNotified.current && !context.isLoading) {
      hasNotified.current = true;
      onReady();
    }
  }, [context, context.isLoading, onReady]);

  return null;
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
      if (rootRef) {
        rootRef.unmount();
        rootRef = null;
        contextRef = null;
      }

      const config: RollgateConfig = {
        apiKey: cmd.config.apiKey,
        baseUrl: cmd.config.baseUrl,
        refreshInterval: cmd.config.refreshInterval ?? 0,
        enableStreaming: cmd.config.enableStreaming ?? false,
        timeout: cmd.config.timeout ?? 5000,
      };

      try {
        const readyPromise = new Promise<void>((resolve) => {
          resolveReady = resolve;
        });

        const container = dom.window.document.getElementById("root");
        if (!container) {
          return { error: "InitError", message: "Root container not found" };
        }

        rootRef = createRoot(container);
        rootRef.render(
          <RollgateProvider config={config} user={cmd.user}>
            <ContextCapture onReady={() => resolveReady?.()} />
          </RollgateProvider>,
        );

        // Wait for ready with timeout
        await Promise.race([
          readyPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Init timeout")), 10000),
          ),
        ]);

        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "isEnabled": {
      if (!contextRef) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }

      const defaultValue = cmd.defaultValue ?? false;
      const value = contextRef.isEnabled(cmd.flagKey, defaultValue);
      return { value };
    }

    case "getString": {
      if (!contextRef) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // React SDK doesn't have getString yet - return default
      const stringValue = cmd.defaultStringValue ?? "";
      return { stringValue };
    }

    case "getNumber": {
      if (!contextRef) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // React SDK doesn't have getNumber yet - return default
      const numberValue = cmd.defaultNumberValue ?? 0;
      return { numberValue };
    }

    case "getJson": {
      if (!contextRef) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.flagKey) {
        return { error: "ValidationError", message: "flagKey is required" };
      }
      // React SDK doesn't have getJSON yet - return default
      const jsonValue = cmd.defaultJsonValue ?? null;
      return { jsonValue };
    }

    case "identify": {
      if (!contextRef) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }
      if (!cmd.user) {
        return { error: "ValidationError", message: "user is required" };
      }

      try {
        await contextRef.identify(cmd.user);
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "reset": {
      if (!contextRef) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      try {
        await contextRef.reset();
        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.name || "Error", message: error.message };
      }
    }

    case "getAllFlags": {
      if (!contextRef) {
        return {
          error: "NotInitializedError",
          message: "Client not initialized",
        };
      }

      return { flags: contextRef.flags };
    }

    case "getState": {
      if (!contextRef) {
        return {
          isReady: false,
          circuitState: "UNKNOWN",
        };
      }

      const metrics = contextRef.getMetrics();

      return {
        isReady: !contextRef.isLoading,
        circuitState: contextRef.circuitState.toLowerCase(),
        cacheStats: {
          hits: Number(metrics.cache?.hits ?? 0),
          misses: Number(metrics.cache?.misses ?? 0),
        },
      };
    }

    case "close": {
      if (rootRef) {
        rootRef.unmount();
        rootRef = null;
        contextRef = null;
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
    if (rootRef) {
      rootRef.unmount();
      rootRef = null;
      contextRef = null;
    }
    sendJSON(res, { success: true });
    return;
  }

  res.writeHead(405);
  res.end();
});

server.listen(PORT, () => {
  console.log(`[sdk-react test-service] Listening on port ${PORT}`);
});

process.on("SIGINT", () => {
  console.log("\n[sdk-react test-service] Shutting down...");
  if (rootRef) {
    rootRef.unmount();
  }
  server.close(() => {
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  if (rootRef) {
    rootRef.unmount();
  }
  server.close(() => {
    process.exit(0);
  });
});
