import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';
import 'user_context.dart';
import 'reasons.dart';
import 'errors.dart';
import 'cache.dart';
import 'circuit_breaker.dart';
import 'retry.dart';
import 'dedup.dart';
import 'metrics.dart';

class RollgateClient {
  final RollgateConfig _config;
  final http.Client _httpClient;
  final CircuitBreaker _circuitBreaker;
  final FlagCache _cache;
  final Retryer _retryer;
  final RequestDeduplicator _dedup;
  final SDKMetrics _metrics;

  Map<String, bool> _flags = {};
  Map<String, EvaluationReason> _flagReasons = {};
  UserContext? _user;
  String? _lastETag;
  bool _ready = false;
  Timer? _pollingTimer;

  RollgateClient(this._config)
      : _httpClient = http.Client(),
        _circuitBreaker = CircuitBreaker(_config.circuitBreaker),
        _cache = FlagCache(_config.cache),
        _retryer = Retryer(_config.retry),
        _dedup = RequestDeduplicator(),
        _metrics = SDKMetrics() {
    _circuitBreaker.onStateChange((from, to) {
      _metrics.recordCircuitStateChange(_circuitBreaker.getStateString());
    });
  }

  Future<void> initialize() async {
    if (_config.cache.enabled) {
      final cached = _cache.get();
      if (cached.found) {
        _flags = cached.flags!;
        _cache.recordHit(cached.stale);
      }
    }

    try {
      await refresh();
    } catch (e) {
      if (!_cache.hasAny()) rethrow;
    }

    _ready = true;

    if (_config.refreshInterval > Duration.zero) {
      _startPolling();
    }
  }

  bool isEnabled(String flagKey, [bool defaultValue = false]) =>
      isEnabledDetail(flagKey, defaultValue).value;

  EvaluationDetail<bool> isEnabledDetail(String flagKey,
      [bool defaultValue = false]) {
    _metrics.recordEvaluation();

    if (!_ready) {
      return EvaluationDetail(
        value: defaultValue,
        reason: EvaluationReason.error(EvaluationErrorKind.CLIENT_NOT_READY),
      );
    }

    if (!_flags.containsKey(flagKey)) {
      return EvaluationDetail(
        value: defaultValue,
        reason: EvaluationReason.unknown(),
      );
    }

    final value = _flags[flagKey]!;
    final reason = _flagReasons[flagKey];
    return EvaluationDetail(
      value: value,
      reason: reason ?? EvaluationReason.fallthrough(value),
    );
  }

  Map<String, bool> getAllFlags() => Map<String, bool>.from(_flags);

  String getString(String flagKey, String defaultValue) => defaultValue;
  double getNumber(String flagKey, double defaultValue) => defaultValue;
  Object? getJson(String flagKey, Object? defaultValue) => defaultValue;

  Future<void> identify(UserContext user) async {
    _user = user;

    if (user.id.isNotEmpty) {
      try {
        await _sendIdentify(user);
      } catch (_) {
        // log but don't fail
      }
    }

    await refresh();
  }

  Future<void> reset() async {
    final oldUser = _user;
    _user = null;

    if (oldUser != null && oldUser.id.isNotEmpty) {
      try {
        await _sendIdentify(UserContext(id: oldUser.id));
      } catch (_) {}
    }

    await refresh();
  }

  Future<void> refresh() async {
    await _dedup.dedupe<void>('fetch-flags', () async {
      await _fetchFlags();
    });
  }

  bool get isReady => _ready;
  String get circuitState => _circuitBreaker.getStateString();
  MetricsSnapshot get metrics => _metrics.snapshot();
  CacheStats get cacheStats => _cache.getStats();

  void close() {
    _pollingTimer?.cancel();
    _httpClient.close();
    _dedup.clear();
  }

  Future<void> _fetchFlags() async {
    if (!_circuitBreaker.isAllowingRequests()) {
      _useCachedFallback();
      throw RollgateException.circuitOpenError();
    }

    final sw = Stopwatch()..start();

    try {
      await _circuitBreaker.execute(() async {
        final result = await _retryer.doRetry(() => _doFetchRequest());
        if (!result.success) throw result.error!;
      });
      sw.stop();
      _metrics.recordRequest(sw.elapsedMilliseconds, true, ErrorCategory.none);
    } catch (e) {
      sw.stop();
      _metrics.recordRequest(
          sw.elapsedMilliseconds, false, RollgateException.classify(e));
      _useCachedFallback();
      rethrow;
    }
  }

  Future<void> _doFetchRequest() async {
    var url = '${_config.baseUrl}/api/v1/sdk/flags?withReasons=true';

    if (_user != null && _user!.id.isNotEmpty) {
      url += '&user_id=${Uri.encodeComponent(_user!.id)}';
    }

    final headers = <String, String>{
      'Authorization': 'Bearer ${_config.apiKey}',
      'Content-Type': 'application/json',
      'X-SDK-Name': 'rollgate-flutter',
      'X-SDK-Version': '0.1.0',
    };

    if (_lastETag != null) {
      headers['If-None-Match'] = _lastETag!;
    }

    http.Response response;
    try {
      response = await _httpClient
          .get(Uri.parse(url), headers: headers)
          .timeout(_config.timeout);
    } catch (e) {
      if (e is TimeoutException) {
        throw RollgateException.networkError('request timed out', e);
      }
      throw RollgateException.networkError('request failed', e as Exception?);
    }

    if (response.statusCode == 304) return;

    if (response.statusCode != 200) {
      _handleErrorResponse(response);
      return;
    }

    if (response.headers.containsKey('etag')) {
      _lastETag = response.headers['etag'];
    }

    final json = jsonDecode(response.body) as Map<String, dynamic>;

    if (json.containsKey('flags')) {
      final flagsMap = json['flags'] as Map<String, dynamic>;
      _flags = flagsMap.map((k, v) => MapEntry(k, v as bool));

      if (json.containsKey('reasons')) {
        final reasonsMap = json['reasons'] as Map<String, dynamic>;
        _flagReasons = reasonsMap.map(
          (k, v) => MapEntry(k, EvaluationReason.fromJson(v as Map<String, dynamic>)),
        );
      }

      if (_config.cache.enabled) {
        _cache.set(_flags);
      }
    }
  }

  void _handleErrorResponse(http.Response response) {
    final status = response.statusCode;
    switch (status) {
      case 401:
        throw RollgateException.authError('invalid API key');
      case 403:
        throw RollgateException.authError('access denied');
      case 429:
        final retryAfter =
            int.tryParse(response.headers['retry-after'] ?? '') ?? 60;
        throw RollgateException.rateLimitError(retryAfter);
      case 400:
        throw RollgateException.validationError('bad request');
      default:
        if (status >= 500) {
          throw RollgateException.serverError(status, 'server error: $status');
        }
        throw RollgateException('unexpected status code: $status',
            category: ErrorCategory.unknown, statusCode: status);
    }
  }

  Future<void> _sendIdentify(UserContext user) async {
    final url = '${_config.baseUrl}/api/v1/sdk/identify';
    final body = jsonEncode({
      'user': {
        'id': user.id,
        'email': user.email,
        'attributes': user.attributes,
      }
    });

    final response = await _httpClient
        .post(
          Uri.parse(url),
          headers: {
            'Authorization': 'Bearer ${_config.apiKey}',
            'Content-Type': 'application/json',
          },
          body: body,
        )
        .timeout(_config.timeout);

    if (response.statusCode >= 400) {
      throw RollgateException(
          'identify failed with status ${response.statusCode}',
          category: ErrorCategory.server);
    }
  }

  void _useCachedFallback() {
    if (!_config.cache.enabled) return;
    final cached = _cache.get();
    if (cached.found) {
      _flags = cached.flags!;
      _cache.recordHit(cached.stale);
    } else {
      _cache.recordMiss();
    }
  }

  void _startPolling() {
    _pollingTimer = Timer.periodic(_config.refreshInterval, (_) async {
      try {
        await refresh();
      } catch (_) {
        // ignore polling errors
      }
    });
  }
}
