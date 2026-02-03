import 'config.dart';
import 'errors.dart';

enum CircuitState { closed, open, halfOpen }

class CircuitBreaker {
  final CircuitBreakerConfig _config;
  CircuitState _state = CircuitState.closed;
  final List<DateTime> _failures = [];
  DateTime _openedAt = DateTime.now();
  int _halfOpenSuccesses = 0;
  void Function(CircuitState from, CircuitState to)? _onStateChange;

  CircuitBreaker(this._config);

  Future<void> execute(Future<void> Function() fn) async {
    if (!isAllowingRequests()) {
      throw RollgateException.circuitOpenError();
    }

    if (_state == CircuitState.open) {
      _transitionTo(CircuitState.halfOpen);
    }

    try {
      await fn();
      _recordSuccess();
    } catch (e) {
      _recordFailure();
      rethrow;
    }
  }

  bool isAllowingRequests() {
    switch (_state) {
      case CircuitState.closed:
      case CircuitState.halfOpen:
        return true;
      case CircuitState.open:
        return DateTime.now().difference(_openedAt) >= _config.recoveryTimeout;
    }
  }

  CircuitState getState() => _state;

  String getStateString() {
    switch (_state) {
      case CircuitState.closed:
        return 'closed';
      case CircuitState.open:
        return 'open';
      case CircuitState.halfOpen:
        return 'half_open';
    }
  }

  void onStateChange(void Function(CircuitState, CircuitState) fn) {
    _onStateChange = fn;
  }

  void _recordFailure() {
    final now = DateTime.now();
    _failures.add(now);
    _cleanOldFailures();

    if (_state == CircuitState.halfOpen) {
      _transitionTo(CircuitState.open);
      return;
    }

    if (_countRecentFailures() >= _config.failureThreshold) {
      _transitionTo(CircuitState.open);
    }
  }

  void _recordSuccess() {
    if (_state == CircuitState.halfOpen) {
      _halfOpenSuccesses++;
      if (_halfOpenSuccesses >= _config.successThreshold) {
        _transitionTo(CircuitState.closed);
      }
    }
  }

  void _transitionTo(CircuitState newState) {
    if (_state == newState) return;
    final oldState = _state;
    _state = newState;

    if (newState == CircuitState.open) _openedAt = DateTime.now();
    if (newState == CircuitState.closed) {
      _failures.clear();
      _halfOpenSuccesses = 0;
    }
    if (newState == CircuitState.halfOpen) _halfOpenSuccesses = 0;

    _onStateChange?.call(oldState, newState);
  }

  void _cleanOldFailures() {
    final cutoff = DateTime.now().subtract(_config.monitoringWindow);
    _failures.removeWhere((f) => f.isBefore(cutoff));
  }

  int _countRecentFailures() {
    final cutoff = DateTime.now().subtract(_config.monitoringWindow);
    return _failures.where((f) => f.isAfter(cutoff)).length;
  }
}
