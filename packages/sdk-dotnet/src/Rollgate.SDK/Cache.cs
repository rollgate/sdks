namespace Rollgate.SDK;

public class CacheResult
{
    public Dictionary<string, bool>? Flags { get; set; }
    public bool Stale { get; set; }
    public bool Found { get; set; }
}

public class CacheStats
{
    public long Hits { get; set; }
    public long Misses { get; set; }
    public long StaleHits { get; set; }
}

public class FlagCache
{
    private readonly CacheConfig _config;
    private readonly object _lock = new();
    private Dictionary<string, bool>? _flags;
    private DateTime _timestamp;
    private long _hits;
    private long _misses;
    private long _staleHits;

    public FlagCache(CacheConfig config)
    {
        _config = config;
    }

    public CacheResult Get()
    {
        lock (_lock)
        {
            if (_flags == null)
            {
                _misses++;
                return new CacheResult { Found = false };
            }

            var age = DateTime.UtcNow - _timestamp;

            if (age > _config.StaleTtl)
            {
                _misses++;
                _flags = null;
                return new CacheResult { Found = false };
            }

            if (age > _config.Ttl)
            {
                _staleHits++;
                return new CacheResult
                {
                    Flags = new Dictionary<string, bool>(_flags),
                    Stale = true,
                    Found = true
                };
            }

            _hits++;
            return new CacheResult
            {
                Flags = new Dictionary<string, bool>(_flags),
                Stale = false,
                Found = true
            };
        }
    }

    public void Set(Dictionary<string, bool> flags)
    {
        lock (_lock)
        {
            _flags = new Dictionary<string, bool>(flags);
            _timestamp = DateTime.UtcNow;
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _flags = null;
        }
    }

    public bool HasAny()
    {
        lock (_lock)
        {
            if (_flags == null) return false;
            return (DateTime.UtcNow - _timestamp) <= _config.StaleTtl;
        }
    }

    public CacheStats GetStats()
    {
        lock (_lock)
        {
            return new CacheStats
            {
                Hits = _hits,
                Misses = _misses,
                StaleHits = _staleHits
            };
        }
    }

    public void RecordHit(bool stale)
    {
        lock (_lock)
        {
            if (stale) _staleHits++;
            else _hits++;
        }
    }

    public void RecordMiss()
    {
        lock (_lock)
        {
            _misses++;
        }
    }
}
