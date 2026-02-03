namespace Rollgate.SDK;

public class MetricsSnapshot
{
    public long TotalRequests { get; set; }
    public long SuccessfulRequests { get; set; }
    public long FailedRequests { get; set; }
    public long CacheHits { get; set; }
    public long CacheMisses { get; set; }
    public long CacheStaleHits { get; set; }
    public string CircuitState { get; set; } = "closed";
    public long CircuitOpenCount { get; set; }
    public long TotalEvaluations { get; set; }
    public long NetworkErrors { get; set; }
    public long AuthErrors { get; set; }
    public long RateLimitErrors { get; set; }
    public long ServerErrors { get; set; }
}

public class SDKMetrics
{
    private readonly object _lock = new();
    private long _totalRequests;
    private long _successfulRequests;
    private long _failedRequests;
    private long _cacheHits;
    private long _cacheMisses;
    private long _cacheStaleHits;
    private string _circuitState = "closed";
    private long _circuitOpenCount;
    private long _totalEvaluations;
    private long _networkErrors;
    private long _authErrors;
    private long _rateLimitErrors;
    private long _serverErrors;

    public void RecordRequest(long latencyMs, bool success, ErrorCategory errCategory)
    {
        Interlocked.Increment(ref _totalRequests);
        if (success)
        {
            Interlocked.Increment(ref _successfulRequests);
        }
        else
        {
            Interlocked.Increment(ref _failedRequests);
            switch (errCategory)
            {
                case ErrorCategory.Network: Interlocked.Increment(ref _networkErrors); break;
                case ErrorCategory.Auth: Interlocked.Increment(ref _authErrors); break;
                case ErrorCategory.RateLimit: Interlocked.Increment(ref _rateLimitErrors); break;
                case ErrorCategory.Server: Interlocked.Increment(ref _serverErrors); break;
            }
        }
    }

    public void RecordCacheHit(bool stale)
    {
        if (stale) Interlocked.Increment(ref _cacheStaleHits);
        else Interlocked.Increment(ref _cacheHits);
    }

    public void RecordCacheMiss()
    {
        Interlocked.Increment(ref _cacheMisses);
    }

    public void RecordCircuitStateChange(CircuitState state)
    {
        lock (_lock)
        {
            _circuitState = state switch
            {
                SDK.CircuitState.Closed => "closed",
                SDK.CircuitState.Open => "open",
                SDK.CircuitState.HalfOpen => "half_open",
                _ => "closed"
            };
            if (state == SDK.CircuitState.Open)
                _circuitOpenCount++;
        }
    }

    public void RecordEvaluation()
    {
        Interlocked.Increment(ref _totalEvaluations);
    }

    public MetricsSnapshot Snapshot()
    {
        lock (_lock)
        {
            return new MetricsSnapshot
            {
                TotalRequests = Interlocked.Read(ref _totalRequests),
                SuccessfulRequests = Interlocked.Read(ref _successfulRequests),
                FailedRequests = Interlocked.Read(ref _failedRequests),
                CacheHits = Interlocked.Read(ref _cacheHits),
                CacheMisses = Interlocked.Read(ref _cacheMisses),
                CacheStaleHits = Interlocked.Read(ref _cacheStaleHits),
                CircuitState = _circuitState,
                CircuitOpenCount = _circuitOpenCount,
                TotalEvaluations = Interlocked.Read(ref _totalEvaluations),
                NetworkErrors = Interlocked.Read(ref _networkErrors),
                AuthErrors = Interlocked.Read(ref _authErrors),
                RateLimitErrors = Interlocked.Read(ref _rateLimitErrors),
                ServerErrors = Interlocked.Read(ref _serverErrors),
            };
        }
    }
}
