namespace Rollgate.SDK;

public class RollgateConfig
{
    public string ApiKey { get; set; } = "";
    public string BaseUrl { get; set; } = "https://api.rollgate.io";
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(5);
    public TimeSpan RefreshInterval { get; set; } = TimeSpan.FromSeconds(30);
    public bool EnableStreaming { get; set; }
    public string? SseUrl { get; set; }
    public RetryConfig Retry { get; set; } = new();
    public CircuitBreakerConfig CircuitBreaker { get; set; } = new();
    public CacheConfig Cache { get; set; } = new();
}

public class RetryConfig
{
    public int MaxRetries { get; set; } = 3;
    public TimeSpan BaseDelay { get; set; } = TimeSpan.FromMilliseconds(100);
    public TimeSpan MaxDelay { get; set; } = TimeSpan.FromSeconds(10);
    public double JitterFactor { get; set; } = 0.1;
}

public class CircuitBreakerConfig
{
    public int FailureThreshold { get; set; } = 5;
    public TimeSpan RecoveryTimeout { get; set; } = TimeSpan.FromSeconds(30);
    public TimeSpan MonitoringWindow { get; set; } = TimeSpan.FromSeconds(60);
    public int SuccessThreshold { get; set; } = 3;
}

public class CacheConfig
{
    public TimeSpan Ttl { get; set; } = TimeSpan.FromMinutes(5);
    public TimeSpan StaleTtl { get; set; } = TimeSpan.FromHours(1);
    public bool Enabled { get; set; } = true;
}
