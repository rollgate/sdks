package io.rollgate.testservice;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import io.rollgate.RollgateClient;
import io.rollgate.Config;
import io.rollgate.UserContext;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;

/**
 * Test Service for rollgate Java SDK
 *
 * This HTTP server wraps the RollgateClient and exposes a standard interface
 * for the test harness to interact with.
 */
public class Main {
    private static RollgateClient client = null;
    private static final Gson gson = new Gson();
    private static String currentBaseUrl = null;
    private static String currentApiKey = null;

    /**
     * Notify mock server about user context for remote evaluation.
     */
    private static void notifyMockIdentify(JsonObject userObj, String apiKey) {
        if (currentBaseUrl == null || apiKey == null) return;

        try {
            java.net.URL url = new java.net.URL(currentBaseUrl + "/api/v1/sdk/identify");
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + apiKey);
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);

            JsonObject body = new JsonObject();
            body.add("user", userObj);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(gson.toJson(body).getBytes(StandardCharsets.UTF_8));
            }

            conn.getResponseCode(); // Trigger the request
            conn.disconnect();
        } catch (Exception e) {
            // Ignore errors - mock might not support identify
        }
    }

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8008"));

        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", new MainHandler());
        server.setExecutor(null);

        System.out.println("[sdk-java test-service] Listening on port " + port);
        server.start();

        // Handle shutdown
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("[sdk-java test-service] Shutting down...");
            if (client != null) {
                client.close();
            }
            server.stop(0);
        }));
    }

    static class MainHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod();

            try {
                if ("GET".equals(method)) {
                    sendResponse(exchange, 200, "{\"success\":true}");
                } else if ("POST".equals(method)) {
                    String body = readRequestBody(exchange);
                    JsonObject cmd = gson.fromJson(body, JsonObject.class);
                    JsonObject result = handleCommand(cmd);
                    sendResponse(exchange, 200, gson.toJson(result));
                } else if ("DELETE".equals(method)) {
                    if (client != null) {
                        client.close();
                        client = null;
                    }
                    sendResponse(exchange, 200, "{\"success\":true}");
                } else {
                    exchange.sendResponseHeaders(405, -1);
                }
            } catch (Exception e) {
                JsonObject error = new JsonObject();
                error.addProperty("error", "ParseError");
                error.addProperty("message", e.getMessage());
                sendResponse(exchange, 400, gson.toJson(error));
            }
        }

        private String readRequestBody(HttpExchange exchange) throws IOException {
            try (InputStream is = exchange.getRequestBody();
                 BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                return sb.toString();
            }
        }

        private void sendResponse(HttpExchange exchange, int statusCode, String response) throws IOException {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(statusCode, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }

        private JsonObject handleCommand(JsonObject cmd) {
            String command = cmd.has("command") ? cmd.get("command").getAsString() : "";
            JsonObject response = new JsonObject();

            switch (command) {
                case "init":
                    return handleInit(cmd);
                case "isEnabled":
                    return handleIsEnabled(cmd);
                case "getString":
                    return handleGetString(cmd);
                case "getNumber":
                    return handleGetNumber(cmd);
                case "getJson":
                    return handleGetJson(cmd);
                case "identify":
                    return handleIdentify(cmd);
                case "reset":
                    return handleReset(cmd);
                case "getAllFlags":
                    return handleGetAllFlags(cmd);
                case "getState":
                    return handleGetState(cmd);
                case "close":
                    return handleClose(cmd);
                default:
                    response.addProperty("error", "UnknownCommand");
                    response.addProperty("message", "Unknown command: " + command);
                    return response;
            }
        }

        private JsonObject handleInit(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (!cmd.has("config") || cmd.get("config").isJsonNull()) {
                response.addProperty("error", "ValidationError");
                response.addProperty("message", "config is required");
                return response;
            }

            // Cleanup previous instance
            if (client != null) {
                client.close();
                client = null;
            }

            try {
                JsonObject configObj = cmd.getAsJsonObject("config");
                String apiKey = configObj.get("apiKey").getAsString();
                String baseUrl = configObj.has("baseUrl") ? configObj.get("baseUrl").getAsString() : "https://api.rollgate.io";

                // Store for notifyMockIdentify
                currentBaseUrl = baseUrl;
                currentApiKey = apiKey;
                int refreshInterval = configObj.has("refreshInterval") ? configObj.get("refreshInterval").getAsInt() : 0;
                boolean enableStreaming = configObj.has("enableStreaming") && configObj.get("enableStreaming").getAsBoolean();
                int timeout = configObj.has("timeout") ? configObj.get("timeout").getAsInt() : 5000;

                Config config = new Config(apiKey)
                    .setBaseUrl(baseUrl)
                    .setTimeout(Duration.ofMillis(timeout))
                    .setRefreshInterval(Duration.ofMillis(refreshInterval))
                    .setEnableStreaming(enableStreaming);

                client = new RollgateClient(config);

                // Handle user context
                if (cmd.has("user") && !cmd.get("user").isJsonNull()) {
                    JsonObject userObj = cmd.getAsJsonObject("user");

                    // Notify mock about user context before init (for remote evaluation)
                    notifyMockIdentify(userObj, apiKey);

                    UserContext.Builder userBuilder = UserContext.builder(userObj.get("id").getAsString());

                    if (userObj.has("email") && !userObj.get("email").isJsonNull()) {
                        userBuilder.email(userObj.get("email").getAsString());
                    }

                    if (userObj.has("attributes") && !userObj.get("attributes").isJsonNull()) {
                        JsonObject attrs = userObj.getAsJsonObject("attributes");
                        for (String key : attrs.keySet()) {
                            userBuilder.attribute(key, attrs.get(key).getAsString());
                        }
                    }

                    client.identify(userBuilder.build());
                }

                client.initialize();

                response.addProperty("success", true);
            } catch (Exception e) {
                response.addProperty("error", e.getClass().getSimpleName());
                response.addProperty("message", e.getMessage());
            }

            return response;
        }

        private JsonObject handleIsEnabled(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client == null) {
                response.addProperty("error", "NotInitializedError");
                response.addProperty("message", "Client not initialized");
                return response;
            }

            if (!cmd.has("flagKey") || cmd.get("flagKey").isJsonNull()) {
                response.addProperty("error", "ValidationError");
                response.addProperty("message", "flagKey is required");
                return response;
            }

            String flagKey = cmd.get("flagKey").getAsString();
            boolean defaultValue = cmd.has("defaultValue") && cmd.get("defaultValue").getAsBoolean();
            boolean value = client.isEnabled(flagKey, defaultValue);

            response.addProperty("value", value);
            return response;
        }

        private JsonObject handleGetString(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client == null) {
                response.addProperty("error", "NotInitializedError");
                response.addProperty("message", "Client not initialized");
                return response;
            }

            if (!cmd.has("flagKey") || cmd.get("flagKey").isJsonNull()) {
                response.addProperty("error", "ValidationError");
                response.addProperty("message", "flagKey is required");
                return response;
            }

            // Java SDK doesn't have getString yet - return default
            String defaultValue = cmd.has("defaultStringValue") ? cmd.get("defaultStringValue").getAsString() : "";
            response.addProperty("stringValue", defaultValue);
            return response;
        }

        private JsonObject handleGetNumber(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client == null) {
                response.addProperty("error", "NotInitializedError");
                response.addProperty("message", "Client not initialized");
                return response;
            }

            if (!cmd.has("flagKey") || cmd.get("flagKey").isJsonNull()) {
                response.addProperty("error", "ValidationError");
                response.addProperty("message", "flagKey is required");
                return response;
            }

            // Java SDK doesn't have getNumber yet - return default
            double defaultValue = cmd.has("defaultNumberValue") ? cmd.get("defaultNumberValue").getAsDouble() : 0;
            response.addProperty("numberValue", defaultValue);
            return response;
        }

        private JsonObject handleGetJson(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client == null) {
                response.addProperty("error", "NotInitializedError");
                response.addProperty("message", "Client not initialized");
                return response;
            }

            if (!cmd.has("flagKey") || cmd.get("flagKey").isJsonNull()) {
                response.addProperty("error", "ValidationError");
                response.addProperty("message", "flagKey is required");
                return response;
            }

            // Java SDK doesn't have getJSON yet - return default
            if (cmd.has("defaultJsonValue")) {
                response.add("jsonValue", cmd.get("defaultJsonValue"));
            } else {
                response.add("jsonValue", null);
            }
            return response;
        }

        private JsonObject handleIdentify(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client == null) {
                response.addProperty("error", "NotInitializedError");
                response.addProperty("message", "Client not initialized");
                return response;
            }

            if (!cmd.has("user") || cmd.get("user").isJsonNull()) {
                response.addProperty("error", "ValidationError");
                response.addProperty("message", "user is required");
                return response;
            }

            try {
                JsonObject userObj = cmd.getAsJsonObject("user");

                // Notify mock about user context before identify (for remote evaluation)
                if (currentApiKey != null) {
                    notifyMockIdentify(userObj, currentApiKey);
                }

                UserContext.Builder userBuilder = UserContext.builder(userObj.get("id").getAsString());

                if (userObj.has("email") && !userObj.get("email").isJsonNull()) {
                    userBuilder.email(userObj.get("email").getAsString());
                }

                if (userObj.has("attributes") && !userObj.get("attributes").isJsonNull()) {
                    JsonObject attrs = userObj.getAsJsonObject("attributes");
                    for (String key : attrs.keySet()) {
                        userBuilder.attribute(key, attrs.get(key).getAsString());
                    }
                }

                client.identify(userBuilder.build());
                response.addProperty("success", true);
            } catch (Exception e) {
                response.addProperty("error", e.getClass().getSimpleName());
                response.addProperty("message", e.getMessage());
            }

            return response;
        }

        private JsonObject handleReset(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client == null) {
                response.addProperty("error", "NotInitializedError");
                response.addProperty("message", "Client not initialized");
                return response;
            }

            try {
                client.reset();
                response.addProperty("success", true);
            } catch (Exception e) {
                response.addProperty("error", e.getClass().getSimpleName());
                response.addProperty("message", e.getMessage());
            }

            return response;
        }

        private JsonObject handleGetAllFlags(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client == null) {
                response.addProperty("error", "NotInitializedError");
                response.addProperty("message", "Client not initialized");
                return response;
            }

            Map<String, Boolean> flags = client.getAllFlags();
            JsonObject flagsObj = new JsonObject();
            for (Map.Entry<String, Boolean> entry : flags.entrySet()) {
                flagsObj.addProperty(entry.getKey(), entry.getValue());
            }
            response.add("flags", flagsObj);
            return response;
        }

        private JsonObject handleGetState(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client == null) {
                response.addProperty("isReady", false);
                response.addProperty("circuitState", "UNKNOWN");
                return response;
            }

            response.addProperty("isReady", client.isReady());
            response.addProperty("circuitState", client.getCircuitState().toString().toLowerCase());

            Map<String, Long> cacheStats = client.getCacheStats();
            JsonObject stats = new JsonObject();
            stats.addProperty("hits", cacheStats.getOrDefault("hits", 0L));
            stats.addProperty("misses", cacheStats.getOrDefault("misses", 0L));
            response.add("cacheStats", stats);

            return response;
        }

        private JsonObject handleClose(JsonObject cmd) {
            JsonObject response = new JsonObject();

            if (client != null) {
                client.close();
                client = null;
            }

            response.addProperty("success", true);
            return response;
        }
    }
}
