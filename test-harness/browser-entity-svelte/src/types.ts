/**
 * Types for browser contract test entity
 * Shared between all framework entities
 */

export function log(message: string): void {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, -1);
  console.log(`[${timestamp}] ${message}`);
}

export enum CommandType {
  EvaluateFlag = "evaluate",
  EvaluateAllFlags = "evaluateAll",
  IdentifyEvent = "identifyEvent",
  CustomEvent = "customEvent",
  FlushEvents = "flushEvents",
  Reset = "reset",
  Track = "track",
}

export interface TrackParams {
  flagKey: string;
  eventName: string;
  userId: string;
  variationId?: string;
  value?: number;
  metadata?: Record<string, unknown>;
}

export enum ValueType {
  Bool = "bool",
  Int = "int",
  Double = "double",
  String = "string",
  Any = "any",
}

export interface EvaluateParams {
  flagKey: string;
  valueType: ValueType;
  defaultValue: unknown;
  detail?: boolean;
}

export interface UserParams {
  key?: string;
  id?: string;
  email?: string;
  attributes?: Record<string, unknown>;
}

export interface IdentifyEventParams {
  user?: UserParams;
  context?: UserParams;
}

export interface CommandParams {
  command: CommandType;
  evaluate?: EvaluateParams;
  evaluateAll?: Record<string, never>;
  identifyEvent?: IdentifyEventParams;
  customEvent?: {
    eventKey: string;
    data?: unknown;
    metricValue?: number;
  };
  track?: TrackParams;
}

export interface SDKConfigParams {
  credential?: string;
  startWaitTimeMs?: number;
  initCanFail?: boolean;
  serviceEndpoints?: {
    polling?: string;
    streaming?: string;
  };
  polling?: {
    baseUri?: string;
    pollIntervalMs?: number;
  };
  streaming?: {
    baseUri?: string;
  };
  clientSide?: {
    initialUser?: UserParams;
    initialContext?: UserParams;
  };
}

export interface CreateInstanceParams {
  tag: string;
  configuration: SDKConfigParams;
}
