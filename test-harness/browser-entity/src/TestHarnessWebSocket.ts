/**
 * TestHarnessWebSocket - Manages WebSocket connection to adapter
 *
 * Based on LaunchDarkly's TestHarnessWebSocket implementation.
 * Handles command routing and client lifecycle.
 */

import { ClientEntity, newSdkClientEntity } from "./ClientEntity";
import { log, setStatus, CreateInstanceParams, CommandParams } from "./types";

/**
 * WebSocket message from adapter
 */
interface AdapterMessage {
  command: string;
  reqId: string;
  id?: string;
  body?: unknown;
}

/**
 * Response to adapter
 */
interface AdapterResponse {
  reqId: string;
  capabilities?: string[];
  resourceUrl?: string;
  status?: number;
  body?: unknown;
}

/**
 * Manages WebSocket connection and command handling
 */
export default class TestHarnessWebSocket {
  private ws?: WebSocket;
  private readonly entities: Record<string, ClientEntity> = {};
  private clientCounter = 0;

  constructor(private readonly url: string) {}

  /**
   * Connect to the adapter WebSocket server
   */
  connect(): void {
    log(`Connecting to ${this.url}...`);
    setStatus(false, "Connecting...");

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      log("Connected to adapter");
      setStatus(true, "Connected to adapter");
    };

    this.ws.onclose = () => {
      log("WebSocket closed. Reconnecting in 1 second...");
      setStatus(false, "Disconnected. Reconnecting...");
      setTimeout(() => this.connect(), 1000);
    };

    this.ws.onerror = (err) => {
      log(`WebSocket error: ${err}`);
      setStatus(false, "Connection error");
    };

    this.ws.onmessage = async (msg) => {
      const data: AdapterMessage = JSON.parse(msg.data);
      log(`Received: ${data.command} (reqId: ${data.reqId.slice(0, 8)}...)`);

      const response: AdapterResponse = { reqId: data.reqId };

      try {
        switch (data.command) {
          case "getCapabilities":
            // Return capabilities that this SDK supports
            response.capabilities = [
              "client-side",
              "service-endpoints",
              "tags",
              "user-type",
            ];
            break;

          case "createClient":
            {
              const clientId = String(this.clientCounter);
              response.resourceUrl = `/clients/${clientId}`;
              response.status = 201;

              try {
                const entity = await newSdkClientEntity(
                  data.body as CreateInstanceParams,
                );
                this.entities[clientId] = entity;
                this.clientCounter += 1;
                log(`Created client ${clientId}`);
              } catch (error) {
                log(`Failed to create client: ${error}`);
                response.status = 500;
              }
            }
            break;

          case "runCommand":
            if (
              data.id &&
              Object.prototype.hasOwnProperty.call(this.entities, data.id)
            ) {
              const entity = this.entities[data.id];
              try {
                const body = await entity.doCommand(data.body as CommandParams);
                response.body = body;
                response.status = body ? 200 : 204;
              } catch (error) {
                log(`Command error: ${error}`);
                response.status = 500;
              }
            } else {
              log(`Client not found: ${data.id}`);
              response.status = 404;
            }
            break;

          case "deleteClient":
            if (
              data.id &&
              Object.prototype.hasOwnProperty.call(this.entities, data.id)
            ) {
              const entity = this.entities[data.id];
              entity.close();
              delete this.entities[data.id];
              log(`Deleted client ${data.id}`);
              response.status = 200;
            } else {
              log(`Client not found for deletion: ${data.id}`);
              response.status = 404;
            }
            break;

          default:
            log(`Unknown command: ${data.command}`);
            response.status = 400;
            break;
        }
      } catch (error) {
        log(`Error handling command: ${error}`);
        response.status = 500;
      }

      this.send(response);
    };
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.ws?.close();
  }

  /**
   * Send response to adapter
   */
  private send(data: AdapterResponse): void {
    log(
      `Sending response (reqId: ${data.reqId.slice(0, 8)}..., status: ${data.status || "ok"})`,
    );
    this.ws?.send(JSON.stringify(data));
  }
}
