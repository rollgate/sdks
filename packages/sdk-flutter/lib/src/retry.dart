import 'dart:math';

import 'config.dart';
import 'errors.dart';

class RetryResult {
  final bool success;
  final int attempts;
  final Object? error;

  RetryResult({required this.success, required this.attempts, this.error});
}

class Retryer {
  final RetryConfig _config;
  static final _random = Random();

  Retryer(this._config);

  Future<RetryResult> doRetry(Future<void> Function() fn) async {
    Object? lastErr;
    int attempts = 0;

    while (attempts <= _config.maxRetries) {
      attempts++;
      try {
        await fn();
        return RetryResult(success: true, attempts: attempts);
      } catch (e) {
        lastErr = e;
        if (!RollgateException.isRetryable(e)) {
          return RetryResult(success: false, attempts: attempts, error: e);
        }
        if (attempts > _config.maxRetries) break;
        final delay = _calculateBackoff(attempts - 1);
        await Future.delayed(delay);
      }
    }

    return RetryResult(success: false, attempts: attempts, error: lastErr);
  }

  Duration _calculateBackoff(int attempt) {
    double delay = _config.baseDelay.inMilliseconds * pow(2, attempt).toDouble();
    if (_config.jitterFactor > 0) {
      double jitter = delay * _config.jitterFactor * (_random.nextDouble() * 2 - 1);
      delay += jitter;
    }
    if (delay < 0) delay = 0;
    if (delay > _config.maxDelay.inMilliseconds) {
      delay = _config.maxDelay.inMilliseconds.toDouble();
    }
    return Duration(milliseconds: delay.round());
  }
}
