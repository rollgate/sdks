package io.rollgate;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ErrorsTest {

    @Test
    void testRollgateError() {
        Errors.RollgateError error = new Errors.RollgateError(
            "Test error",
            Errors.ErrorCategory.UNKNOWN,
            true
        );

        assertEquals("Test error", error.getMessage());
        assertTrue(error.isRetryable());
        assertEquals(Errors.ErrorCategory.UNKNOWN, error.getCategory());
    }

    @Test
    void testAuthenticationError() {
        Errors.AuthenticationError error = new Errors.AuthenticationError("Invalid token");

        assertEquals("Invalid token", error.getMessage());
        assertFalse(error.isRetryable());
        assertEquals(Errors.ErrorCategory.AUTHENTICATION, error.getCategory());
    }

    @Test
    void testNetworkError() {
        Errors.NetworkError error = new Errors.NetworkError("Connection timeout");

        assertEquals("Connection timeout", error.getMessage());
        assertTrue(error.isRetryable());
        assertEquals(Errors.ErrorCategory.NETWORK, error.getCategory());
    }

    @Test
    void testRateLimitError() {
        Errors.RateLimitError error = new Errors.RateLimitError("Too many requests", 60000);

        assertEquals("Too many requests", error.getMessage());
        assertTrue(error.isRetryable());
        assertEquals(60000, error.getRetryAfterMs());
        assertEquals(Errors.ErrorCategory.RATE_LIMIT, error.getCategory());
    }

    @Test
    void testValidationError() {
        Errors.ValidationError error = new Errors.ValidationError("Invalid flag key");

        assertEquals("Invalid flag key", error.getMessage());
        assertFalse(error.isRetryable());
        assertEquals(Errors.ErrorCategory.VALIDATION, error.getCategory());
    }

    @Test
    void testServerError() {
        Errors.ServerError error = new Errors.ServerError("Internal server error", 500);

        assertEquals("Internal server error", error.getMessage());
        assertEquals(500, error.getStatusCode());
        assertTrue(error.isRetryable());
        assertEquals(Errors.ErrorCategory.SERVER, error.getCategory());
    }

    @Test
    void testCircuitOpenError() {
        Errors.CircuitOpenError error = new Errors.CircuitOpenError("Circuit is open");

        assertEquals("Circuit is open", error.getMessage());
        assertTrue(error.isRetryable());
        assertEquals(Errors.ErrorCategory.NETWORK, error.getCategory());
    }

    @Test
    void testIsRetryableWithRollgateError() {
        Errors.NetworkError networkError = new Errors.NetworkError("Connection failed");
        Errors.AuthenticationError authError = new Errors.AuthenticationError("Invalid token");

        assertTrue(Errors.isRetryable(networkError));
        assertFalse(Errors.isRetryable(authError));
    }

    @Test
    void testIsRetryableWithJavaExceptions() {
        assertTrue(Errors.isRetryable(new java.net.ConnectException("Connection refused")));
        assertTrue(Errors.isRetryable(new java.net.SocketTimeoutException("Read timed out")));
        assertTrue(Errors.isRetryable(new java.io.IOException("IO error")));
        assertFalse(Errors.isRetryable(new RuntimeException("Unknown error")));
    }

    @Test
    void testFromStatusCode() {
        Errors.RollgateError error401 = Errors.fromStatusCode(401, "Unauthorized");
        assertInstanceOf(Errors.AuthenticationError.class, error401);

        Errors.RollgateError error403 = Errors.fromStatusCode(403, "Forbidden");
        assertInstanceOf(Errors.AuthenticationError.class, error403);

        Errors.RollgateError error429 = Errors.fromStatusCode(429, "Rate limited");
        assertInstanceOf(Errors.RateLimitError.class, error429);

        Errors.RollgateError error500 = Errors.fromStatusCode(500, "Server error");
        assertInstanceOf(Errors.ServerError.class, error500);

        Errors.RollgateError error400 = Errors.fromStatusCode(400, "Bad request");
        assertInstanceOf(Errors.ValidationError.class, error400);
    }
}
