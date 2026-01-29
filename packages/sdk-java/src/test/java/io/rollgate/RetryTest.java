package io.rollgate;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;

class RetryTest {

    @Test
    void shouldSucceedOnFirstAttempt() {
        Retry retry = new Retry();

        Retry.RetryResult<String> result = retry.execute(() -> "success");

        assertTrue(result.isSuccess());
        assertEquals("success", result.getData());
        assertNull(result.getError());
        assertEquals(1, result.getAttempts());
    }

    @Test
    void shouldRetryOnRetryableError() {
        Config.RetryConfig config = new Config.RetryConfig()
            .setMaxRetries(3)
            .setBaseDelay(Duration.ofMillis(10));
        Retry retry = new Retry(config);

        AtomicInteger attempts = new AtomicInteger(0);

        Retry.RetryResult<String> result = retry.execute(() -> {
            if (attempts.incrementAndGet() < 3) {
                throw new RuntimeException("connection timeout");
            }
            return "success";
        });

        assertTrue(result.isSuccess());
        assertEquals("success", result.getData());
        assertEquals(3, result.getAttempts());
    }

    @Test
    void shouldNotRetryOnNonRetryableError() {
        Config.RetryConfig config = new Config.RetryConfig()
            .setMaxRetries(3)
            .setBaseDelay(Duration.ofMillis(10));
        Retry retry = new Retry(config);

        AtomicInteger attempts = new AtomicInteger(0);

        Retry.RetryResult<String> result = retry.execute(() -> {
            attempts.incrementAndGet();
            throw new RuntimeException("invalid input");
        });

        assertFalse(result.isSuccess());
        assertEquals(1, result.getAttempts());
        assertNotNull(result.getError());
    }

    @Test
    void shouldExhaustRetries() {
        Config.RetryConfig config = new Config.RetryConfig()
            .setMaxRetries(2)
            .setBaseDelay(Duration.ofMillis(10));
        Retry retry = new Retry(config);

        AtomicInteger attempts = new AtomicInteger(0);

        Retry.RetryResult<String> result = retry.execute(() -> {
            attempts.incrementAndGet();
            throw new RuntimeException("connection refused");
        });

        assertFalse(result.isSuccess());
        assertEquals(3, result.getAttempts()); // initial + 2 retries
        assertNotNull(result.getError());
    }

    @Test
    void shouldCalculateExponentialBackoff() {
        Config.RetryConfig config = new Config.RetryConfig()
            .setBaseDelay(Duration.ofMillis(100))
            .setMaxDelay(Duration.ofSeconds(10))
            .setJitterFactor(0);
        Retry retry = new Retry(config);

        Duration delay0 = retry.calculateBackoff(0);
        Duration delay1 = retry.calculateBackoff(1);
        Duration delay2 = retry.calculateBackoff(2);
        Duration delay3 = retry.calculateBackoff(3);

        assertEquals(100, delay0.toMillis());
        assertEquals(200, delay1.toMillis());
        assertEquals(400, delay2.toMillis());
        assertEquals(800, delay3.toMillis());
    }

    @Test
    void shouldCapAtMaxDelay() {
        Config.RetryConfig config = new Config.RetryConfig()
            .setBaseDelay(Duration.ofMillis(100))
            .setMaxDelay(Duration.ofMillis(500))
            .setJitterFactor(0);
        Retry retry = new Retry(config);

        Duration delay5 = retry.calculateBackoff(5); // would be 3200ms

        assertEquals(500, delay5.toMillis());
    }

    @Test
    void shouldApplyJitter() {
        Config.RetryConfig config = new Config.RetryConfig()
            .setBaseDelay(Duration.ofMillis(100))
            .setMaxDelay(Duration.ofSeconds(10))
            .setJitterFactor(0.5);
        Retry retry = new Retry(config);

        // Run multiple times to verify jitter produces variation
        boolean hasVariation = false;
        long firstValue = retry.calculateBackoff(2).toMillis();

        for (int i = 0; i < 20; i++) {
            long value = retry.calculateBackoff(2).toMillis();
            if (value != firstValue) {
                hasVariation = true;
                break;
            }
        }

        assertTrue(hasVariation, "Jitter should produce variation in delay values");
    }

    @Test
    void isRetryableShouldReturnTrueForTimeouts() {
        assertTrue(Retry.isRetryable(new RuntimeException("connection timeout")));
        assertTrue(Retry.isRetryable(new RuntimeException("request timed out")));
        assertTrue(Retry.isRetryable(new RuntimeException("Connection timed out")));
    }

    @Test
    void isRetryableShouldReturnTrueForConnectionErrors() {
        assertTrue(Retry.isRetryable(new RuntimeException("connection refused")));
        assertTrue(Retry.isRetryable(new RuntimeException("connection reset")));
        assertTrue(Retry.isRetryable(new RuntimeException("no route to host")));
        assertTrue(Retry.isRetryable(new RuntimeException("network is unreachable")));
    }

    @Test
    void isRetryableShouldReturnTrueForServerErrors() {
        assertTrue(Retry.isRetryable(new RuntimeException("Server error: 500")));
        assertTrue(Retry.isRetryable(new RuntimeException("Server error: 502")));
        assertTrue(Retry.isRetryable(new RuntimeException("Server error: 503")));
        assertTrue(Retry.isRetryable(new RuntimeException("Server error: 504")));
    }

    @Test
    void isRetryableShouldReturnTrueForRateLimiting() {
        assertTrue(Retry.isRetryable(new RuntimeException("429 Too Many Requests")));
        assertTrue(Retry.isRetryable(new RuntimeException("too many requests")));
    }

    @Test
    void isRetryableShouldReturnFalseForClientErrors() {
        assertFalse(Retry.isRetryable(new RuntimeException("invalid input")));
        assertFalse(Retry.isRetryable(new RuntimeException("unauthorized")));
        assertFalse(Retry.isRetryable(new RuntimeException("not found")));
    }

    @Test
    void isRetryableShouldReturnFalseForNull() {
        assertFalse(Retry.isRetryable(null));
    }

    @Test
    void isRetryableShouldReturnFalseForNullMessage() {
        assertFalse(Retry.isRetryable(new RuntimeException((String) null)));
    }
}
