import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';

import 'user_context.dart';

/// Determines if a user is in the rollout percentage using SHA-256 consistent hashing.
/// hash = SHA-256(utf8("{flagKey}:{userId}"))
/// value = BigEndian.Uint32(hash[0:4]) % 100
/// result = value < percentage
bool isInRollout(String flagKey, String userId, int percentage) {
  final input = utf8.encode('$flagKey:$userId');
  final hash = sha256.convert(input);
  final bytes = hash.bytes;
  final value = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  // Ensure unsigned comparison
  final unsigned = value & 0xFFFFFFFF;
  return (unsigned % 100) < percentage;
}

Object? getAttributeValue(String attribute, UserContext? user) {
  if (user == null) return null;
  switch (attribute) {
    case 'id':
      return user.id;
    case 'email':
      return user.email;
    default:
      return user.attributes[attribute];
  }
}

bool matchesCondition(String op, Object? attrValue, String condValue, UserContext? user) {
  final exists = attrValue != null && _toString(attrValue).isNotEmpty;

  switch (op) {
    case 'is_set':
      return exists;
    case 'is_not_set':
      return !exists;
  }

  if (!exists) return false;

  final value = _toString(attrValue).toLowerCase();
  final cv = condValue.toLowerCase();

  switch (op) {
    case 'equals':
    case 'eq':
      return value == cv;
    case 'not_equals':
    case 'neq':
      return value != cv;
    case 'contains':
      return value.contains(cv);
    case 'not_contains':
      return !value.contains(cv);
    case 'starts_with':
      return value.startsWith(cv);
    case 'ends_with':
      return value.endsWith(cv);
    case 'in':
      return _splitAndTrim(condValue).any((v) => v.toLowerCase() == value);
    case 'not_in':
      return !_splitAndTrim(condValue).any((v) => v.toLowerCase() == value);
    case 'greater_than':
    case 'gt':
      return _compareNumeric(attrValue, condValue, '>');
    case 'greater_equal':
    case 'gte':
      return _compareNumeric(attrValue, condValue, '>=');
    case 'less_than':
    case 'lt':
      return _compareNumeric(attrValue, condValue, '<');
    case 'less_equal':
    case 'lte':
      return _compareNumeric(attrValue, condValue, '<=');
    case 'regex':
      return _tryRegex(_toString(attrValue), condValue);
    case 'semver_gt':
      return _compareSemver(_toString(attrValue), condValue, '>');
    case 'semver_lt':
      return _compareSemver(_toString(attrValue), condValue, '<');
    case 'semver_eq':
      return _compareSemver(_toString(attrValue), condValue, '=');
    default:
      return false;
  }
}

String _toString(Object? v) {
  if (v == null) return '';
  if (v is String) return v;
  if (v is bool) return v ? 'true' : 'false';
  if (v is num) {
    // Format without trailing .0 for integers
    if (v == v.toInt()) return v.toInt().toString();
    return v.toString();
  }
  return v.toString();
}

List<String> _splitAndTrim(String s) =>
    s.split(',').map((p) => p.trim()).toList();

bool _compareNumeric(Object? attrVal, String condVal, String op) {
  final a = _toDouble(attrVal);
  if (a == null) return false;
  final b = double.tryParse(condVal);
  if (b == null) return false;

  switch (op) {
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    default:
      return false;
  }
}

double? _toDouble(Object? v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v);
  return null;
}

bool _tryRegex(String value, String pattern) {
  try {
    return RegExp(pattern).hasMatch(value);
  } catch (_) {
    return false;
  }
}

bool _compareSemver(String attrVal, String condVal, String op) {
  final a = _parseVersion(attrVal);
  final b = _parseVersion(condVal);
  if (a == null || b == null) return false;

  while (a.length < b.length) a.add(0);
  while (b.length < a.length) b.add(0);

  for (int i = 0; i < a.length; i++) {
    if (a[i] > b[i]) return op == '>' || op == '>=';
    if (a[i] < b[i]) return op == '<' || op == '<=';
  }
  return op == '=' || op == '>=' || op == '<=';
}

List<int>? _parseVersion(String v) {
  final clean = v.startsWith('v') ? v.substring(1) : v;
  final parts = clean.split('.');
  final result = <int>[];
  for (final p in parts) {
    final n = int.tryParse(p);
    if (n == null) return null;
    result.add(n);
  }
  return result;
}
