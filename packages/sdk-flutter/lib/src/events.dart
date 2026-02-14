import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Options for tracking a conversion event.
class TrackEventOptions {
  final String flagKey;
  final String eventName;
  final String userId;
  final String? variationId;
  final double? value;
  final Map<String, dynamic>? metadata;

  TrackEventOptions({
    required this.flagKey,
    required this.eventName,
    required this.userId,
    this.variationId,
    this.value,
    this.metadata,
  });
}

/// Configuration for the event collector.
class EventCollectorConfig {
  final int flushIntervalMs;
  final int maxBufferSize;
  final bool enabled;

  const EventCollectorConfig({
    this.flushIntervalMs = 30000,
    this.maxBufferSize = 100,
    this.enabled = true,
  });
}

/// Buffers and batches conversion events for A/B testing.
class EventCollector {
  final String _endpoint;
  final String _apiKey;
  final EventCollectorConfig _config;
  final http.Client _httpClient;

  final List<Map<String, dynamic>> _buffer = [];
  Timer? _flushTimer;

  EventCollector({
    required String endpoint,
    required String apiKey,
    EventCollectorConfig config = const EventCollectorConfig(),
    required http.Client httpClient,
  })  : _endpoint = endpoint,
        _apiKey = apiKey,
        _config = config,
        _httpClient = httpClient;

  /// Start the periodic flush timer.
  void start() {
    if (!_config.enabled) return;
    _flushTimer = Timer.periodic(
      Duration(milliseconds: _config.flushIntervalMs),
      (_) => flush(),
    );
  }

  /// Stop the collector and flush remaining events.
  Future<void> stop() async {
    _flushTimer?.cancel();
    _flushTimer = null;
    try {
      await flush();
    } catch (_) {}
  }

  /// Track a conversion event.
  void track(TrackEventOptions options) {
    if (!_config.enabled) return;

    final event = <String, dynamic>{
      'flagKey': options.flagKey,
      'eventName': options.eventName,
      'userId': options.userId,
      'timestamp': DateTime.now().toUtc().toIso8601String(),
    };

    if (options.variationId != null) event['variationId'] = options.variationId;
    if (options.value != null) event['value'] = options.value;
    if (options.metadata != null) event['metadata'] = options.metadata;

    _buffer.add(event);

    if (_buffer.length >= _config.maxBufferSize) {
      flush();
    }
  }

  /// Flush all buffered events to the server.
  Future<void> flush() async {
    if (_buffer.isEmpty) return;

    final events = List<Map<String, dynamic>>.from(_buffer);
    _buffer.clear();

    try {
      final response = await _httpClient
          .post(
            Uri.parse(_endpoint),
            headers: {
              'Authorization': 'Bearer $_apiKey',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'events': events}),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode >= 400) {
        _reBuffer(events);
      }
    } catch (_) {
      _reBuffer(events);
    }
  }

  /// Get the current buffer size.
  int get bufferSize => _buffer.length;

  void _reBuffer(List<Map<String, dynamic>> events) {
    final combined = [...events, ..._buffer];
    final maxSize = _config.maxBufferSize * 2;
    _buffer.clear();
    if (combined.length > maxSize) {
      _buffer.addAll(combined.sublist(combined.length - maxSize));
    } else {
      _buffer.addAll(combined);
    }
  }
}
