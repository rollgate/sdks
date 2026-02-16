import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Evaluation statistics for a single flag.
class TelemetryEvalStats {
  int total = 0;
  int trueCount = 0;
  int falseCount = 0;

  Map<String, dynamic> toJson() => {
        'total': total,
        'true': trueCount,
        'false': falseCount,
      };
}

/// Configuration for telemetry collection.
class TelemetryConfig {
  final int flushIntervalMs;
  final int maxBufferSize;
  final bool enabled;

  const TelemetryConfig({
    this.flushIntervalMs = 60000,
    this.maxBufferSize = 1000,
    this.enabled = true,
  });
}

/// Tracks flag evaluations and sends them to the server in batches.
class TelemetryCollector {
  final String _endpoint;
  final String _apiKey;
  final TelemetryConfig _config;
  final http.Client _httpClient;

  Map<String, TelemetryEvalStats> _evaluations = {};
  int _totalBuffered = 0;
  bool _isFlushing = false;
  Timer? _flushTimer;
  int _lastFlushTime = 0;

  TelemetryCollector({
    required String endpoint,
    required String apiKey,
    required http.Client httpClient,
    TelemetryConfig config = const TelemetryConfig(),
  })  : _endpoint = endpoint,
        _apiKey = apiKey,
        _httpClient = httpClient,
        _config = config;

  /// Start periodic flushing.
  void start() {
    if (!_config.enabled || _endpoint.isEmpty || _apiKey.isEmpty) {
      return;
    }

    _lastFlushTime = DateTime.now().millisecondsSinceEpoch;
    _flushTimer = Timer.periodic(
      Duration(milliseconds: _config.flushIntervalMs),
      (_) async {
        try {
          await flush();
        } catch (_) {}
      },
    );
  }

  /// Stop the collector and perform a final flush.
  Future<void> stop() async {
    _flushTimer?.cancel();
    _flushTimer = null;
    await flush();
  }

  /// Record a single flag evaluation.
  void recordEvaluation(String flagKey, bool result) {
    if (!_config.enabled) return;

    _evaluations.putIfAbsent(flagKey, () => TelemetryEvalStats());
    final stats = _evaluations[flagKey]!;
    stats.total++;
    if (result) {
      stats.trueCount++;
    } else {
      stats.falseCount++;
    }
    _totalBuffered++;

    if (_totalBuffered >= _config.maxBufferSize) {
      flush().catchError((_) {});
    }
  }

  /// Flush buffered evaluations to the server.
  Future<void> flush() async {
    if (_isFlushing || _evaluations.isEmpty) return;
    if (_endpoint.isEmpty || _apiKey.isEmpty) return;

    _isFlushing = true;

    // Capture current data and reset buffer
    final evaluationsToSend = Map<String, TelemetryEvalStats>.from(_evaluations);
    final now = DateTime.now().millisecondsSinceEpoch;
    final periodMs = _lastFlushTime > 0 ? now - _lastFlushTime : 0;
    _evaluations = {};
    _totalBuffered = 0;
    _lastFlushTime = now;

    final payload = {
      'evaluations': {
        for (final entry in evaluationsToSend.entries)
          entry.key: entry.value.toJson(),
      },
      'period_ms': periodMs,
    };

    try {
      final response = await _httpClient.post(
        Uri.parse(_endpoint),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $_apiKey',
        },
        body: jsonEncode(payload),
      );

      if (response.statusCode != 200) {
        throw Exception('Telemetry request failed: ${response.statusCode}');
      }
    } catch (e) {
      // Restore buffer on failure
      for (final entry in evaluationsToSend.entries) {
        _evaluations.putIfAbsent(entry.key, () => TelemetryEvalStats());
        final existing = _evaluations[entry.key]!;
        existing.total += entry.value.total;
        existing.trueCount += entry.value.trueCount;
        existing.falseCount += entry.value.falseCount;
        _totalBuffered += entry.value.total;
      }
      rethrow;
    } finally {
      _isFlushing = false;
    }
  }

  /// Get current buffer statistics.
  Map<String, int> getBufferStats() => {
        'flagCount': _evaluations.length,
        'evaluationCount': _totalBuffered,
      };
}
