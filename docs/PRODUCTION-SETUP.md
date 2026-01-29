# Production Setup

Best practices for deploying Rollgate SDKs in production environments.

## Architecture Patterns

### Direct Connection (Small Scale)

For applications with fewer than 10,000 concurrent users:

```
Browser/Client ──> Rollgate API
```

```typescript
// React/Vue/Angular/Svelte
const config = {
  apiKey: "sb_client_your_key",
  refreshInterval: 60000, // Poll every minute
};
```

### Proxy Pattern (Recommended for Scale)

For production applications with many users:

```
Browser ──> Your Backend (sdk-node/go/java/python) ──> Rollgate
```

Benefits:

- **Security**: API keys never exposed to browsers
- **Scalability**: 1 server connection instead of N client connections
- **Resilience**: Server caches flags, works if Rollgate is down
- **Cost**: Reduces API calls to Rollgate

#### Backend (Node.js)

```typescript
import { RollgateClient } from "@rollgate/sdk-node";
import express from "express";

const client = new RollgateClient({
  apiKey: "sb_server_your_key",
  enableStreaming: true, // Real-time on server
});

await client.init();

const app = express();

// Endpoint for frontend to fetch flags
app.get("/api/flags", (req, res) => {
  const userId = req.user?.id;

  // If user identified, get user-specific flags
  if (userId) {
    client.identify({ id: userId, attributes: req.user.attributes });
  }

  res.json(client.getAllFlags());
});

app.listen(3000);
```

#### Frontend

```typescript
// Simple fetch from your backend
async function getFlags() {
  const response = await fetch("/api/flags");
  return response.json();
}
```

## Configuration Recommendations

### Server-Side SDKs

```typescript
const config = {
  apiKey: "sb_server_your_key",
  enableStreaming: true, // Real-time updates
  refreshInterval: 0, // Disable polling (using SSE)

  // Resilience
  retry: {
    maxRetries: 5, // More retries for critical apps
    maxDelayMs: 30000, // Up to 30s delay
  },
  circuitBreaker: {
    failureThreshold: 10, // Open after 10 failures
    recoveryTimeout: 60000, // Wait 1 min before retrying
  },
  cache: {
    ttl: 300000, // 5 min fresh
    staleTtl: 86400000, // 24h stale (survive outages)
  },
};
```

### Client-Side SDKs

```typescript
const config = {
  apiKey: "sb_client_your_key",
  refreshInterval: 60000, // Poll every minute
  enableStreaming: false, // Polling is usually enough

  // Lower resilience (browser reloads fix issues)
  retry: {
    maxRetries: 2,
    maxDelayMs: 5000,
  },
};
```

## Environment Variables

Never hardcode API keys:

```bash
# .env
ROLLGATE_API_KEY=sb_server_xxx
```

```typescript
const client = new RollgateClient({
  apiKey: process.env.ROLLGATE_API_KEY,
});
```

### Framework-Specific

**Next.js**:

```typescript
// next.config.js
module.exports = {
  env: {
    NEXT_PUBLIC_ROLLGATE_KEY: process.env.NEXT_PUBLIC_ROLLGATE_KEY,
  },
};
```

**Nuxt**:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      rollgateKey: process.env.ROLLGATE_CLIENT_KEY,
    },
  },
});
```

## Monitoring

### Health Checks

Include Rollgate status in your health endpoint:

```typescript
app.get("/health", (req, res) => {
  const rollgateReady = client.isReady();
  const circuitState = client.getCircuitState();

  res.json({
    status: rollgateReady ? "healthy" : "degraded",
    rollgate: {
      ready: rollgateReady,
      circuitState,
    },
  });
});
```

### Metrics

Export SDK metrics to your monitoring system:

```typescript
// Go SDK
metrics := client.GetMetrics()
prometheus.NewGaugeVec(
    prometheus.GaugeOpts{Name: "rollgate_cache_hit_rate"},
    []string{},
).Set(metrics.CacheHitRate)
```

### Logging

Enable SDK logging for debugging:

```typescript
const client = new RollgateClient({
  apiKey: "your-key",
  logger: {
    debug: (msg) => console.debug(`[Rollgate] ${msg}`),
    info: (msg) => console.info(`[Rollgate] ${msg}`),
    warn: (msg) => console.warn(`[Rollgate] ${msg}`),
    error: (msg) => console.error(`[Rollgate] ${msg}`),
  },
});
```

## High Availability

### Multiple Instances

SDKs handle concurrent access safely. Each server instance maintains its own client:

```typescript
// Each server instance
const client = new RollgateClient({ apiKey: "your-key" });
await client.init();
```

### Startup Resilience

Handle initialization failures gracefully:

```typescript
let client;

async function initializeFlags() {
  try {
    client = new RollgateClient({ apiKey: "your-key" });
    await client.init();
  } catch (error) {
    console.error("Rollgate init failed, using defaults:", error);
    client = {
      isEnabled: () => false,
      getAllFlags: () => ({}),
    };
  }
}
```

### Cache Persistence (Python)

Python SDK supports persistent caching for faster startup:

```python
config = RollgateConfig(
    api_key="your-key",
    cache=CacheConfig(
        persist_path="/var/cache/rollgate.json",
    ),
)
```

## Security Checklist

- [ ] Use server keys (`sb_server_*`) only on backend
- [ ] Use client keys (`sb_client_*`) only on frontend
- [ ] Store keys in environment variables
- [ ] Don't log API keys or flag values that contain sensitive data
- [ ] Use HTTPS (default)
- [ ] Implement rate limiting on your proxy endpoint
- [ ] Review flag values don't expose sensitive business logic

## Performance Tips

1. **Initialize once**: Create one client per application, not per request
2. **Use streaming for kill switches**: SSE for flags that need instant propagation
3. **Batch reads**: Use `getAllFlags()` instead of multiple `isEnabled()` calls when possible
4. **Appropriate TTL**: Longer cache TTL = fewer API calls = better performance
5. **Proxy for browsers**: Server proxy pattern reduces client-side complexity

## Troubleshooting

### SDK Not Initializing

1. Check API key is correct and not expired
2. Verify network connectivity to api.rollgate.io
3. Check for firewall/proxy blocking WebSocket (for SSE)

### Flags Not Updating

1. Check `refreshInterval` configuration
2. If using SSE, verify WebSocket connections are allowed
3. Check circuit breaker state (may be open due to errors)

### High Latency

1. Check network latency to api.rollgate.io
2. Consider using the proxy pattern
3. Increase cache TTL to reduce API calls
