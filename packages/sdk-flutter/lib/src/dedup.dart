import 'dart:async';

class RequestDeduplicator {
  final Map<String, Completer<dynamic>> _inflight = {};

  Future<T?> dedupe<T>(String key, Future<T?> Function() fn) async {
    if (_inflight.containsKey(key)) {
      final result = await _inflight[key]!.future;
      if (result is Exception) throw result;
      return result as T?;
    }

    final completer = Completer<dynamic>();
    _inflight[key] = completer;

    try {
      final result = await fn();
      completer.complete(result);
      return result;
    } catch (e) {
      completer.complete(e);
      rethrow;
    } finally {
      _inflight.remove(key);
    }
  }

  void clear() {
    _inflight.clear();
  }
}
