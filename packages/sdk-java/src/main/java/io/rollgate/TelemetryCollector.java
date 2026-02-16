package io.rollgate;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Collects and batches flag evaluation telemetry data.
 * Periodically flushes aggregated evaluation stats to the server.
 */
public class TelemetryCollector {

    private final String endpoint;
    private final String apiKey;
    private final long flushIntervalMs;
    private final int maxBufferSize;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    private final ConcurrentHashMap<String, TelemetryEvalStats> evaluations = new ConcurrentHashMap<>();
    private final AtomicBoolean isFlushing = new AtomicBoolean(false);
    private final AtomicInteger totalBuffered = new AtomicInteger(0);

    private ScheduledExecutorService scheduler;
    private long periodStartMs;

    public TelemetryCollector(String endpoint, String apiKey, long flushIntervalMs,
                              int maxBufferSize, OkHttpClient httpClient) {
        this.endpoint = endpoint;
        this.apiKey = apiKey;
        this.flushIntervalMs = flushIntervalMs;
        this.maxBufferSize = maxBufferSize;
        this.httpClient = httpClient;
        this.objectMapper = new ObjectMapper();
        this.periodStartMs = System.currentTimeMillis();
    }

    /**
     * Start the periodic flush scheduler.
     */
    public void start() {
        if (scheduler != null) {
            return;
        }

        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "rollgate-telemetry");
            t.setDaemon(true);
            return t;
        });

        scheduler.scheduleAtFixedRate(this::flushQuietly, flushIntervalMs, flushIntervalMs, TimeUnit.MILLISECONDS);
    }

    /**
     * Stop the collector and flush remaining telemetry.
     */
    public void stop() {
        if (scheduler != null) {
            scheduler.shutdown();
            try {
                if (!scheduler.awaitTermination(2, TimeUnit.SECONDS)) {
                    scheduler.shutdownNow();
                }
            } catch (InterruptedException e) {
                scheduler.shutdownNow();
                Thread.currentThread().interrupt();
            }
            scheduler = null;
        }
        flushQuietly();
    }

    /**
     * Record a flag evaluation result.
     *
     * @param flagKey The flag key that was evaluated
     * @param result  The evaluation result (true/false)
     */
    public void recordEvaluation(String flagKey, boolean result) {
        if (totalBuffered.get() >= maxBufferSize) {
            // Buffer full, drop oldest by flushing
            flushQuietly();
        }

        evaluations.compute(flagKey, (key, stats) -> {
            if (stats == null) {
                stats = new TelemetryEvalStats();
            }
            stats.record(result);
            return stats;
        });

        totalBuffered.incrementAndGet();
    }

    /**
     * Flush all buffered telemetry to the server.
     */
    public void flush() throws IOException {
        if (!isFlushing.compareAndSet(false, true)) {
            return;
        }

        try {
            if (evaluations.isEmpty()) {
                return;
            }

            // Snapshot and clear
            Map<String, TelemetryEvalStats> snapshot = new HashMap<>();
            for (Map.Entry<String, TelemetryEvalStats> entry : evaluations.entrySet()) {
                snapshot.put(entry.getKey(), entry.getValue().snapshot());
            }
            long periodMs = System.currentTimeMillis() - periodStartMs;

            evaluations.clear();
            totalBuffered.set(0);
            periodStartMs = System.currentTimeMillis();

            // Build payload
            Map<String, Object> evalPayload = new HashMap<>();
            for (Map.Entry<String, TelemetryEvalStats> entry : snapshot.entrySet()) {
                TelemetryEvalStats stats = entry.getValue();
                Map<String, Integer> flagStats = new HashMap<>();
                flagStats.put("total", stats.getTotal());
                flagStats.put("true", stats.getTrueCount());
                flagStats.put("false", stats.getFalseCount());
                evalPayload.put(entry.getKey(), flagStats);
            }

            Map<String, Object> payload = new HashMap<>();
            payload.put("evaluations", evalPayload);
            payload.put("period_ms", periodMs);

            String json = objectMapper.writeValueAsString(payload);

            Request request = new Request.Builder()
                .url(endpoint)
                .addHeader("Authorization", "Bearer " + apiKey)
                .addHeader("Content-Type", "application/json")
                .post(RequestBody.create(json, MediaType.parse("application/json")))
                .build();

            try (Response response = httpClient.newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    // Re-buffer on failure
                    for (Map.Entry<String, TelemetryEvalStats> entry : snapshot.entrySet()) {
                        evaluations.merge(entry.getKey(), entry.getValue(), TelemetryEvalStats::merge);
                    }
                    int recount = 0;
                    for (TelemetryEvalStats s : evaluations.values()) {
                        recount += s.getTotal();
                    }
                    totalBuffered.set(recount);
                    throw new IOException("Telemetry flush failed with status " + response.code());
                }
            } catch (IOException e) {
                // Re-buffer on network error (if not already re-buffered)
                if (evaluations.isEmpty()) {
                    for (Map.Entry<String, TelemetryEvalStats> entry : snapshot.entrySet()) {
                        evaluations.merge(entry.getKey(), entry.getValue(), TelemetryEvalStats::merge);
                    }
                    int recount = 0;
                    for (TelemetryEvalStats s : evaluations.values()) {
                        recount += s.getTotal();
                    }
                    totalBuffered.set(recount);
                }
                throw e;
            }
        } finally {
            isFlushing.set(false);
        }
    }

    /**
     * Get buffer statistics.
     *
     * @return int array where [0] = number of distinct flags, [1] = total evaluation count
     */
    public int[] getBufferStats() {
        return new int[]{evaluations.size(), totalBuffered.get()};
    }

    private void flushQuietly() {
        try {
            flush();
        } catch (IOException ignored) {
        }
    }

    /**
     * Aggregated evaluation statistics for a single flag.
     */
    static class TelemetryEvalStats {
        private int total;
        private int trueCount;
        private int falseCount;

        TelemetryEvalStats() {
            this.total = 0;
            this.trueCount = 0;
            this.falseCount = 0;
        }

        TelemetryEvalStats(int total, int trueCount, int falseCount) {
            this.total = total;
            this.trueCount = trueCount;
            this.falseCount = falseCount;
        }

        synchronized void record(boolean result) {
            total++;
            if (result) {
                trueCount++;
            } else {
                falseCount++;
            }
        }

        synchronized int getTotal() {
            return total;
        }

        synchronized int getTrueCount() {
            return trueCount;
        }

        synchronized int getFalseCount() {
            return falseCount;
        }

        synchronized TelemetryEvalStats snapshot() {
            return new TelemetryEvalStats(total, trueCount, falseCount);
        }

        static TelemetryEvalStats merge(TelemetryEvalStats a, TelemetryEvalStats b) {
            return new TelemetryEvalStats(
                a.getTotal() + b.getTotal(),
                a.getTrueCount() + b.getTrueCount(),
                a.getFalseCount() + b.getFalseCount()
            );
        }
    }
}
