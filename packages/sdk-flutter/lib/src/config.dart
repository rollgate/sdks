class RollgateConfig {
  final String apiKey;
  final String baseUrl;
  final Duration timeout;
  final Duration refreshInterval;
  final RetryConfig retry;
  final CircuitBreakerConfig circuitBreaker;
  final CacheConfig cache;

  RollgateConfig({
    required this.apiKey,
    this.baseUrl = 'https://api.rollgate.io',
    this.timeout = const Duration(seconds: 5),
    this.refreshInterval = const Duration(seconds: 30),
    RetryConfig? retry,
    CircuitBreakerConfig? circuitBreaker,
    CacheConfig? cache,
  })  : retry = retry ?? RetryConfig(),
        circuitBreaker = circuitBreaker ?? CircuitBreakerConfig(),
        cache = cache ?? CacheConfig();
}

class RetryConfig {
  final int maxRetries;
  final Duration baseDelay;
  final Duration maxDelay;
  final double jitterFactor;

  RetryConfig({
    this.maxRetries = 3,
    this.baseDelay = const Duration(milliseconds: 100),
    this.maxDelay = const Duration(seconds: 10),
    this.jitterFactor = 0.1,
  });
}

class CircuitBreakerConfig {
  final int failureThreshold;
  final Duration recoveryTimeout;
  final Duration monitoringWindow;
  final int successThreshold;

  CircuitBreakerConfig({
    this.failureThreshold = 5,
    this.recoveryTimeout = const Duration(seconds: 30),
    this.monitoringWindow = const Duration(seconds: 60),
    this.successThreshold = 3,
  });
}

class CacheConfig {
  final Duration ttl;
  final Duration staleTtl;
  final bool enabled;

  CacheConfig({
    this.ttl = const Duration(minutes: 5),
    this.staleTtl = const Duration(hours: 1),
    this.enabled = true,
  });
}
