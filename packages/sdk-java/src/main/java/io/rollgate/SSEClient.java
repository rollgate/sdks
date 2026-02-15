package io.rollgate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * Server-Sent Events client for real-time flag updates.
 */
public class SSEClient implements AutoCloseable {

    private static final String SDK_NAME = "rollgate-java";
    private static final String SDK_VERSION = "1.1.0";

    private final Config config;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final ExecutorService executor;

    private final AtomicBoolean connected = new AtomicBoolean(false);
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicInteger reconnectCount = new AtomicInteger(0);

    private volatile UserContext user;
    private volatile Call currentCall;

    private Consumer<Map<String, Boolean>> onFlags;
    private Consumer<Throwable> onError;
    private Runnable onConnect;
    private Runnable onDisconnect;

    public SSEClient(Config config) {
        this.config = config;
        this.objectMapper = new ObjectMapper();

        this.httpClient = new OkHttpClient.Builder()
            .readTimeout(0, TimeUnit.MILLISECONDS) // No timeout for SSE
            .build();

        this.executor = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "rollgate-sse");
            t.setDaemon(true);
            return t;
        });
    }

    /**
     * Set callback for flag updates.
     */
    public void onFlags(Consumer<Map<String, Boolean>> callback) {
        this.onFlags = callback;
    }

    /**
     * Set callback for errors.
     */
    public void onError(Consumer<Throwable> callback) {
        this.onError = callback;
    }

    /**
     * Set callback for successful connections.
     */
    public void onConnect(Runnable callback) {
        this.onConnect = callback;
    }

    /**
     * Set callback for disconnections.
     */
    public void onDisconnect(Runnable callback) {
        this.onDisconnect = callback;
    }

    /**
     * Set user context.
     */
    public void setUser(UserContext user) {
        this.user = user;
    }

    /**
     * Start the SSE connection.
     */
    public void connect() {
        if (running.compareAndSet(false, true)) {
            executor.submit(this::connectLoop);
        }
    }

    /**
     * Check if currently connected.
     */
    public boolean isConnected() {
        return connected.get();
    }

    /**
     * Get reconnection count.
     */
    public int getReconnectCount() {
        return reconnectCount.get();
    }

    @Override
    public void close() {
        running.set(false);
        if (currentCall != null) {
            currentCall.cancel();
        }
        executor.shutdown();
        try {
            if (!executor.awaitTermination(5, TimeUnit.SECONDS)) {
                // Force shutdown if tasks don't terminate in time
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    private void connectLoop() {
        long backoffMs = 1000;
        long maxBackoffMs = 30000;

        while (running.get()) {
            try {
                doConnect();
                backoffMs = 1000; // Reset backoff on successful connection
            } catch (Exception e) {
                connected.set(false);
                reconnectCount.incrementAndGet();

                if (onError != null) {
                    onError.accept(e);
                }
                if (onDisconnect != null) {
                    onDisconnect.run();
                }

                if (!running.get()) {
                    break;
                }

                // Wait before reconnecting
                try {
                    Thread.sleep(backoffMs);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }

                // Exponential backoff
                backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
            }
        }
    }

    private void doConnect() throws IOException {
        HttpUrl.Builder urlBuilder = HttpUrl.parse(config.getSseUrl() + "/api/v1/sdk/stream").newBuilder();
        urlBuilder.addQueryParameter("token", config.getApiKey());

        UserContext currentUser = this.user;
        if (currentUser != null && currentUser.getId() != null) {
            urlBuilder.addQueryParameter("user_id", currentUser.getId());
        }

        Request request = new Request.Builder()
            .url(urlBuilder.build())
            .addHeader("Accept", "text/event-stream")
            .addHeader("Cache-Control", "no-cache")
            .addHeader("Connection", "keep-alive")
            .addHeader("X-SDK-Name", SDK_NAME)
            .addHeader("X-SDK-Version", SDK_VERSION)
            .build();

        currentCall = httpClient.newCall(request);
        try (Response response = currentCall.execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Unexpected status code: " + response.code());
            }

            connected.set(true);
            if (onConnect != null) {
                onConnect.run();
            }

            readEvents(response);
        }
    }

    private void readEvents(Response response) throws IOException {
        ResponseBody body = response.body();
        if (body == null) {
            throw new IOException("Empty response body");
        }

        try (BufferedReader reader = new BufferedReader(new InputStreamReader(body.byteStream()))) {
            SSEEvent event = new SSEEvent();
            String line;

            while (running.get() && (line = reader.readLine()) != null) {
                if (line.isEmpty()) {
                    // Empty line signals end of event
                    if (event.event != null || event.data != null) {
                        handleEvent(event);
                    }
                    event = new SSEEvent();
                    continue;
                }

                if (line.startsWith("event:")) {
                    event.event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    String data = line.substring(5).trim();
                    if (event.data == null) {
                        event.data = data;
                    } else {
                        event.data += "\n" + data;
                    }
                } else if (line.startsWith("id:")) {
                    event.id = line.substring(3).trim();
                } else if (line.startsWith("retry:")) {
                    try {
                        event.retry = Integer.parseInt(line.substring(6).trim());
                    } catch (NumberFormatException ignored) {}
                }
                // Ignore comments (lines starting with :)
            }
        }
    }

    private void handleEvent(SSEEvent event) {
        if (onFlags == null) {
            return;
        }

        try {
            switch (event.event) {
                case "init":
                case "flags":
                    // Full flags payload
                    JsonNode json = objectMapper.readTree(event.data);
                    JsonNode flagsNode = json.get("flags");
                    if (flagsNode != null && flagsNode.isObject()) {
                        Map<String, Boolean> flags = new HashMap<>();
                        flagsNode.fields().forEachRemaining(entry -> {
                            flags.put(entry.getKey(), entry.getValue().asBoolean());
                        });
                        onFlags.accept(flags);
                    }
                    break;

                case "flag-update":
                    // Single flag update
                    JsonNode updateJson = objectMapper.readTree(event.data);
                    String key = updateJson.get("key").asText();
                    boolean enabled = updateJson.get("enabled").asBoolean();
                    Map<String, Boolean> singleFlag = new HashMap<>();
                    singleFlag.put(key, enabled);
                    onFlags.accept(singleFlag);
                    break;

                case "flag-changed":
                    // Signal to refresh - handled by caller
                    break;
            }
        } catch (Exception e) {
            if (onError != null) {
                onError.accept(e);
            }
        }
    }

    /**
     * Parsed SSE event.
     */
    private static class SSEEvent {
        String event;
        String data;
        String id;
        int retry;
    }
}
