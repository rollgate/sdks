/**
 * Rollgate Angular SDK
 *
 * Thin wrapper around @rollgate/sdk-browser providing Angular-specific bindings:
 * - RollgateService (Injectable service)
 * - RollgateModule (NgModule)
 * - FeatureDirective (*rollgateFeature structural directive)
 *
 * All HTTP, caching, circuit breaker logic is delegated to sdk-browser.
 */
import {
  Injectable,
  NgModule,
  ModuleWithProviders,
  InjectionToken,
  Inject,
  Directive,
  Input,
  TemplateRef,
  ViewContainerRef,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { BehaviorSubject, Observable, Subscription } from "rxjs";
import {
  createClient,
  RollgateBrowserClient,
  CircuitState,
} from "@rollgate/sdk-browser";
import type {
  UserContext,
  RollgateOptions,
  MetricsSnapshot,
  EvaluationReason,
  EvaluationDetail,
  TrackEventOptions,
} from "@rollgate/sdk-browser";

// Re-export types from sdk-browser
export type {
  UserContext,
  RollgateOptions,
  MetricsSnapshot,
  EvaluationReason,
  EvaluationDetail,
  TrackEventOptions,
} from "@rollgate/sdk-browser";
export {
  CircuitState,
  CircuitOpenError,
  RollgateError,
  ErrorCategory,
} from "@rollgate/sdk-browser";

/**
 * Angular SDK configuration
 */
export interface RollgateConfig extends RollgateOptions {
  /** Your Rollgate API key */
  apiKey: string;
  /** Initial user context */
  user?: UserContext;
}

/** Injection token for Rollgate config */
export const ROLLGATE_CONFIG = new InjectionToken<RollgateConfig>(
  "ROLLGATE_CONFIG",
);

/**
 * Rollgate Angular Service
 *
 * Injectable service for feature flag management.
 *
 * @example
 * ```typescript
 * @Component({ ... })
 * export class MyComponent {
 *   constructor(private rollgate: RollgateService) {}
 *
 *   get showFeature() {
 *     return this.rollgate.isEnabled('new-feature');
 *   }
 * }
 * ```
 */
@Injectable({ providedIn: "root" })
export class RollgateService implements OnDestroy {
  private client: RollgateBrowserClient | null = null;

  private readonly _flags$ = new BehaviorSubject<Record<string, boolean>>({});
  private readonly _isLoading$ = new BehaviorSubject<boolean>(true);
  private readonly _isError$ = new BehaviorSubject<boolean>(false);
  private readonly _isStale$ = new BehaviorSubject<boolean>(false);
  private readonly _circuitState$ = new BehaviorSubject<CircuitState>(
    CircuitState.CLOSED,
  );
  private readonly _isReady$ = new BehaviorSubject<boolean>(false);

  /** Observable of all flags */
  readonly flags$: Observable<Record<string, boolean>> =
    this._flags$.asObservable();
  /** Observable of loading state */
  readonly isLoading$: Observable<boolean> = this._isLoading$.asObservable();
  /** Observable of error state */
  readonly isError$: Observable<boolean> = this._isError$.asObservable();
  /** Observable of stale state */
  readonly isStale$: Observable<boolean> = this._isStale$.asObservable();
  /** Observable of circuit breaker state */
  readonly circuitState$: Observable<CircuitState> =
    this._circuitState$.asObservable();
  /** Observable of ready state */
  readonly isReady$: Observable<boolean> = this._isReady$.asObservable();

  constructor(@Inject(ROLLGATE_CONFIG) private config: RollgateConfig) {
    this.initialize();
  }

  private initialize(): void {
    const { apiKey, user, ...options } = this.config;
    this.client = createClient(apiKey, user || null, options);

    // Subscribe to client events
    this.client.on("ready", () => {
      this._flags$.next(this.client!.allFlags());
      this._isLoading$.next(false);
      this._isError$.next(false);
      this._isStale$.next(false);
      this._isReady$.next(true);
    });

    this.client.on("flags-updated", (newFlags) => {
      this._flags$.next(newFlags as Record<string, boolean>);
      this._isStale$.next(false);
    });

    this.client.on("error", () => {
      this._isError$.next(true);
      const currentFlags = this.client!.allFlags();
      if (Object.keys(currentFlags).length > 0) {
        this._flags$.next(currentFlags);
        this._isStale$.next(true);
      }
    });

    this.client.on("circuit-state-change", (data) => {
      const stateData = data as { to: CircuitState };
      this._circuitState$.next(stateData.to);
    });

    // Wait for initialization
    this.client.waitForInitialization().catch(() => {
      this._isError$.next(true);
      this._isLoading$.next(false);
    });
  }

  /**
   * Check if a flag is enabled
   */
  isEnabled(flagKey: string, defaultValue: boolean = false): boolean {
    if (this.client) {
      return this.client.isEnabled(flagKey, defaultValue);
    }
    return defaultValue;
  }

  /**
   * Check if a flag is enabled with evaluation reason
   */
  isEnabledDetail(
    flagKey: string,
    defaultValue: boolean = false,
  ): EvaluationDetail<boolean> {
    if (this.client) {
      return this.client.isEnabledDetail(flagKey, defaultValue);
    }
    return {
      value: defaultValue,
      reason: { kind: "ERROR", errorKind: "CLIENT_NOT_READY" },
    };
  }

  /**
   * Get current flags snapshot
   */
  get flags(): Record<string, boolean> {
    return this._flags$.getValue();
  }

  /**
   * Get current loading state
   */
  get isLoading(): boolean {
    return this._isLoading$.getValue();
  }

  /**
   * Get current error state
   */
  get isError(): boolean {
    return this._isError$.getValue();
  }

  /**
   * Get current stale state
   */
  get isStale(): boolean {
    return this._isStale$.getValue();
  }

  /**
   * Get current circuit breaker state
   */
  get circuitState(): CircuitState {
    return this._circuitState$.getValue();
  }

  /**
   * Check if client is ready
   */
  get isReady(): boolean {
    return this._isReady$.getValue();
  }

  /**
   * Change user context
   */
  async identify(user: UserContext): Promise<void> {
    if (this.client) {
      await this.client.identify(user);
    }
  }

  /**
   * Clear user context
   */
  async reset(): Promise<void> {
    if (this.client) {
      await this.client.reset();
    }
  }

  /**
   * Force refresh flags
   */
  async refresh(): Promise<void> {
    if (this.client) {
      await this.client.refresh();
    }
  }

  /**
   * Get metrics snapshot
   */
  getMetrics(): MetricsSnapshot {
    if (this.client) {
      return this.client.getMetrics();
    }
    return {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      successRate: 0,
      errorRate: 0,
      avgLatencyMs: 0,
      minLatencyMs: 0,
      maxLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
      notModifiedResponses: 0,
      errorsByCategory: {},
      circuitOpens: 0,
      circuitCloses: 0,
      circuitState: "closed",
      flagEvaluations: {
        totalEvaluations: 0,
        evaluationsPerFlag: {},
        avgEvaluationTimeMs: 0,
      },
      windows: {
        "1m": { requests: 0, errors: 0, avgLatencyMs: 0, errorRate: 0 },
        "5m": { requests: 0, errors: 0, avgLatencyMs: 0, errorRate: 0 },
        "15m": { requests: 0, errors: 0, avgLatencyMs: 0, errorRate: 0 },
        "1h": { requests: 0, errors: 0, avgLatencyMs: 0, errorRate: 0 },
      },
      uptimeMs: 0,
      lastRequestAt: null,
    };
  }

  /**
   * Track a conversion event for A/B testing
   */
  track(options: TrackEventOptions): void {
    if (this.client) {
      this.client.track(options);
    }
  }

  ngOnDestroy(): void {
    if (this.client) {
      this.client.close();
      this.client = null;
    }
  }
}

/**
 * Structural directive for conditional rendering based on feature flags
 *
 * @example
 * ```html
 * <div *rollgateFeature="'new-feature'">
 *   New feature content
 * </div>
 *
 * <ng-template [rollgateFeature]="'premium-feature'" [rollgateFeatureElse]="freeTpl">
 *   Premium content
 * </ng-template>
 * <ng-template #freeTpl>Free content</ng-template>
 * ```
 */
@Directive({
  selector: "[rollgateFeature]",
})
export class FeatureDirective implements OnInit, OnDestroy {
  @Input() rollgateFeature!: string;
  @Input() rollgateFeatureElse?: TemplateRef<unknown>;

  private subscription?: Subscription;

  constructor(
    private templateRef: TemplateRef<unknown>,
    private viewContainer: ViewContainerRef,
    private rollgate: RollgateService,
  ) {}

  ngOnInit(): void {
    this.subscription = this.rollgate.flags$.subscribe(() => {
      this.updateView();
    });
    this.updateView();
  }

  private updateView(): void {
    this.viewContainer.clear();
    if (this.rollgate.isEnabled(this.rollgateFeature)) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    } else if (this.rollgateFeatureElse) {
      this.viewContainer.createEmbeddedView(this.rollgateFeatureElse);
    }
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
  }
}

/**
 * Rollgate Angular Module
 *
 * @example
 * ```typescript
 * @NgModule({
 *   imports: [
 *     RollgateModule.forRoot({
 *       apiKey: 'your-api-key',
 *       user: { id: 'user-1' }
 *     })
 *   ]
 * })
 * export class AppModule {}
 * ```
 */
@NgModule({
  declarations: [FeatureDirective],
  exports: [FeatureDirective],
})
export class RollgateModule {
  static forRoot(config: RollgateConfig): ModuleWithProviders<RollgateModule> {
    return {
      ngModule: RollgateModule,
      providers: [
        { provide: ROLLGATE_CONFIG, useValue: config },
        RollgateService,
      ],
    };
  }
}
