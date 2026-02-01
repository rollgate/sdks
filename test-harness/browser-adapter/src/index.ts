/**
 * Browser Contract Test Adapter
 *
 * This adapter bridges the test harness (Go) and the browser entity (Vite app).
 * Architecture copied from LaunchDarkly js-core/packages/sdk/browser/contract-tests/adapter
 *
 * Flow:
 * 1. WebSocket server on port 8001 waits for browser connection
 * 2. REST server starts immediately on port 8000
 * 3. Test harness sends REST requests to port 8000
 * 4. Adapter forwards requests via WebSocket to browser
 * 5. Browser executes SDK commands and responds
 * 6. Adapter returns response to test harness
 */

/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */

import bodyParser from "body-parser";
import cors from "cors";
import { randomUUID } from "crypto";
import express from "express";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

async function main() {
  const REST_PORT = parseInt(process.env.PORT || "8000", 10);
  const WS_PORT = parseInt(process.env.WS_PORT || "8001", 10);
  const SDK_NAME = process.env.SDK_NAME || "browser";

  const waiters: Record<string, (data: unknown) => void> = {};
  let activeWs: WebSocket | null = null;

  console.log(`[${SDK_NAME}-adapter] Running contract test harness adapter.`);
  console.log(
    `[${SDK_NAME}-adapter] WebSocket server listening on port ${WS_PORT}`,
  );
  console.log(`[${SDK_NAME}-adapter] REST API listening on port ${REST_PORT}`);
  console.log(`[${SDK_NAME}-adapter] Waiting for browser entity to connect...`);

  // WebSocket server for browser entity connection
  const wss = new WebSocketServer({ port: WS_PORT });

  wss.on("connection", (ws) => {
    console.log(`[${SDK_NAME}-adapter] Browser entity connected via WebSocket`);
    activeWs = ws;

    ws.on("error", (err) => {
      console.error(`[${SDK_NAME}-adapter] WebSocket error:`, err);
    });

    ws.on("close", () => {
      console.log(
        `[${SDK_NAME}-adapter] Browser entity disconnected. Waiting for reconnection...`,
      );
      if (activeWs === ws) {
        activeWs = null;
      }
      // Clear any pending waiters with error
      Object.keys(waiters).forEach((reqId) => {
        waiters[reqId]({ error: "WebSocket disconnected", status: 503 });
        delete waiters[reqId];
      });
    });

    ws.on("message", (stringData: string) => {
      const data = JSON.parse(stringData);
      if (Object.prototype.hasOwnProperty.call(waiters, data.reqId)) {
        waiters[data.reqId](data);
        delete waiters[data.reqId];
      } else {
        console.error(
          `[${SDK_NAME}-adapter] Did not find outstanding request`,
          data.reqId,
        );
      }
    });
  });

  // Helper to send command to browser
  const send = (data: {
    [key: string]: unknown;
    reqId: string;
  }): Promise<any> => {
    return new Promise((resolve) => {
      if (!activeWs || activeWs.readyState !== 1) {
        resolve({ error: "Browser not connected", status: 503 });
        return;
      }

      waiters[data.reqId] = resolve;

      // Timeout after 30 seconds
      setTimeout(() => {
        if (waiters[data.reqId]) {
          delete waiters[data.reqId];
          resolve({ error: "Request timeout", status: 504 });
        }
      }, 30000);

      try {
        activeWs.send(JSON.stringify(data));
      } catch (err) {
        delete waiters[data.reqId];
        resolve({ error: "Failed to send to browser", status: 503 });
      }
    });
  };

  // Express REST API server - starts immediately
  const app = express();

  app.use(
    cors({
      origin: "*",
      allowedHeaders: "*",
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );
  app.use(bodyParser.json());

  // GET / - Get capabilities
  app.get("/", async (_req, res) => {
    if (!activeWs) {
      res.status(503).json({ error: "Browser not connected" });
      return;
    }
    const commandResult = await send({
      command: "getCapabilities",
      reqId: randomUUID(),
    });
    if (commandResult.error) {
      res
        .status(commandResult.status || 500)
        .json({ error: commandResult.error });
      return;
    }
    res.header("Content-Type", "application/json");
    res.json(commandResult);
  });

  // DELETE / - Cleanup (don't exit, just acknowledge)
  app.delete("/", (_req, res) => {
    console.log(`[${SDK_NAME}-adapter] Cleanup requested`);
    res.json({ success: true });
  });

  // POST / - Create client
  app.post("/", async (req, res) => {
    if (!activeWs) {
      res.status(503).json({ error: "Browser not connected" });
      return;
    }
    const commandResult = await send({
      command: "createClient",
      body: req.body,
      reqId: randomUUID(),
    });
    if (commandResult.error) {
      res
        .status(commandResult.status || 500)
        .json({ error: commandResult.error });
      return;
    }
    if (commandResult.resourceUrl) {
      res.set("Location", commandResult.resourceUrl);
    }
    if (commandResult.status) {
      res.status(commandResult.status);
    }
    res.send();
  });

  // POST /clients/:id - Run command on client
  app.post("/clients/:id", async (req, res) => {
    if (!activeWs) {
      res.status(503).json({ error: "Browser not connected" });
      return;
    }
    const commandResult = await send({
      command: "runCommand",
      id: req.params.id,
      body: req.body,
      reqId: randomUUID(),
    });
    if (commandResult.error) {
      res
        .status(commandResult.status || 500)
        .json({ error: commandResult.error });
      return;
    }
    if (commandResult.status) {
      res.status(commandResult.status);
    }
    if (commandResult.body) {
      res.write(JSON.stringify(commandResult.body));
    }
    res.send();
  });

  // DELETE /clients/:id - Delete client
  app.delete("/clients/:id", async (req, res) => {
    if (!activeWs) {
      res.status(503).json({ error: "Browser not connected" });
      return;
    }
    const commandResult = await send({
      command: "deleteClient",
      id: req.params.id,
      reqId: randomUUID(),
    });
    if (commandResult.error) {
      res
        .status(commandResult.status || 500)
        .json({ error: commandResult.error });
      return;
    }
    res.send();
  });

  app.listen(REST_PORT);
}

main();
