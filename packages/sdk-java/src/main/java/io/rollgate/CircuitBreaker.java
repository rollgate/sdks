package io.rollgate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.BiConsumer;
import java.util.function.Supplier;

/**
 * Circuit breaker implementation for fault tolerance.
 */
public class CircuitBreaker {

    public enum State {
        CLOSED, OPEN, HALF_OPEN
    }

    private final Config.CircuitBreakerConfig config;
    private final ReentrantLock lock = new ReentrantLock();

    private State state = State.CLOSED;
    private final List<Instant> failures = new ArrayList<>();
    private Instant openedAt;
    private int halfOpenSuccesses = 0;

    private BiConsumer<State, State> onStateChange;

    public CircuitBreaker() {
        this(new Config.CircuitBreakerConfig());
    }

    public CircuitBreaker(Config.CircuitBreakerConfig config) {
        this.config = config;
    }

    public <T> T execute(Supplier<T> action) throws Exception {
        if (!isAllowingRequests()) {
            throw new CircuitOpenException("Circuit breaker is open");
        }

        lock.lock();
        try {
            if (state == State.OPEN) {
                transitionTo(State.HALF_OPEN);
            }
        } finally {
            lock.unlock();
        }

        try {
            T result = action.get();
            recordSuccess();
            return result;
        } catch (Exception e) {
            recordFailure();
            throw e;
        }
    }

    public boolean isAllowingRequests() {
        lock.lock();
        try {
            switch (state) {
                case CLOSED:
                case HALF_OPEN:
                    return true;
                case OPEN:
                    if (openedAt != null) {
                        Duration elapsed = Duration.between(openedAt, Instant.now());
                        return elapsed.compareTo(config.getRecoveryTimeout()) > 0;
                    }
                    return false;
                default:
                    return true;
            }
        } finally {
            lock.unlock();
        }
    }

    public State getState() {
        lock.lock();
        try {
            return state;
        } finally {
            lock.unlock();
        }
    }

    public void forceOpen() {
        lock.lock();
        try {
            transitionTo(State.OPEN);
        } finally {
            lock.unlock();
        }
    }

    public void forceReset() {
        lock.lock();
        try {
            failures.clear();
            halfOpenSuccesses = 0;
            transitionTo(State.CLOSED);
        } finally {
            lock.unlock();
        }
    }

    public void onStateChange(BiConsumer<State, State> listener) {
        this.onStateChange = listener;
    }

    public int getFailureCount() {
        lock.lock();
        try {
            cleanOldFailures();
            return failures.size();
        } finally {
            lock.unlock();
        }
    }

    private void recordSuccess() {
        lock.lock();
        try {
            if (state == State.HALF_OPEN) {
                halfOpenSuccesses++;
                if (halfOpenSuccesses >= config.getSuccessThreshold()) {
                    transitionTo(State.CLOSED);
                }
            }
        } finally {
            lock.unlock();
        }
    }

    private void recordFailure() {
        lock.lock();
        try {
            failures.add(Instant.now());
            cleanOldFailures();

            if (state == State.HALF_OPEN) {
                transitionTo(State.OPEN);
                return;
            }

            if (failures.size() >= config.getFailureThreshold()) {
                transitionTo(State.OPEN);
            }
        } finally {
            lock.unlock();
        }
    }

    private void transitionTo(State newState) {
        if (state == newState) {
            return;
        }

        State oldState = state;
        state = newState;

        if (newState == State.OPEN) {
            openedAt = Instant.now();
        }

        if (newState == State.CLOSED) {
            failures.clear();
            halfOpenSuccesses = 0;
        }

        if (newState == State.HALF_OPEN) {
            halfOpenSuccesses = 0;
        }

        if (onStateChange != null) {
            onStateChange.accept(oldState, newState);
        }
    }

    private void cleanOldFailures() {
        Instant cutoff = Instant.now().minus(config.getMonitoringWindow());
        failures.removeIf(f -> f.isBefore(cutoff));
    }

    /**
     * Exception thrown when circuit is open.
     */
    public static class CircuitOpenException extends RuntimeException {
        public CircuitOpenException(String message) {
            super(message);
        }
    }
}
