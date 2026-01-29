package io.rollgate;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

class CircuitBreakerTest {

    @Test
    void shouldStartInClosedState() {
        CircuitBreaker cb = new CircuitBreaker();
        assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
        assertTrue(cb.isAllowingRequests());
        assertEquals(0, cb.getFailureCount());
    }

    @Test
    void shouldPassThroughSuccessfulRequests() throws Exception {
        CircuitBreaker cb = new CircuitBreaker();

        String result = cb.execute(() -> "success");

        assertEquals("success", result);
        assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
    }

    @Test
    void shouldTrackFailures() {
        CircuitBreaker cb = new CircuitBreaker();

        try {
            cb.execute(() -> {
                throw new RuntimeException("failure");
            });
        } catch (Exception ignored) {}

        assertEquals(1, cb.getFailureCount());
    }

    @Test
    void shouldOpenAfterFailureThreshold() {
        Config.CircuitBreakerConfig config = new Config.CircuitBreakerConfig()
            .setFailureThreshold(3);
        CircuitBreaker cb = new CircuitBreaker(config);

        for (int i = 0; i < 3; i++) {
            try {
                cb.execute(() -> {
                    throw new RuntimeException("failure");
                });
            } catch (Exception ignored) {}
        }

        assertEquals(CircuitBreaker.State.OPEN, cb.getState());
    }

    @Test
    void shouldThrowCircuitOpenExceptionWhenOpen() {
        Config.CircuitBreakerConfig config = new Config.CircuitBreakerConfig()
            .setFailureThreshold(1)
            .setRecoveryTimeout(Duration.ofHours(1));
        CircuitBreaker cb = new CircuitBreaker(config);

        try {
            cb.execute(() -> {
                throw new RuntimeException("failure");
            });
        } catch (Exception ignored) {}

        assertEquals(CircuitBreaker.State.OPEN, cb.getState());

        assertThrows(CircuitBreaker.CircuitOpenException.class, () -> {
            cb.execute(() -> "success");
        });
    }

    @Test
    void shouldTransitionToHalfOpenAfterRecoveryTimeout() throws Exception {
        Config.CircuitBreakerConfig config = new Config.CircuitBreakerConfig()
            .setFailureThreshold(1)
            .setRecoveryTimeout(Duration.ofMillis(50));
        CircuitBreaker cb = new CircuitBreaker(config);

        try {
            cb.execute(() -> {
                throw new RuntimeException("failure");
            });
        } catch (Exception ignored) {}

        assertEquals(CircuitBreaker.State.OPEN, cb.getState());

        Thread.sleep(60);

        assertTrue(cb.isAllowingRequests());
    }

    @Test
    void shouldCloseAfterSuccessInHalfOpen() throws Exception {
        Config.CircuitBreakerConfig config = new Config.CircuitBreakerConfig()
            .setFailureThreshold(1)
            .setRecoveryTimeout(Duration.ofMillis(10))
            .setSuccessThreshold(1);
        CircuitBreaker cb = new CircuitBreaker(config);

        try {
            cb.execute(() -> {
                throw new RuntimeException("failure");
            });
        } catch (Exception ignored) {}

        Thread.sleep(20);

        cb.execute(() -> "success");

        assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
    }

    @Test
    void shouldReopenOnFailureInHalfOpen() throws Exception {
        Config.CircuitBreakerConfig config = new Config.CircuitBreakerConfig()
            .setFailureThreshold(1)
            .setRecoveryTimeout(Duration.ofMillis(10))
            .setSuccessThreshold(3);
        CircuitBreaker cb = new CircuitBreaker(config);

        try {
            cb.execute(() -> {
                throw new RuntimeException("failure");
            });
        } catch (Exception ignored) {}

        Thread.sleep(20);

        try {
            cb.execute(() -> {
                throw new RuntimeException("failure again");
            });
        } catch (Exception ignored) {}

        assertEquals(CircuitBreaker.State.OPEN, cb.getState());
    }

    @Test
    void forceResetShouldCloseCircuit() {
        Config.CircuitBreakerConfig config = new Config.CircuitBreakerConfig()
            .setFailureThreshold(1);
        CircuitBreaker cb = new CircuitBreaker(config);

        try {
            cb.execute(() -> {
                throw new RuntimeException("failure");
            });
        } catch (Exception ignored) {}

        assertEquals(CircuitBreaker.State.OPEN, cb.getState());

        cb.forceReset();

        assertEquals(CircuitBreaker.State.CLOSED, cb.getState());
        assertEquals(0, cb.getFailureCount());
    }

    @Test
    void forceOpenShouldOpenCircuit() {
        CircuitBreaker cb = new CircuitBreaker();

        cb.forceOpen();

        assertEquals(CircuitBreaker.State.OPEN, cb.getState());
    }
}
