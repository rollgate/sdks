import 'config.dart';

class CacheResult {
  final Map<String, bool>? flags;
  final bool stale;
  final bool found;

  CacheResult({this.flags, this.stale = false, this.found = false});
}

class CacheStats {
  int hits;
  int misses;
  int staleHits;

  CacheStats({this.hits = 0, this.misses = 0, this.staleHits = 0});
}

class FlagCache {
  final CacheConfig _config;
  Map<String, bool>? _flags;
  DateTime? _timestamp;
  final CacheStats _stats = CacheStats();

  FlagCache(this._config);

  CacheResult get() {
    if (_flags == null || _timestamp == null) {
      _stats.misses++;
      return CacheResult(found: false);
    }

    final age = DateTime.now().difference(_timestamp!);

    if (age > _config.staleTtl) {
      _stats.misses++;
      _flags = null;
      _timestamp = null;
      return CacheResult(found: false);
    }

    if (age > _config.ttl) {
      _stats.staleHits++;
      return CacheResult(
        flags: Map<String, bool>.from(_flags!),
        stale: true,
        found: true,
      );
    }

    _stats.hits++;
    return CacheResult(
      flags: Map<String, bool>.from(_flags!),
      stale: false,
      found: true,
    );
  }

  void set(Map<String, bool> flags) {
    _flags = Map<String, bool>.from(flags);
    _timestamp = DateTime.now();
  }

  void clear() {
    _flags = null;
    _timestamp = null;
  }

  bool hasAny() {
    if (_flags == null || _timestamp == null) return false;
    return DateTime.now().difference(_timestamp!) <= _config.staleTtl;
  }

  CacheStats getStats() => CacheStats(
        hits: _stats.hits,
        misses: _stats.misses,
        staleHits: _stats.staleHits,
      );

  void recordHit(bool stale) {
    if (stale) {
      _stats.staleHits++;
    } else {
      _stats.hits++;
    }
  }

  void recordMiss() {
    _stats.misses++;
  }
}
