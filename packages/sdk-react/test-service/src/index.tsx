/**
 * Test Service for @rollgate/sdk-react
 *
 * This HTTP server wraps the RollgateProvider and hooks, exposing a standard
 * interface for the test harness to interact with.
 *
 * IMPORTANT: JSDOM globals must be set up BEFORE importing React.
 * We use dynamic imports to ensure proper initialization order.
 */

import { createServer, IncomingMessage, ServerResponse } from "http";
import { JSDOM } from "jsdom";
// @ts-ignore - no types available
import { EventSource as LDEventSource } from "launchdarkly-eventsource";

// Setup global browser environment FIRST - before any React imports
const dom = new JSDOM(
  "<!DOCTYPE html><html><body><div id='root'></div></body></html>",
  {
    url: "http://localhost",
    pretendToBeVisual: true,
    runScripts: "dangerously",
  },
);

// Setup globals BEFORE importing React
Object.defineProperty(global, "window", { value: dom.window, writable: true });
Object.defineProperty(global, "document", {
  value: dom.window.document,
  writable: true,
});
Object.defineProperty(global, "navigator", {
  value: dom.window.navigator,
  writable: true,
});
Object.defineProperty(global, "EventSource", {
  value: LDEventSource,
  writable: true,
});

// Polyfills for React 18
Object.defineProperty(global, "requestAnimationFrame", {
  value: (cb: FrameRequestCallback) => setTimeout(cb, 0),
  writable: true,
});
Object.defineProperty(global, "cancelAnimationFrame", {
  value: (id: number) => clearTimeout(id),
  writable: true,
});
Object.defineProperty(global, "HTMLElement", {
  value: dom.window.HTMLElement,
  writable: true,
});
Object.defineProperty(global, "Element", {
  value: dom.window.Element,
  writable: true,
});
Object.defineProperty(global, "Node", {
  value: dom.window.Node,
  writable: true,
});

// Types
interface Config {
  apiKey: string;
  baseUrl: string;
  refreshInterval?: number;
  enableStreaming?: boolean;
  timeout?: number;
}

interface UserContext {
  id: string;
  email?: string;
  attributes?: Record<string, unknown>;
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

const PORT = parseInt(process.env.PORT || "8003", 10);

// Store for test harness communication - will be populated after dynamic import
let contextRef: any = null;
let rootRef: any = null;
let currentBaseUrl: string | null = null;
let currentApiKey: string | null = null;

// React modules - loaded dynamically
let React: any = null;
let createRoot: any = null;
let flushSync: any = null;
let RollgateProvider: any = null;
let useRollgate: any = null;

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

// Component that captures the Rollgate context and exposes it globally
function ContextCapture() {
  const context = useRollgate();
  // Update contextRef on every render
  contextRef = context;
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

      const config = {
        apiKey: cmd.config.apiKey,
        baseUrl: cmd.config.baseUrl,
        refreshInterval: cmd.config.refreshInterval ?? 0,
        enableStreaming: cmd.config.enableStreaming ?? false,
        timeout: cmd.config.timeout ?? 5000,
      };

      // Store for notifyMockIdentify
      currentBaseUrl = cmd.config.baseUrl;
      currentApiKey = cmd.config.apiKey;

      try {
        // Notify mock about user context before init (for remote evaluation)
        if (cmd.user) {
          await notifyMockIdentify(cmd.user, cmd.config.apiKey);
        }

        const container = dom.window.document.getElementById("root");
        if (!container) {
          return { error: "InitError", message: "Root container not found" };
        }

        rootRef = createRoot(container);

        // Use flushSync to force synchronous rendering
        flushSync(() => {
          rootRef!.render(
            React.createElement(
              RollgateProvider,
              { config, user: cmd.user },
              React.createElement(ContextCapture),
            ),
          );
        });

        // Poll for isLoading to become false
        const startTime = Date.now();
        const timeout = 10000;

        while (Date.now() - startTime < timeout) {
          // Force re-render to update contextRef
          flushSync(() => {
            rootRef!.render(
              React.createElement(
                RollgateProvider,
                { config, user: cmd.user },
                React.createElement(ContextCapture),
              ),
            );
          });

          // Check if SDK is ready
          if (contextRef && !contextRef.isLoading) {
            return { success: true };
          }

          // Check for error
          if (contextRef && contextRef.isError) {
            return {
              error: "RollgateError",
              message: "SDK initialization failed",
            };
          }

          // Wait a bit before next poll
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        return { error: "Error", message: "Init timeout" };
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
        // Notify mock about user context before identify (for remote evaluation)
        if (currentApiKey) {
          await notifyMockIdentify(cmd.user, currentApiKey);
        }
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
          hits: Number(metrics.cacheHits ?? 0),
          misses: Number(metrics.cacheMisses ?? 0),
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

// Main entry point - load React dynamically after globals are set
async function main() {
  // Dynamic imports - these happen AFTER globals are set up
  const reactModule = await import("react");
  const reactDomClientModule = await import("react-dom/client");
  const reactDomModule = await import("react-dom");
  const sdkModule = await import("@rollgate/sdk-react");

  React = reactModule.default;
  createRoot = reactDomClientModule.createRoot;
  flushSync = reactDomModule.flushSync;
  RollgateProvider = sdkModule.RollgateProvider;
  useRollgate = sdkModule.useRollgate;

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
}

// Global error handlers to prevent crashes
process.on("uncaughtException", (err) => {
  console.error("[sdk-react test-service] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[sdk-react test-service] Unhandled rejection:", reason);
});

// Start the service
main().catch((err) => {
  console.error("[sdk-react test-service] Failed to start:", err);
  process.exit(1);
});
