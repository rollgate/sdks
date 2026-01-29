/**
 * Distributed tracing support for Rollgate SDK (Browser version)
 *
 * This module provides request ID and trace context generation/propagation
 * for correlating requests across the client-server boundary.
 */

/**
 * Trace context that travels with requests
 */
export interface TraceContext {
  /** Unique trace ID for the entire operation */
  traceId: string;
  /** Span ID for this specific request */
  spanId: string;
  /** Parent span ID if this is a child span */
  parentId?: string;
  /** Human-readable request ID */
  requestId: string;
  /** Whether this trace is sampled */
  sampled: boolean;
}

/**
 * Headers used for trace propagation
 */
export const TraceHeaders = {
  TRACE_ID: 'X-Trace-ID',
  SPAN_ID: 'X-Span-ID',
  PARENT_SPAN_ID: 'X-Parent-Span-ID',
  REQUEST_ID: 'X-Request-ID',
  TRACEPARENT: 'traceparent',
} as const;

/**
 * Generate random hex string (browser-compatible)
 */
function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a trace ID (32 hex characters)
 */
export function generateTraceId(): string {
  return randomHex(16);
}

/**
 * Generate a span ID (16 hex characters)
 */
export function generateSpanId(): string {
  return randomHex(8);
}

/**
 * Generate a human-readable request ID
 * Format: sb-YYYYMMDDHHMMSS-RANDOM
 */
export function generateRequestId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const random = randomHex(4);
  return `sb-${timestamp}-${random}`;
}

/**
 * Create a new trace context
 */
export function createTraceContext(parentContext?: Partial<TraceContext>): TraceContext {
  const traceId = parentContext?.traceId || generateTraceId();
  const spanId = generateSpanId();
  const parentId = parentContext?.spanId;
  const requestId = parentContext?.requestId || generateRequestId();
  const sampled = parentContext?.sampled ?? true;

  return {
    traceId,
    spanId,
    parentId,
    requestId,
    sampled,
  };
}

/**
 * Create a child span from an existing context
 */
export function createChildSpan(parentContext: TraceContext): TraceContext {
  return {
    traceId: parentContext.traceId,
    spanId: generateSpanId(),
    parentId: parentContext.spanId,
    requestId: parentContext.requestId,
    sampled: parentContext.sampled,
  };
}

/**
 * Get headers to inject into outgoing HTTP requests
 */
export function getTraceHeaders(context: TraceContext): Record<string, string> {
  const headers: Record<string, string> = {};

  headers[TraceHeaders.TRACE_ID] = context.traceId;
  headers[TraceHeaders.SPAN_ID] = context.spanId;
  headers[TraceHeaders.REQUEST_ID] = context.requestId;

  if (context.parentId) {
    headers[TraceHeaders.PARENT_SPAN_ID] = context.parentId;
  }

  // W3C Trace Context format
  const flags = context.sampled ? '01' : '00';
  headers[TraceHeaders.TRACEPARENT] = `00-${context.traceId}-${context.spanId}-${flags}`;

  return headers;
}

/**
 * Parse trace context from incoming HTTP response headers
 */
export function parseTraceHeaders(headers: Headers): Partial<TraceContext> {
  const context: Partial<TraceContext> = {};

  const traceId = headers.get(TraceHeaders.TRACE_ID);
  if (traceId) context.traceId = traceId;

  const spanId = headers.get(TraceHeaders.SPAN_ID);
  if (spanId) context.spanId = spanId;

  const parentId = headers.get(TraceHeaders.PARENT_SPAN_ID);
  if (parentId) context.parentId = parentId;

  const requestId = headers.get(TraceHeaders.REQUEST_ID);
  if (requestId) context.requestId = requestId;

  // Also try to parse W3C traceparent
  const traceparent = headers.get(TraceHeaders.TRACEPARENT);
  if (traceparent && !context.traceId) {
    const parsed = parseTraceparent(traceparent);
    if (parsed) {
      context.traceId = parsed.traceId;
      context.spanId = parsed.spanId;
      context.sampled = parsed.sampled;
    }
  }

  return context;
}

/**
 * Parse W3C Trace Context traceparent header
 */
export function parseTraceparent(
  header: string
): { traceId: string; spanId: string; sampled: boolean } | null {
  const parts = header.split('-');
  if (parts.length !== 4) return null;

  const [version, traceId, spanId, flags] = parts;

  if (version !== '00') return null;
  if (!/^[0-9a-f]{32}$/i.test(traceId)) return null;
  if (!/^[0-9a-f]{16}$/i.test(spanId)) return null;

  return {
    traceId,
    spanId,
    sampled: flags === '01',
  };
}

/**
 * Format trace context as a string for logging
 */
export function formatTraceContext(context: TraceContext): string {
  const parts = [`trace_id=${context.traceId}`, `span_id=${context.spanId}`];

  if (context.parentId) {
    parts.push(`parent_id=${context.parentId}`);
  }

  parts.push(`request_id=${context.requestId}`);

  return parts.join(' ');
}

/**
 * Request trace information returned from API calls
 */
export interface RequestTrace {
  /** Client-generated request ID */
  requestId: string;
  /** Server-returned trace ID (if available) */
  serverTraceId?: string;
  /** Request start time */
  startTime: number;
  /** Request end time */
  endTime?: number;
  /** Request duration in milliseconds */
  durationMs?: number;
  /** HTTP status code */
  statusCode?: number;
  /** Error if request failed */
  error?: Error;
}

/**
 * Create a request trace for tracking
 */
export function createRequestTrace(requestId: string): RequestTrace {
  return {
    requestId,
    startTime: Date.now(),
  };
}

/**
 * Complete a request trace with response information
 */
export function completeRequestTrace(
  trace: RequestTrace,
  response?: { status: number; headers: Headers },
  error?: Error
): RequestTrace {
  trace.endTime = Date.now();
  trace.durationMs = trace.endTime - trace.startTime;

  if (response) {
    trace.statusCode = response.status;
    trace.serverTraceId = response.headers.get(TraceHeaders.TRACE_ID) || undefined;
  }

  if (error) {
    trace.error = error;
  }

  return trace;
}
