/**
 * Types for contract test protocol
 * Based on LaunchDarkly SDK test harness specification
 */

export enum CommandType {
  EvaluateFlag = "evaluate",
  EvaluateAllFlags = "evaluateAll",
  IdentifyEvent = "identifyEvent",
  CustomEvent = "customEvent",
  FlushEvents = "flushEvents",
  FlushTelemetry = "flushTelemetry",
  GetTelemetryStats = "getTelemetryStats",
  Reset = "reset",
  Track = "track",
}

export enum ValueType {
  Bool = "bool",
  Int = "int",
  Double = "double",
  String = "string",
  Any = "any",
}

export interface TrackParams {
  flagKey: string;
  eventName: string;
  userId: string;
  variationId?: string;
  value?: number;
  metadata?: Record<string, unknown>;
}

export interface CommandParams {
  command: CommandType;
  evaluate?: EvaluateFlagParams;
  evaluateAll?: EvaluateAllFlagsParams;
  customEvent?: CustomEventParams;
  identifyEvent?: IdentifyEventParams;
  track?: TrackParams;
}

export interface EvaluateFlagParams {
  flagKey: string;
  valueType: ValueType;
  defaultValue: unknown;
  detail: boolean;
}

export interface EvaluateFlagResponse {
  value: unknown;
}

export interface EvaluateAllFlagsParams {
  withReasons?: boolean;
}

export interface EvaluateAllFlagsResponse {
  state: Record<string, unknown>;
}

export interface CustomEventParams {
  eventKey: string;
  data?: unknown;
  metricValue?: number;
}

export interface IdentifyEventParams {
  context?: UserContext;
  user?: UserContext;
}

export interface UserContext {
  id?: string;
  key?: string;
  email?: string;
  attributes?: Record<string, unknown>;
}

export interface CreateInstanceParams {
  configuration: SDKConfigParams;
  tag: string;
}

export interface SDKConfigParams {
  credential: string;
  startWaitTimeMs?: number;
  initCanFail?: boolean;
  serviceEndpoints?: ServiceEndpoints;
  streaming?: StreamingConfig;
  polling?: PollingConfig;
  events?: EventsConfig;
  clientSide?: ClientSideConfig;
}

export interface ServiceEndpoints {
  streaming?: string;
  polling?: string;
  events?: string;
}

export interface StreamingConfig {
  baseUri?: string;
  initialRetryDelayMs?: number;
}

export interface PollingConfig {
  baseUri?: string;
  pollIntervalMs?: number;
}

export interface EventsConfig {
  baseUri?: string;
  capacity?: number;
  enableDiagnostics?: boolean;
  allAttributesPrivate?: boolean;
  flushIntervalMs?: number;
}

export interface ClientSideConfig {
  initialContext?: UserContext;
  initialUser?: UserContext;
  evaluationReasons?: boolean;
}

/**
 * Log message to page
 */
export function log(message: string): void {
  const logDiv = document.getElementById("log");
  if (logDiv) {
    const line = document.createElement("div");
    line.textContent = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
    logDiv.appendChild(line);
    logDiv.scrollTop = logDiv.scrollHeight;
  }
  console.log(`[entity] ${message}`);
}

/**
 * Update connection status
 */
export function setStatus(connected: boolean, message?: string): void {
  const statusDiv = document.getElementById("status");
  if (statusDiv) {
    statusDiv.className = `status ${connected ? "connected" : "disconnected"}`;
    statusDiv.textContent =
      message || (connected ? "Connected" : "Disconnected");
  }
}
