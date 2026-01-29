package io.rollgate;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Distributed tracing support for Rollgate SDK.
 */
public class Tracing {

    public static final String HEADER_TRACE_ID = "X-Trace-ID";
    public static final String HEADER_SPAN_ID = "X-Span-ID";
    public static final String HEADER_PARENT_SPAN_ID = "X-Parent-Span-ID";
    public static final String HEADER_REQUEST_ID = "X-Request-ID";
    public static final String HEADER_TRACEPARENT = "traceparent";

    private static final SecureRandom random = new SecureRandom();
    private static final DateTimeFormatter timestampFormatter = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");
    private static final Pattern TRACEPARENT_PATTERN = Pattern.compile(
        "^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$",
        Pattern.CASE_INSENSITIVE
    );

    /**
     * Trace context that travels with requests.
     */
    public static class TraceContext {
        private final String traceId;
        private final String spanId;
        private final String parentId;
        private final String requestId;
        private final boolean sampled;

        public TraceContext(String traceId, String spanId, String parentId, String requestId, boolean sampled) {
            this.traceId = traceId;
            this.spanId = spanId;
            this.parentId = parentId;
            this.requestId = requestId;
            this.sampled = sampled;
        }

        public String getTraceId() { return traceId; }
        public String getSpanId() { return spanId; }
        public String getParentId() { return parentId; }
        public String getRequestId() { return requestId; }
        public boolean isSampled() { return sampled; }

        /**
         * Create a child span from this context.
         */
        public TraceContext createChildSpan() {
            return new TraceContext(
                traceId,
                generateSpanId(),
                spanId,
                requestId,
                sampled
            );
        }

        /**
         * Get headers to inject into outgoing HTTP requests.
         */
        public Map<String, String> getHeaders() {
            Map<String, String> headers = new HashMap<>();
            headers.put(HEADER_TRACE_ID, traceId);
            headers.put(HEADER_SPAN_ID, spanId);
            headers.put(HEADER_REQUEST_ID, requestId);

            if (parentId != null && !parentId.isEmpty()) {
                headers.put(HEADER_PARENT_SPAN_ID, parentId);
            }

            // W3C Trace Context format
            String flags = sampled ? "01" : "00";
            headers.put(HEADER_TRACEPARENT, String.format("00-%s-%s-%s", traceId, spanId, flags));

            return headers;
        }

        @Override
        public String toString() {
            StringBuilder sb = new StringBuilder();
            sb.append("trace_id=").append(traceId);
            sb.append(" span_id=").append(spanId);
            if (parentId != null && !parentId.isEmpty()) {
                sb.append(" parent_id=").append(parentId);
            }
            sb.append(" request_id=").append(requestId);
            return sb.toString();
        }
    }

    /**
     * Request trace for timing and metadata.
     */
    public static class RequestTrace {
        private final String requestId;
        private final long startTime;
        private String serverTraceId;
        private long endTime;
        private long durationMs;
        private int statusCode;
        private Throwable error;

        public RequestTrace(String requestId) {
            this.requestId = requestId;
            this.startTime = System.currentTimeMillis();
        }

        public void complete(int statusCode, String serverTraceId, Throwable error) {
            this.endTime = System.currentTimeMillis();
            this.durationMs = endTime - startTime;
            this.statusCode = statusCode;
            this.serverTraceId = serverTraceId;
            this.error = error;
        }

        public String getRequestId() { return requestId; }
        public long getStartTime() { return startTime; }
        public long getEndTime() { return endTime; }
        public long getDurationMs() { return durationMs; }
        public int getStatusCode() { return statusCode; }
        public String getServerTraceId() { return serverTraceId; }
        public Throwable getError() { return error; }
    }

    /**
     * Generate a trace ID (32 hex characters).
     */
    public static String generateTraceId() {
        return randomHex(16);
    }

    /**
     * Generate a span ID (16 hex characters).
     */
    public static String generateSpanId() {
        return randomHex(8);
    }

    /**
     * Generate a human-readable request ID.
     * Format: rg-YYYYMMDDHHMMSS-RANDOM
     */
    public static String generateRequestId() {
        String timestamp = LocalDateTime.now().format(timestampFormatter);
        String randomPart = randomHex(4);
        return String.format("rg-%s-%s", timestamp, randomPart);
    }

    /**
     * Create a new trace context.
     */
    public static TraceContext createTraceContext() {
        return new TraceContext(
            generateTraceId(),
            generateSpanId(),
            null,
            generateRequestId(),
            true
        );
    }

    /**
     * Create a child trace context from a parent.
     */
    public static TraceContext createTraceContext(TraceContext parent) {
        if (parent == null) {
            return createTraceContext();
        }
        return parent.createChildSpan();
    }

    /**
     * Parse trace context from HTTP headers.
     */
    public static TraceContext parseHeaders(Map<String, String> headers) {
        String traceId = headers.get(HEADER_TRACE_ID);
        String spanId = headers.get(HEADER_SPAN_ID);
        String parentId = headers.get(HEADER_PARENT_SPAN_ID);
        String requestId = headers.get(HEADER_REQUEST_ID);
        boolean sampled = true;

        // Try to parse W3C traceparent if trace ID not present
        if (traceId == null || traceId.isEmpty()) {
            String traceparent = headers.get(HEADER_TRACEPARENT);
            if (traceparent != null) {
                TraceparentData parsed = parseTraceparent(traceparent);
                if (parsed != null) {
                    traceId = parsed.traceId;
                    spanId = parsed.spanId;
                    sampled = parsed.sampled;
                }
            }
        }

        if (traceId == null) traceId = generateTraceId();
        if (spanId == null) spanId = generateSpanId();
        if (requestId == null) requestId = generateRequestId();

        return new TraceContext(traceId, spanId, parentId, requestId, sampled);
    }

    /**
     * Parsed W3C traceparent data.
     */
    public static class TraceparentData {
        public final String traceId;
        public final String spanId;
        public final boolean sampled;

        public TraceparentData(String traceId, String spanId, boolean sampled) {
            this.traceId = traceId;
            this.spanId = spanId;
            this.sampled = sampled;
        }
    }

    /**
     * Parse W3C Trace Context traceparent header.
     */
    public static TraceparentData parseTraceparent(String header) {
        if (header == null) return null;

        Matcher matcher = TRACEPARENT_PATTERN.matcher(header.trim());
        if (!matcher.matches()) {
            return null;
        }

        String traceId = matcher.group(1).toLowerCase();
        String spanId = matcher.group(2).toLowerCase();
        boolean sampled = "01".equals(matcher.group(3));

        return new TraceparentData(traceId, spanId, sampled);
    }

    /**
     * Create a new request trace.
     */
    public static RequestTrace createRequestTrace(String requestId) {
        return new RequestTrace(requestId);
    }

    private static String randomHex(int bytes) {
        byte[] buffer = new byte[bytes];
        random.nextBytes(buffer);
        StringBuilder sb = new StringBuilder(bytes * 2);
        for (byte b : buffer) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
