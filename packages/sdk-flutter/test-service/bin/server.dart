import 'dart:convert';
import 'dart:io';

import 'package:rollgate/rollgate.dart';

RollgateClient? client;

void main() async {
  final port = int.parse(Platform.environment['PORT'] ?? '8008');

  final server = await HttpServer.bind(InternetAddress.anyIPv4, port);
  print('[sdk-flutter test-service] Listening on port $port');

  await for (final request in server) {
    try {
      await handleRequest(request);
    } catch (e) {
      request.response
        ..statusCode = 500
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'error': 'InternalError', 'message': e.toString()}))
        ..close();
    }
  }
}

Future<void> handleRequest(HttpRequest request) async {
  request.response.headers.contentType = ContentType.json;

  if (request.method == 'GET') {
    request.response
      ..write(jsonEncode({'success': true}))
      ..close();
    return;
  }

  if (request.method == 'DELETE') {
    client?.close();
    client = null;
    request.response
      ..write(jsonEncode({'success': true}))
      ..close();
    return;
  }

  if (request.method == 'POST') {
    final body = await utf8.decoder.bind(request).join();
    final json = jsonDecode(body) as Map<String, dynamic>;
    final command = json['command'] as String? ?? '';

    final result = await handleCommand(command, json);
    request.response
      ..write(jsonEncode(result))
      ..close();
    return;
  }

  request.response
    ..statusCode = 405
    ..close();
}

Future<Map<String, dynamic>> handleCommand(
    String command, Map<String, dynamic> body) async {
  switch (command) {
    case 'init':
      return await handleInit(body);
    case 'isEnabled':
      return handleIsEnabled(body);
    case 'isEnabledDetail':
      return handleIsEnabledDetail(body);
    case 'getString':
      return handleGetString(body);
    case 'getNumber':
      return handleGetNumber(body);
    case 'getJson':
      return handleGetJson(body);
    case 'getValueDetail':
      return handleGetValueDetail(body);
    case 'identify':
      return await handleIdentify(body);
    case 'reset':
      return await handleReset();
    case 'getAllFlags':
      return handleGetAllFlags();
    case 'getState':
      return handleGetState();
    case 'track':
      return handleTrack(body);
    case 'flushEvents':
      return await handleFlushEvents();
    case 'close':
      return handleClose();
    default:
      return {
        'error': 'UnknownCommand',
        'message': 'Unknown command: $command'
      };
  }
}

Future<Map<String, dynamic>> handleInit(Map<String, dynamic> body) async {
  try {
    final configMap = body['config'] as Map<String, dynamic>?;
    if (configMap == null) {
      return {'error': 'ValidationError', 'message': 'config is required'};
    }

    final refreshInterval = configMap['refreshInterval'] as int? ?? 0;
    final timeout = configMap['timeout'] as int? ?? 5000;

    final config = RollgateConfig(
      apiKey: configMap['apiKey'] as String? ?? '',
      baseUrl: configMap['baseUrl'] as String? ?? '',
      refreshInterval: refreshInterval > 0
          ? Duration(milliseconds: refreshInterval)
          : Duration.zero,
      timeout: Duration(milliseconds: timeout),
    );

    final c = RollgateClient(config);
    await c.initialize();

    if (body.containsKey('user') && body['user'] != null) {
      final user = parseUser(body['user'] as Map<String, dynamic>);
      if (user != null) {
        await c.identify(user);
      }
    }

    client = c;
    return {'success': true};
  } catch (e) {
    return {'error': 'InitError', 'message': e.toString()};
  }
}

Map<String, dynamic> handleIsEnabled(Map<String, dynamic> body) {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  final flagKey = body['flagKey'] as String? ?? '';
  if (flagKey.isEmpty) {
    return {'error': 'ValidationError', 'message': 'flagKey is required'};
  }

  final defaultValue = body['defaultValue'] as bool? ?? false;
  final value = client!.isEnabled(flagKey, defaultValue);
  return {'value': value};
}

Map<String, dynamic> handleIsEnabledDetail(Map<String, dynamic> body) {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  final flagKey = body['flagKey'] as String? ?? '';
  if (flagKey.isEmpty) {
    return {'error': 'ValidationError', 'message': 'flagKey is required'};
  }

  final defaultValue = body['defaultValue'] as bool? ?? false;
  final detail = client!.isEnabledDetail(flagKey, defaultValue);

  return {
    'value': detail.value,
    'reason': {
      'kind': detail.reason.kind.name,
      'ruleId': detail.reason.ruleId,
      'ruleIndex': detail.reason.ruleIndex,
      'inRollout': detail.reason.inRollout,
      'errorKind': detail.reason.errorKind == EvaluationErrorKind.NONE
          ? null
          : detail.reason.errorKind.name,
    },
    'variationId': detail.variationId,
  };
}

Map<String, dynamic> handleGetString(Map<String, dynamic> body) {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  final flagKey = body['flagKey'] as String? ?? '';
  if (flagKey.isEmpty) {
    return {'error': 'ValidationError', 'message': 'flagKey is required'};
  }

  final defaultValue = body['defaultStringValue'] as String? ?? '';
  final value = client!.getString(flagKey, defaultValue);
  return {'stringValue': value};
}

Map<String, dynamic> handleGetNumber(Map<String, dynamic> body) {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  final flagKey = body['flagKey'] as String? ?? '';
  if (flagKey.isEmpty) {
    return {'error': 'ValidationError', 'message': 'flagKey is required'};
  }

  final defaultValue = (body['defaultNumberValue'] as num?)?.toDouble() ?? 0.0;
  final value = client!.getNumber(flagKey, defaultValue);
  return {'numberValue': value};
}

Map<String, dynamic> handleGetJson(Map<String, dynamic> body) {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  final flagKey = body['flagKey'] as String? ?? '';
  if (flagKey.isEmpty) {
    return {'error': 'ValidationError', 'message': 'flagKey is required'};
  }

  final defaultValue = body['defaultJsonValue'];
  final value = client!.getJson(flagKey, defaultValue);
  return {'jsonValue': value};
}

Map<String, dynamic> handleGetValueDetail(Map<String, dynamic> body) {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  final flagKey = body['flagKey'] as String? ?? '';
  if (flagKey.isEmpty) {
    return {'error': 'ValidationError', 'message': 'flagKey is required'};
  }

  final defaultValue = body['defaultValue'] as bool? ?? false;
  final detail = client!.isEnabledDetail(flagKey, defaultValue);

  return {
    'value': detail.value,
    'reason': {
      'kind': detail.reason.kind.name,
      'ruleId': detail.reason.ruleId,
      'ruleIndex': detail.reason.ruleIndex,
      'inRollout': detail.reason.inRollout,
      'errorKind': detail.reason.errorKind == EvaluationErrorKind.NONE
          ? null
          : detail.reason.errorKind.name,
    },
    'variationId': detail.variationId,
  };
}

Future<Map<String, dynamic>> handleIdentify(Map<String, dynamic> body) async {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  final userMap = body['user'] as Map<String, dynamic>?;
  if (userMap == null) {
    return {'error': 'ValidationError', 'message': 'user is required'};
  }

  final user = parseUser(userMap);
  if (user == null) {
    return {'error': 'ValidationError', 'message': 'invalid user'};
  }

  try {
    await client!.identify(user);
    return {'success': true};
  } catch (e) {
    return {'error': 'IdentifyError', 'message': e.toString()};
  }
}

Future<Map<String, dynamic>> handleReset() async {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  try {
    await client!.reset();
    return {'success': true};
  } catch (e) {
    return {'error': 'ResetError', 'message': e.toString()};
  }
}

Map<String, dynamic> handleGetAllFlags() {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  return {'flags': client!.getAllFlags()};
}

Map<String, dynamic> handleGetState() {
  if (client == null) {
    return {'isReady': false, 'circuitState': 'UNKNOWN'};
  }

  final m = client!.metrics;
  return {
    'isReady': client!.isReady,
    'circuitState': client!.circuitState,
    'cacheStats': {
      'hits': m.cacheHits,
      'misses': m.cacheMisses,
    },
  };
}

Map<String, dynamic> handleTrack(Map<String, dynamic> body) {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  final flagKey = body['flagKey'] as String? ?? '';
  final eventName = body['eventName'] as String? ?? '';
  final userId = body['userId'] as String? ?? '';

  if (flagKey.isEmpty || eventName.isEmpty || userId.isEmpty) {
    return {
      'error': 'ValidationError',
      'message': 'flagKey, eventName, and userId are required'
    };
  }

  final opts = TrackEventOptions(
    flagKey: flagKey,
    eventName: eventName,
    userId: userId,
    variationId: (body['variationId'] as String?)?.isNotEmpty == true
        ? body['variationId'] as String
        : null,
    value: (body['eventValue'] as num?)?.toDouble(),
    metadata: body['eventMetadata'] != null
        ? Map<String, dynamic>.from(body['eventMetadata'] as Map)
        : null,
  );

  client!.track(opts);
  return {'success': true};
}

Future<Map<String, dynamic>> handleFlushEvents() async {
  if (client == null) {
    return {
      'error': 'NotInitializedError',
      'message': 'Client not initialized'
    };
  }

  try {
    await client!.flushEvents();
    return {'success': true};
  } catch (e) {
    return {'error': 'FlushError', 'message': e.toString()};
  }
}

Map<String, dynamic> handleClose() {
  client?.close();
  client = null;
  return {'success': true};
}

UserContext? parseUser(Map<String, dynamic> map) {
  final id = map['id'] as String? ?? '';
  final email = map['email'] as String? ?? '';
  final attributes = <String, dynamic>{};

  if (map.containsKey('attributes') && map['attributes'] != null) {
    final attrs = map['attributes'] as Map<String, dynamic>;
    attrs.forEach((key, value) {
      attributes[key] = value;
    });
  }

  return UserContext(id: id, email: email, attributes: attributes);
}
