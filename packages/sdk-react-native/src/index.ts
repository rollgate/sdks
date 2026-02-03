/**
 * Rollgate React Native SDK
 *
 * Feature flags for React Native apps with React hooks support.
 *
 * Usage:
 *   import { RollgateProvider, useFlag } from '@rollgate/sdk-react-native';
 *
 *   <RollgateProvider config={{ apiKey: 'your-key' }} user={{ id: 'user-1' }}>
 *     <App />
 *   </RollgateProvider>
 *
 *   const showFeature = useFlag('new-feature', false);
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import {
  createClient,
  RollgateReactNativeClient,
  CircuitState,
  RollgateError,
  ErrorCategory,
} from "./client";
import type {
  UserContext,
  RollgateOptions,
  MetricsSnapshot,
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  EvaluationReason,
  EvaluationDetail,
} from "./client";

// Re-export types and classes
export type {
  UserContext,
  RollgateOptions,
  MetricsSnapshot,
  RetryConfig,
  CircuitBreakerConfig,
  CacheConfig,
  EvaluationReason,
  EvaluationDetail,
};
export {
  createClient,
  RollgateReactNativeClient,
  CircuitState,
  RollgateError,
  ErrorCategory,
};

/**
 * React Native SDK configuration
 */
export interface RollgateConfig extends RollgateOptions {
  /** Your Rollgate API key */
  apiKey: string;
}

interface RollgateContextValue {
  /** Check if a flag is enabled */
  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;
  /** True while initial flags are loading */
  isLoading: boolean;
  /** True if there was an error fetching flags */
  isError: boolean;
  /** True if using cached/stale flags */
  isStale: boolean;
  /** Current circuit breaker state */
  circuitState: CircuitState;
  /** All flags as key-value object */
  flags: Record<string, boolean>;
  /** Change user context */
  identify: (user: UserContext) => Promise<void>;
  /** Clear user context */
  reset: () => Promise<void>;
  /** Force refresh flags */
  refresh: () => Promise<void>;
  /** Get metrics snapshot */
  getMetrics: () => MetricsSnapshot;
  /** Access the underlying client */
  client: RollgateReactNativeClient | null;
}

const RollgateContext = createContext<RollgateContextValue | null>(null);

interface RollgateProviderProps {
  config: RollgateConfig;
  user?: UserContext;
  children: ReactNode;
}

/**
 * Rollgate Provider component for React Native
 *
 * @example
 * ```tsx
 * <RollgateProvider config={{ apiKey: 'your-api-key' }} user={{ id: 'user-1' }}>
 *   <App />
 * </RollgateProvider>
 * ```
 */
export function RollgateProvider({
  config,
  user,
  children,
}: RollgateProviderProps) {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [circuitState, setCircuitState] = useState<CircuitState>(
    CircuitState.CLOSED,
  );

  const clientRef = useRef<RollgateReactNativeClient | null>(null);

  // Create client on mount
  useEffect(() => {
    const { apiKey, ...options } = config;

    const client = createClient(apiKey, user || null, options);
    clientRef.current = client;

    // Subscribe to client events
    client.on("ready", () => {
      setFlags(client.allFlags());
      setIsLoading(false);
      setIsError(false);
      setIsStale(false);
    });

    client.on("flags-updated", (newFlags) => {
      setFlags(newFlags as Record<string, boolean>);
      setIsStale(false);
    });

    client.on("error", () => {
      setIsError(true);
      // Use cached flags if available
      const currentFlags = client.allFlags();
      if (Object.keys(currentFlags).length > 0) {
        setFlags(currentFlags);
        setIsStale(true);
      }
    });

    client.on("circuit-state-change", (data) => {
      const stateData = data as { to: CircuitState };
      setCircuitState(stateData.to);
    });

    // Wait for initialization
    client.waitForInitialization().catch(() => {
      setIsError(true);
      setIsLoading(false);
    });

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [config.apiKey]); // Only recreate client if API key changes

  // Handle user changes
  useEffect(() => {
    if (clientRef.current && user) {
      clientRef.current.identify(user).catch(() => {
        setIsError(true);
      });
    }
  }, [user?.id, user?.email]);

  const isEnabled = useCallback(
    (flagKey: string, defaultValue: boolean = false): boolean => {
      if (clientRef.current) {
        return clientRef.current.isEnabled(flagKey, defaultValue);
      }
      return defaultValue;
    },
    [],
  );

  const identify = useCallback(async (newUser: UserContext): Promise<void> => {
    if (clientRef.current) {
      await clientRef.current.identify(newUser);
    }
  }, []);

  const reset = useCallback(async (): Promise<void> => {
    if (clientRef.current) {
      await clientRef.current.reset();
    }
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (clientRef.current) {
      await clientRef.current.refresh();
    }
  }, []);

  const getMetrics = useCallback((): MetricsSnapshot => {
    if (clientRef.current) {
      return clientRef.current.getMetrics();
    }
    // Return empty metrics when client not ready
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
  }, []);

  const value: RollgateContextValue = {
    isEnabled,
    isLoading,
    isError,
    isStale,
    circuitState,
    flags,
    identify,
    reset,
    refresh,
    getMetrics,
    client: clientRef.current,
  };

  return React.createElement(RollgateContext.Provider, { value }, children);
}

/**
 * Hook to check if a single flag is enabled
 *
 * @example
 * ```tsx
 * const showNewFeature = useFlag('new-feature', false);
 * ```
 */
export function useFlag(
  flagKey: string,
  defaultValue: boolean = false,
): boolean {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error("useFlag must be used within a RollgateProvider");
  }

  return context.isEnabled(flagKey, defaultValue);
}

/**
 * Hook to check if a single flag is enabled with evaluation reason
 *
 * @example
 * ```tsx
 * const { value, reason } = useFlagDetail('new-feature', false);
 * ```
 */
export function useFlagDetail(
  flagKey: string,
  defaultValue: boolean = false,
): EvaluationDetail<boolean> {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error("useFlagDetail must be used within a RollgateProvider");
  }

  if (context.client) {
    return context.client.isEnabledDetail(flagKey, defaultValue);
  }

  return {
    value: defaultValue,
    reason: { kind: "ERROR", errorKind: "CLIENT_NOT_READY" },
  };
}

/**
 * Hook to get multiple flags at once
 *
 * @example
 * ```tsx
 * const flags = useFlags(['feature-a', 'feature-b']);
 * ```
 */
export function useFlags(flagKeys: string[]): Record<string, boolean> {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error("useFlags must be used within a RollgateProvider");
  }

  const result: Record<string, boolean> = {};
  for (const key of flagKeys) {
    result[key] = context.isEnabled(key, false);
  }
  return result;
}

/**
 * Hook to get a string flag value
 *
 * @example
 * ```tsx
 * const buttonColor = useStringFlag('button-color', 'blue');
 * ```
 */
export function useStringFlag(flagKey: string, defaultValue: string): string {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error("useStringFlag must be used within a RollgateProvider");
  }

  if (context.client) {
    return context.client.getString(flagKey, defaultValue);
  }
  return defaultValue;
}

/**
 * Hook to get a number flag value
 *
 * @example
 * ```tsx
 * const maxItems = useNumberFlag('max-items', 10);
 * ```
 */
export function useNumberFlag(flagKey: string, defaultValue: number): number {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error("useNumberFlag must be used within a RollgateProvider");
  }

  if (context.client) {
    return context.client.getNumber(flagKey, defaultValue);
  }
  return defaultValue;
}

/**
 * Hook to get a JSON flag value
 *
 * @example
 * ```tsx
 * const config = useJSONFlag('feature-config', { enabled: false });
 * ```
 */
export function useJSONFlag<T>(flagKey: string, defaultValue: T): T {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error("useJSONFlag must be used within a RollgateProvider");
  }

  if (context.client) {
    return context.client.getJSON<T>(flagKey, defaultValue);
  }
  return defaultValue;
}

/**
 * Hook to access the full Rollgate context
 *
 * @example
 * ```tsx
 * const { identify, refresh, circuitState } = useRollgate();
 * ```
 */
export function useRollgate(): RollgateContextValue {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error("useRollgate must be used within a RollgateProvider");
  }

  return context;
}

/**
 * Hook to access SDK metrics
 *
 * @example
 * ```tsx
 * const { metrics } = useMetrics();
 * console.log(metrics.requests.total);
 * ```
 */
export function useMetrics(): { metrics: MetricsSnapshot } {
  const context = useContext(RollgateContext);

  if (!context) {
    throw new Error("useMetrics must be used within a RollgateProvider");
  }

  return {
    metrics: context.getMetrics(),
  };
}

/**
 * Component that renders children only if flag is enabled
 *
 * @example
 * ```tsx
 * <Feature flag="new-dashboard" fallback={<OldDashboard />}>
 *   <NewDashboard />
 * </Feature>
 * ```
 */
interface FeatureProps {
  flag: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Feature({
  flag,
  children,
  fallback = null,
}: FeatureProps): React.ReactElement {
  const enabled = useFlag(flag);
  return React.createElement(
    React.Fragment,
    null,
    enabled ? children : fallback,
  );
}

// Re-export types for backwards compatibility
export type { RollgateContextValue, RollgateProviderProps, FeatureProps };
