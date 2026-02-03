namespace Rollgate.SDK;

public class RetryResult
{
    public bool Success { get; set; }
    public int Attempts { get; set; }
    public Exception? Error { get; set; }
}

public class Retryer
{
    private readonly RetryConfig _config;
    private static readonly Random _random = new();

    public Retryer(RetryConfig config)
    {
        _config = config;
    }

    public RetryResult Do(CancellationToken ct, Action fn)
    {
        Exception? lastErr = null;
        int attempts = 0;

        while (attempts <= _config.MaxRetries)
        {
            attempts++;
            try
            {
                fn();
                return new RetryResult { Success = true, Attempts = attempts };
            }
            catch (Exception ex)
            {
                lastErr = ex;
                if (!RollgateException.IsRetryable(ex))
                    return new RetryResult { Success = false, Attempts = attempts, Error = ex };
                if (attempts > _config.MaxRetries) break;
                var delay = CalculateBackoff(attempts - 1);
                try { Task.Delay(delay, ct).Wait(ct); }
                catch (OperationCanceledException)
                {
                    return new RetryResult { Success = false, Attempts = attempts, Error = ex };
                }
            }
        }

        return new RetryResult { Success = false, Attempts = attempts, Error = lastErr };
    }

    public async Task<RetryResult> DoAsync(CancellationToken ct, Func<Task> fn)
    {
        Exception? lastErr = null;
        int attempts = 0;

        while (attempts <= _config.MaxRetries)
        {
            attempts++;
            try
            {
                await fn();
                return new RetryResult { Success = true, Attempts = attempts };
            }
            catch (Exception ex)
            {
                lastErr = ex;
                if (!RollgateException.IsRetryable(ex))
                    return new RetryResult { Success = false, Attempts = attempts, Error = ex };
                if (attempts > _config.MaxRetries) break;
                var delay = CalculateBackoff(attempts - 1);
                try { await Task.Delay(delay, ct); }
                catch (OperationCanceledException)
                {
                    return new RetryResult { Success = false, Attempts = attempts, Error = ex };
                }
            }
        }

        return new RetryResult { Success = false, Attempts = attempts, Error = lastErr };
    }

    private TimeSpan CalculateBackoff(int attempt)
    {
        double delay = _config.BaseDelay.TotalMilliseconds * Math.Pow(2, attempt);
        if (_config.JitterFactor > 0)
        {
            double jitter = delay * _config.JitterFactor * (_random.NextDouble() * 2 - 1);
            delay += jitter;
        }
        if (delay < 0) delay = 0;
        if (delay > _config.MaxDelay.TotalMilliseconds)
            delay = _config.MaxDelay.TotalMilliseconds;
        return TimeSpan.FromMilliseconds(delay);
    }
}
