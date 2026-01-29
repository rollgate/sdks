package io.rollgate;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

import java.util.HashMap;
import java.util.Map;

class TracingTest {

    @Test
    void testGenerateTraceId() {
        String traceId = Tracing.generateTraceId();
        assertEquals(32, traceId.length());
        assertTrue(traceId.matches("[0-9a-f]+"));
    }

    @Test
    void testGenerateSpanId() {
        String spanId = Tracing.generateSpanId();
        assertEquals(16, spanId.length());
        assertTrue(spanId.matches("[0-9a-f]+"));
    }

    @Test
    void testGenerateRequestId() {
        String requestId = Tracing.generateRequestId();
        assertTrue(requestId.startsWith("rg-"));
        assertTrue(requestId.length() > 20);
    }

    @Test
    void testCreateTraceContext() {
        Tracing.TraceContext ctx = Tracing.createTraceContext();
        assertEquals(32, ctx.getTraceId().length());
        assertEquals(16, ctx.getSpanId().length());
        assertNull(ctx.getParentId());
        assertTrue(ctx.getRequestId().startsWith("rg-"));
        assertTrue(ctx.isSampled());
    }

    @Test
    void testGetHeaders() {
        Tracing.TraceContext ctx = new Tracing.TraceContext(
            "a".repeat(32),
            "b".repeat(16),
            null,
            "rg-test",
            true
        );

        Map<String, String> headers = ctx.getHeaders();

        assertEquals("00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01",
            headers.get(Tracing.HEADER_TRACEPARENT));
        assertEquals("a".repeat(32), headers.get(Tracing.HEADER_TRACE_ID));
        assertEquals("b".repeat(16), headers.get(Tracing.HEADER_SPAN_ID));
        assertEquals("rg-test", headers.get(Tracing.HEADER_REQUEST_ID));
    }

    @Test
    void testGetHeadersNotSampled() {
        Tracing.TraceContext ctx = new Tracing.TraceContext(
            "a".repeat(32),
            "b".repeat(16),
            null,
            "rg-test",
            false
        );

        Map<String, String> headers = ctx.getHeaders();
        assertTrue(headers.get(Tracing.HEADER_TRACEPARENT).endsWith("-00"));
    }

    @Test
    void testCreateChildSpan() {
        Tracing.TraceContext parent = new Tracing.TraceContext(
            "a".repeat(32),
            "b".repeat(16),
            null,
            "rg-parent",
            true
        );

        Tracing.TraceContext child = parent.createChildSpan();

        assertEquals(parent.getTraceId(), child.getTraceId());
        assertNotEquals(parent.getSpanId(), child.getSpanId());
        assertEquals(parent.getSpanId(), child.getParentId());
        assertEquals(parent.getRequestId(), child.getRequestId());
    }

    @Test
    void testParseTraceparent() {
        String traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

        Tracing.TraceparentData data = Tracing.parseTraceparent(traceparent);

        assertNotNull(data);
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", data.traceId);
        assertEquals("00f067aa0ba902b7", data.spanId);
        assertTrue(data.sampled);
    }

    @Test
    void testParseTraceparentNotSampled() {
        String traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00";

        Tracing.TraceparentData data = Tracing.parseTraceparent(traceparent);

        assertNotNull(data);
        assertFalse(data.sampled);
    }

    @Test
    void testParseTraceparentInvalid() {
        assertNull(Tracing.parseTraceparent(""));
        assertNull(Tracing.parseTraceparent("invalid"));
        assertNull(Tracing.parseTraceparent("00-short-00f067aa0ba902b7-01"));
    }

    @Test
    void testParseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
        headers.put("X-Request-ID", "rg-custom");

        Tracing.TraceContext ctx = Tracing.parseHeaders(headers);

        assertNotNull(ctx);
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", ctx.getTraceId());
        assertEquals("rg-custom", ctx.getRequestId());
    }

    @Test
    void testParseHeadersCustom() {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Trace-ID", "a".repeat(32));
        headers.put("X-Span-ID", "b".repeat(16));
        headers.put("X-Request-ID", "rg-custom");

        Tracing.TraceContext ctx = Tracing.parseHeaders(headers);

        assertNotNull(ctx);
        assertEquals("a".repeat(32), ctx.getTraceId());
        assertEquals("rg-custom", ctx.getRequestId());
    }

    @Test
    void testParseHeadersEmpty() {
        // Empty headers should return a new context with generated IDs
        Tracing.TraceContext ctx = Tracing.parseHeaders(new HashMap<>());
        assertNotNull(ctx);
        assertEquals(32, ctx.getTraceId().length());
        assertEquals(16, ctx.getSpanId().length());
    }

    @Test
    void testRequestTrace() throws InterruptedException {
        Tracing.RequestTrace trace = Tracing.createRequestTrace("rg-test-123");

        Thread.sleep(10);
        trace.complete(200, null, null);

        assertTrue(trace.getDurationMs() >= 10);
        assertTrue(trace.getDurationMs() < 100);
        assertEquals(200, trace.getStatusCode());
        assertNull(trace.getError());
    }

    @Test
    void testRequestTraceWithServerTraceId() {
        Tracing.RequestTrace trace = new Tracing.RequestTrace("rg-test-456");
        trace.complete(200, "server-trace-id", null);

        assertEquals("server-trace-id", trace.getServerTraceId());
    }

    @Test
    void testRequestTraceWithError() {
        Tracing.RequestTrace trace = new Tracing.RequestTrace("rg-test-789");
        Exception error = new RuntimeException("Something went wrong");
        trace.complete(500, null, error);

        assertEquals(500, trace.getStatusCode());
        assertNotNull(trace.getError());
        assertEquals("Something went wrong", trace.getError().getMessage());
    }
}
