import 'errors.dart';

class MetricsSnapshot {
  final int totalRequests;
  final int successfulRequests;
  final int failedRequests;
  final int cacheHits;
  final int cacheMisses;
  final int cacheStaleHits;
  final String circuitState;
  final int circuitOpenCount;
  final int totalEvaluations;
  final int networkErrors;
  final int authErrors;
  final int rateLimitErrors;
  final int serverErrors;

  MetricsSnapshot({
    this.totalRequests = 0,
    this.successfulRequests = 0,
    this.failedRequests = 0,
    this.cacheHits = 0,
    this.cacheMisses = 0,
    this.cacheStaleHits = 0,
    this.circuitState = 'closed',
    this.circuitOpenCount = 0,
    this.totalEvaluations = 0,
    this.networkErrors = 0,
    this.authErrors = 0,
    this.rateLimitErrors = 0,
    this.serverErrors = 0,
  });
}

class SDKMetrics {
  int _totalRequests = 0;
  int _successfulRequests = 0;
  int _failedRequests = 0;
  int _cacheHits = 0;
  int _cacheMisses = 0;
  int _cacheStaleHits = 0;
  String _circuitState = 'closed';
  int _circuitOpenCount = 0;
  int _totalEvaluations = 0;
  int _networkErrors = 0;
  int _authErrors = 0;
  int _rateLimitErrors = 0;
  int _serverErrors = 0;

  void recordRequest(int latencyMs, bool success, ErrorCategory errCategory) {
    _totalRequests++;
    if (success) {
      _successfulRequests++;
    } else {
      _failedRequests++;
      switch (errCategory) {
        case ErrorCategory.network:
          _networkErrors++;
          break;
        case ErrorCategory.auth:
          _authErrors++;
          break;
        case ErrorCategory.rateLimit:
          _rateLimitErrors++;
          break;
        case ErrorCategory.server:
          _serverErrors++;
          break;
        default:
          break;
      }
    }
  }

  void recordCacheHit(bool stale) {
    if (stale) {
      _cacheStaleHits++;
    } else {
      _cacheHits++;
    }
  }

  void recordCacheMiss() {
    _cacheMisses++;
  }

  void recordCircuitStateChange(String state) {
    _circuitState = state;
    if (state == 'open') _circuitOpenCount++;
  }

  void recordEvaluation() {
    _totalEvaluations++;
  }

  MetricsSnapshot snapshot() => MetricsSnapshot(
        totalRequests: _totalRequests,
        successfulRequests: _successfulRequests,
        failedRequests: _failedRequests,
        cacheHits: _cacheHits,
        cacheMisses: _cacheMisses,
        cacheStaleHits: _cacheStaleHits,
        circuitState: _circuitState,
        circuitOpenCount: _circuitOpenCount,
        totalEvaluations: _totalEvaluations,
        networkErrors: _networkErrors,
        authErrors: _authErrors,
        rateLimitErrors: _rateLimitErrors,
        serverErrors: _serverErrors,
      );
}
