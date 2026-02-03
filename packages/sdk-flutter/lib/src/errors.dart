enum ErrorCategory {
  none,
  network,
  auth,
  rateLimit,
  validation,
  server,
  unknown,
}

class RollgateException implements Exception {
  final String message;
  final ErrorCategory category;
  final int statusCode;
  final bool retryable;
  final Exception? cause;

  RollgateException(
    this.message, {
    this.category = ErrorCategory.unknown,
    this.statusCode = 0,
    this.retryable = false,
    this.cause,
  });

  factory RollgateException.networkError(String message, [Exception? cause]) =>
      RollgateException(message,
          category: ErrorCategory.network, retryable: true, cause: cause);

  factory RollgateException.authError(String message) =>
      RollgateException(message,
          category: ErrorCategory.auth, statusCode: 401, retryable: false);

  factory RollgateException.rateLimitError(int retryAfter) =>
      RollgateException('rate limit exceeded (retry after ${retryAfter}s)',
          category: ErrorCategory.rateLimit, statusCode: 429, retryable: true);

  factory RollgateException.serverError(int statusCode, String message) =>
      RollgateException(message,
          category: ErrorCategory.server,
          statusCode: statusCode,
          retryable: statusCode >= 500);

  factory RollgateException.validationError(String message) =>
      RollgateException(message,
          category: ErrorCategory.validation, statusCode: 400, retryable: false);

  factory RollgateException.circuitOpenError() =>
      RollgateException('circuit breaker is open',
          category: ErrorCategory.network, retryable: false);

  static bool isRetryable(Object error) {
    if (error is RollgateException) return error.retryable;
    final msg = error.toString().toLowerCase();
    return msg.contains('timeout') ||
        msg.contains('connection refused') ||
        msg.contains('connection reset') ||
        msg.contains('503') ||
        msg.contains('502');
  }

  static ErrorCategory classify(Object error) {
    if (error is RollgateException) return error.category;
    final msg = error.toString().toLowerCase();
    if (msg.contains('timeout') || msg.contains('connection')) {
      return ErrorCategory.network;
    }
    return ErrorCategory.unknown;
  }

  @override
  String toString() => 'RollgateException: $message';
}
