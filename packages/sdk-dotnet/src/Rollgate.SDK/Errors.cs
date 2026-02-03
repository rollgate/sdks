namespace Rollgate.SDK;

public enum ErrorCategory
{
    None,
    Network,
    Auth,
    RateLimit,
    Validation,
    Server,
    Unknown
}

public class RollgateException : Exception
{
    public ErrorCategory Category { get; }
    public int StatusCode { get; }
    public bool Retryable { get; }

    public RollgateException(string message, ErrorCategory category, int statusCode = 0, bool retryable = false, Exception? inner = null)
        : base(message, inner)
    {
        Category = category;
        StatusCode = statusCode;
        Retryable = retryable;
    }

    public static RollgateException NetworkError(string message, Exception? inner = null)
        => new(message, ErrorCategory.Network, retryable: true, inner: inner);

    public static RollgateException AuthError(string message)
        => new(message, ErrorCategory.Auth, statusCode: 401, retryable: false);

    public static RollgateException RateLimitError(int retryAfter)
        => new($"rate limit exceeded (retry after {retryAfter}s)", ErrorCategory.RateLimit, statusCode: 429, retryable: true);

    public static RollgateException ServerError(int statusCode, string message)
        => new(message, ErrorCategory.Server, statusCode: statusCode, retryable: statusCode >= 500);

    public static RollgateException ValidationError(string message)
        => new(message, ErrorCategory.Validation, statusCode: 400, retryable: false);

    public static RollgateException CircuitOpenError()
        => new("circuit breaker is open", ErrorCategory.Network, retryable: false);

    public static bool IsRetryable(Exception ex)
    {
        if (ex is RollgateException re) return re.Retryable;
        var msg = ex.Message.ToLowerInvariant();
        return msg.Contains("timeout") || msg.Contains("connection refused") ||
               msg.Contains("connection reset") || msg.Contains("503") ||
               msg.Contains("502") || msg.Contains("504") || msg.Contains("429");
    }

    public static ErrorCategory Classify(Exception ex)
    {
        if (ex is RollgateException re) return re.Category;
        var msg = ex.Message.ToLowerInvariant();
        if (msg.Contains("timeout") || msg.Contains("connection")) return ErrorCategory.Network;
        return ErrorCategory.Unknown;
    }
}
