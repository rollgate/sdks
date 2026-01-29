# Getting Started

This guide will help you integrate Rollgate feature flags into your application.

## Prerequisites

1. A Rollgate account at [rollgate.io](https://rollgate.io)
2. An API key from your Rollgate dashboard
3. At least one feature flag created

## Choose Your SDK

| Platform | Package                                    | Install Command                                   |
| -------- | ------------------------------------------ | ------------------------------------------------- |
| Node.js  | `@rollgate/sdk-node`                       | `npm install @rollgate/sdk-node`                  |
| React    | `@rollgate/sdk-react`                      | `npm install @rollgate/sdk-react`                 |
| Vue      | `@rollgate/sdk-vue`                        | `npm install @rollgate/sdk-vue`                   |
| Angular  | `@rollgate/sdk-angular`                    | `npm install @rollgate/sdk-angular`               |
| Svelte   | `@rollgate/sdk-svelte`                     | `npm install @rollgate/sdk-svelte`                |
| Go       | `github.com/rollgate/sdks/packages/sdk-go` | `go get github.com/rollgate/sdks/packages/sdk-go` |
| Java     | `io.rollgate:rollgate-sdk`                 | Maven/Gradle (see below)                          |
| Python   | `rollgate`                                 | `pip install rollgate`                            |

## Quick Start Examples

### Node.js

```typescript
import { RollgateClient } from "@rollgate/sdk-node";

const client = new RollgateClient({
  apiKey: "sb_server_your_api_key",
});

await client.init();

// Check a flag
if (client.isEnabled("new-checkout-flow")) {
  // New feature code
}

// With user targeting
await client.identify({
  id: "user-123",
  email: "user@example.com",
  attributes: { plan: "premium" },
});
```

### React

```tsx
import { RollgateProvider, useFlag } from "@rollgate/sdk-react";

// 1. Wrap your app with the provider
function App() {
  return (
    <RollgateProvider config={{ apiKey: "sb_client_your_api_key" }}>
      <MyComponent />
    </RollgateProvider>
  );
}

// 2. Use hooks in components
function MyComponent() {
  const showNewFeature = useFlag("new-feature");
  return showNewFeature ? <NewFeature /> : <OldFeature />;
}
```

### Vue

```typescript
// main.ts
import { createApp } from "vue";
import { RollgatePlugin } from "@rollgate/sdk-vue";
import App from "./App.vue";

const app = createApp(App);
app.use(RollgatePlugin, { apiKey: "sb_client_your_api_key" });
app.mount("#app");
```

```vue
<script setup>
import { useFlag } from "@rollgate/sdk-vue";

const isEnabled = useFlag("new-feature");
</script>

<template>
  <NewFeature v-if="isEnabled" />
  <OldFeature v-else />
</template>
```

### Go

```go
package main

import (
    "context"
    "log"

    rollgate "github.com/rollgate/sdks/packages/sdk-go"
)

func main() {
    config := rollgate.DefaultConfig("your-api-key")
    client, err := rollgate.NewClient(config)
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    ctx := context.Background()
    if err := client.Initialize(ctx); err != nil {
        log.Fatal(err)
    }

    if client.IsEnabled("new-feature", false) {
        log.Println("New feature is enabled!")
    }
}
```

### Java

```java
import io.rollgate.RollgateClient;
import io.rollgate.Config;

public class Example {
    public static void main(String[] args) throws Exception {
        Config config = new Config("your-api-key");

        try (RollgateClient client = new RollgateClient(config)) {
            client.initialize();

            if (client.isEnabled("new-feature", false)) {
                System.out.println("New feature is enabled!");
            }
        }
    }
}
```

### Python

```python
import asyncio
from rollgate import RollgateClient, RollgateConfig

async def main():
    config = RollgateConfig(api_key="your-api-key")
    client = RollgateClient(config)

    await client.init()

    if client.is_enabled("new-feature"):
        print("New feature is enabled!")

    await client.close()

asyncio.run(main())
```

## API Keys

Rollgate provides two types of API keys:

| Type   | Prefix      | Use Case                                            |
| ------ | ----------- | --------------------------------------------------- |
| Server | `sb_server` | Backend applications (Node, Go, Java, Python)       |
| Client | `sb_client` | Frontend applications (React, Vue, Angular, Svelte) |

**Important**: Never expose server keys in client-side code. Use client keys for browser applications.

## User Targeting

To enable user-specific targeting, identify your users:

```typescript
await client.identify({
  id: "user-123", // Required: unique user ID
  email: "user@example.com", // Optional: for targeting rules
  attributes: {
    // Optional: custom attributes
    plan: "premium",
    country: "US",
    betaTester: true,
  },
});
```

## Real-Time Updates

By default, SDKs poll for flag updates every 60 seconds. For instant updates, enable SSE streaming:

```typescript
const client = new RollgateClient({
  apiKey: "your-api-key",
  enableStreaming: true,
});
```

## Default Values

Always provide default values for flags:

```typescript
// Good: provides fallback if flag doesn't exist
const enabled = client.isEnabled("my-flag", false);

// Works but may return undefined if flag doesn't exist
const enabled = client.isEnabled("my-flag");
```

## Error Handling

Handle initialization errors gracefully:

```typescript
try {
  await client.init();
} catch (error) {
  console.error("Failed to initialize Rollgate:", error);
  // Fall back to default behavior
}
```

## Next Steps

- Read the [Architecture Guide](./ARCHITECTURE.md) to understand how SDKs work
- See [Production Setup](./PRODUCTION-SETUP.md) for production best practices
- Check individual SDK READMEs for detailed API documentation
