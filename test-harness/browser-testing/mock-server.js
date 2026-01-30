/**
 * Simple mock Rollgate API server for testing.
 */
import http from "http";

const FLAGS = {
  "test-flag": { key: "test-flag", enabled: true, rolloutPercentage: 100 },
  "enabled-flag": {
    key: "enabled-flag",
    enabled: true,
    rolloutPercentage: 100,
  },
  "disabled-flag": {
    key: "disabled-flag",
    enabled: false,
    rolloutPercentage: 0,
  },
};

const server = http.createServer((req, res) => {
  // CORS headers - allow all headers for testing
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || "/";
  console.log(`[mock] ${req.method} ${url}`);

  // GET /v1/flags - Return all flags
  if (url.startsWith("/v1/flags") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ flags: FLAGS }));
    return;
  }

  // GET /api/v1/sdk/flags - Browser SDK flags endpoint
  if (url.startsWith("/api/v1/sdk/flags") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ flags: FLAGS }));
    return;
  }

  // GET /sdk/eval - Browser SDK eval endpoint
  if (url.startsWith("/sdk/eval") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ flags: FLAGS }));
    return;
  }

  // POST /v1/identify - Identify user
  if (url === "/v1/identify" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Default 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

const PORT = 9000;
server.listen(PORT, () => {
  console.log(
    `[mock] Rollgate mock server running on http://localhost:${PORT}`,
  );
});
