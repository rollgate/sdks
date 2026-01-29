# @rollgate/sdk-angular

[![CI](https://github.com/rollgate/sdks/actions/workflows/ci.yml/badge.svg)](https://github.com/rollgate/sdks/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@rollgate/sdk-angular.svg)](https://www.npmjs.com/package/@rollgate/sdk-angular)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official Angular SDK for [Rollgate](https://rollgate.io) - Feature flags made simple.

## Requirements

- Angular 14+
- RxJS 7+

## Installation

```bash
npm install @rollgate/sdk-angular
# or
yarn add @rollgate/sdk-angular
# or
pnpm add @rollgate/sdk-angular
```

## Quick Start

### 1. Import the Module

```typescript
// app.module.ts
import { NgModule } from "@angular/core";
import { RollgateModule } from "@rollgate/sdk-angular";

@NgModule({
  imports: [
    RollgateModule.forRoot({
      apiKey: "your-api-key",
      // Optional: initial user for targeting
      user: {
        id: "user-123",
        email: "user@example.com",
        attributes: { plan: "pro" },
      },
    }),
  ],
})
export class AppModule {}
```

### Standalone Components (Angular 17+)

```typescript
// app.config.ts
import { ApplicationConfig } from "@angular/core";
import { ROLLGATE_CONFIG } from "@rollgate/sdk-angular";

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: ROLLGATE_CONFIG,
      useValue: {
        apiKey: "your-api-key",
      },
    },
  ],
};
```

### 2. Use in Components

```typescript
// app.component.ts
import { Component } from "@angular/core";
import { RollgateService } from "@rollgate/sdk-angular";

@Component({
  selector: "app-root",
  template: `
    <div *ngIf="rollgate.isReady$ | async; else loading">
      <div *ngIf="rollgate.isEnabled('new-feature')">
        New feature is enabled!
      </div>
    </div>
    <ng-template #loading>Loading flags...</ng-template>
  `,
})
export class AppComponent {
  constructor(public rollgate: RollgateService) {}
}
```

## Usage

### RollgateService

Inject the service to check flags:

```typescript
import { Component } from "@angular/core";
import { RollgateService } from "@rollgate/sdk-angular";

@Component({
  selector: "app-feature",
  template: `
    <div *ngIf="isNewFeatureEnabled">New Feature!</div>
    <div *ngIf="flags$ | async as flags">
      Premium: {{ flags["premium-feature"] }}
    </div>
  `,
})
export class FeatureComponent {
  isNewFeatureEnabled: boolean;
  flags$ = this.rollgate.flags$;

  constructor(private rollgate: RollgateService) {
    this.isNewFeatureEnabled = this.rollgate.isEnabled("new-feature");
  }

  async onLogin(user: User) {
    await this.rollgate.identify({
      id: user.id,
      email: user.email,
      attributes: { plan: user.plan },
    });
  }

  async onLogout() {
    await this.rollgate.reset();
  }
}
```

### Reactive Flag Observable

```typescript
import { Component } from "@angular/core";
import { Observable } from "rxjs";
import { RollgateService } from "@rollgate/sdk-angular";

@Component({
  selector: "app-feature",
  template: `
    <div *ngIf="showBanner$ | async">
      <app-banner />
    </div>
  `,
})
export class FeatureComponent {
  showBanner$: Observable<boolean>;

  constructor(private rollgate: RollgateService) {
    this.showBanner$ = this.rollgate.getFlag$("show-banner");
  }
}
```

### FlagDirective

Structural directive for conditional rendering:

```typescript
import { Component } from "@angular/core";
import { FlagDirective } from "@rollgate/sdk-angular";

@Component({
  selector: "app-feature",
  standalone: true,
  imports: [FlagDirective],
  template: `
    <div *rollgateFlag="'new-feature'">New feature is enabled!</div>

    <ng-container *rollgateFlag="'premium'; else standardTpl">
      Premium content
    </ng-container>
    <ng-template #standardTpl>Standard content</ng-template>
  `,
})
export class FeatureComponent {}
```

## Configuration

```typescript
RollgateModule.forRoot({
  // Required
  apiKey: "your-api-key",

  // Optional
  baseUrl: "https://api.rollgate.io",
  refreshInterval: 30000, // Polling interval (ms)
  enableStreaming: false, // Use SSE for real-time updates
  timeout: 5000, // Request timeout (ms)

  // Initial user context
  user: {
    id: "user-123",
    email: "user@example.com",
    attributes: { plan: "pro" },
  },

  // Retry configuration
  retry: {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 10000,
    jitterFactor: 0.1,
  },

  // Circuit breaker configuration
  circuitBreaker: {
    failureThreshold: 5,
    recoveryTimeout: 30000,
    monitoringWindow: 60000,
    successThreshold: 3,
  },

  // Cache configuration
  cache: {
    ttl: 300000, // 5 minutes
    staleTtl: 3600000, // 1 hour
  },
});
```

## API Reference

### RollgateService

| Property/Method                | Description                         |
| ------------------------------ | ----------------------------------- |
| `flags$`                       | Observable of all flags             |
| `isReady$`                     | Observable of ready state           |
| `isLoading$`                   | Observable of loading state         |
| `error$`                       | Observable of error state           |
| `circuitState$`                | Observable of circuit breaker state |
| `isEnabled(flagKey, default?)` | Check if flag is enabled            |
| `getFlag$(flagKey, default?)`  | Get observable for single flag      |
| `getAllFlags()`                | Get all flags synchronously         |
| `identify(user)`               | Set user context                    |
| `reset()`                      | Clear user context                  |
| `refresh()`                    | Force refresh flags                 |

### FlagDirective

```html
<!-- Basic usage -->
<div *rollgateFlag="'feature-name'">Content</div>

<!-- With else template -->
<div *rollgateFlag="'feature-name'; else fallback">Feature enabled</div>
<ng-template #fallback>Feature disabled</ng-template>
```

## Documentation

- [Getting Started](../../docs/GETTING-STARTED.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Production Setup](../../docs/PRODUCTION-SETUP.md)

Full documentation: [docs.rollgate.io](https://rollgate.io/docs)

## About Rollgate

[Rollgate](https://rollgate.io) is a feature management platform that helps teams release features safely with gradual rollouts, user targeting, and instant kill switches.

## License

MIT
