/**
 * Browser Contract Test Adapter
 *
 * This adapter bridges the test harness (Go) and the browser entity (Vite app).
 * Architecture copied from LaunchDarkly js-core/packages/sdk/browser/contract-tests/adapter
 *
 * Flow:
 * 1. WebSocket server on port 8001 waits for browser connection
 * 2. When browser connects, Express server starts on port 8000
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
import http from "node:http";
import util from "node:util";
import { WebSocketServer } from "ws";

let server: http.Server | undefined;

async function main() {
  const wss = new WebSocketServer({ port: 8001 });
  const waiters: Record<string, (data: unknown) => void> = {};

  console.log("[browser-adapter] Running contract test harness adapter.");
  console.log("[browser-adapter] WebSocket server listening on port 8001");
  console.log("[browser-adapter] Waiting for browser entity to connect...");

  wss.on("connection", async (ws) => {
    console.log("[browser-adapter] Browser entity connected via WebSocket");

    ws.on("error", console.error);

    ws.on("message", (stringData: string) => {
      const data = JSON.parse(stringData);
      if (Object.prototype.hasOwnProperty.call(waiters, data.reqId)) {
        waiters[data.reqId](data);
        delete waiters[data.reqId];
      } else {
        console.error(
          "[browser-adapter] Did not find outstanding request",
          data.reqId,
        );
      }
    });

    const send = (data: {
      [key: string]: unknown;
      reqId: string;
    }): Promise<any> => {
      let resolver: (data: unknown) => void;
      const waiter = new Promise((resolve) => {
        resolver = resolve;
      });
      // @ts-expect-error The body of the above assignment runs sequentially.
      waiters[data.reqId] = resolver;
      ws.send(JSON.stringify(data));
      return waiter;
    };

    // Close existing server if browser reconnects
    if (server) {
      await util.promisify(server.close).call(server);
      server = undefined;
    }

    const app = express();
    const port = 8000;

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
      const commandResult = await send({
        command: "getCapabilities",
        reqId: randomUUID(),
      });
      res.header("Content-Type", "application/json");
      res.json(commandResult);
    });

    // DELETE / - Shutdown
    app.delete("/", () => {
      console.log("[browser-adapter] Shutdown requested");
      process.exit();
    });

    // POST / - Create client
    app.post("/", async (req, res) => {
      const commandResult = await send({
        command: "createClient",
        body: req.body,
        reqId: randomUUID(),
      });
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
      const commandResult = await send({
        command: "runCommand",
        id: req.params.id,
        body: req.body,
        reqId: randomUUID(),
      });
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
      await send({
        command: "deleteClient",
        id: req.params.id,
        reqId: randomUUID(),
      });
      res.send();
    });

    server = app.listen(port, () => {
      console.log("[browser-adapter] REST API listening on port %d", port);
    });
  });
}

main();
