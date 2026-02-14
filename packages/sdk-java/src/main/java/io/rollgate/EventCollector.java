package io.rollgate;

import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;

import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/**
 * Buffers and batches conversion events for A/B testing.
 */
public class EventCollector {

    private final String endpoint;
    private final String apiKey;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final int maxBufferSize;
    private final boolean enabled;

    private final List<Map<String, Object>> buffer = new ArrayList<>();
    private final Object lock = new Object();
    private ScheduledExecutorService scheduler;

    public EventCollector(String endpoint, String apiKey, OkHttpClient httpClient,
                          int flushIntervalMs, int maxBufferSize, boolean enabled) {
        this.endpoint = endpoint;
        this.apiKey = apiKey;
        this.httpClient = httpClient;
        this.objectMapper = new ObjectMapper();
        this.maxBufferSize = maxBufferSize;
        this.enabled = enabled;

        if (enabled && flushIntervalMs > 0) {
            scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "rollgate-events");
                t.setDaemon(true);
                return t;
            });
            scheduler.scheduleAtFixedRate(this::flushQuietly, flushIntervalMs, flushIntervalMs, TimeUnit.MILLISECONDS);
        }
    }

    /**
     * Track a conversion event.
     */
    public void track(TrackEventOptions options) {
        if (!enabled) return;

        Map<String, Object> event = new HashMap<>();
        event.put("flagKey", options.getFlagKey());
        event.put("eventName", options.getEventName());
        event.put("userId", options.getUserId());
        event.put("timestamp", Instant.now().toString());

        if (options.getVariationId() != null) event.put("variationId", options.getVariationId());
        if (options.getValue() != null) event.put("value", options.getValue());
        if (options.getMetadata() != null) event.put("metadata", options.getMetadata());

        boolean shouldFlush;
        synchronized (lock) {
            buffer.add(event);
            shouldFlush = buffer.size() >= maxBufferSize;
        }

        if (shouldFlush) {
            flushQuietly();
        }
    }

    /**
     * Flush all buffered events to the server.
     */
    public void flush() throws IOException {
        List<Map<String, Object>> events;
        synchronized (lock) {
            if (buffer.isEmpty()) return;
            events = new ArrayList<>(buffer);
            buffer.clear();
        }

        Map<String, Object> payload = new HashMap<>();
        payload.put("events", events);

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
                synchronized (lock) {
                    events.addAll(buffer);
                    buffer.clear();
                    buffer.addAll(events);
                    // Trim if too large
                    while (buffer.size() > maxBufferSize * 2) {
                        buffer.remove(0);
                    }
                }
                throw new IOException("Event flush failed with status " + response.code());
            }
        } catch (IOException e) {
            // Re-buffer on network error
            synchronized (lock) {
                events.addAll(buffer);
                buffer.clear();
                buffer.addAll(events);
                while (buffer.size() > maxBufferSize * 2) {
                    buffer.remove(0);
                }
            }
            throw e;
        }
    }

    /**
     * Get the current buffer size.
     */
    public int getBufferSize() {
        synchronized (lock) {
            return buffer.size();
        }
    }

    /**
     * Stop the collector and flush remaining events.
     */
    public void close() {
        if (scheduler != null) {
            scheduler.shutdown();
            try {
                scheduler.awaitTermination(2, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                scheduler.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
        flushQuietly();
    }

    private void flushQuietly() {
        try {
            flush();
        } catch (IOException ignored) {
        }
    }

    /**
     * Options for tracking a conversion event.
     */
    public static class TrackEventOptions {
        private final String flagKey;
        private final String eventName;
        private final String userId;
        private String variationId;
        private Double value;
        private Map<String, Object> metadata;

        public TrackEventOptions(String flagKey, String eventName, String userId) {
            this.flagKey = flagKey;
            this.eventName = eventName;
            this.userId = userId;
        }

        public String getFlagKey() { return flagKey; }
        public String getEventName() { return eventName; }
        public String getUserId() { return userId; }
        public String getVariationId() { return variationId; }
        public Double getValue() { return value; }
        public Map<String, Object> getMetadata() { return metadata; }

        public TrackEventOptions variationId(String variationId) {
            this.variationId = variationId;
            return this;
        }

        public TrackEventOptions value(double value) {
            this.value = value;
            return this;
        }

        public TrackEventOptions metadata(Map<String, Object> metadata) {
            this.metadata = metadata;
            return this;
        }
    }
}
