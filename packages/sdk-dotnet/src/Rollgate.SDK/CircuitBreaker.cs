namespace Rollgate.SDK;

public enum CircuitState
{
    Closed,
    Open,
    HalfOpen
}

public class CircuitBreaker
{
    private readonly CircuitBreakerConfig _config;
    private readonly object _lock = new();
    private CircuitState _state = CircuitState.Closed;
    private readonly List<DateTime> _failures = new();
    private DateTime _openedAt;
    private int _halfOpenSuccesses;
    private Action<CircuitState, CircuitState>? _onStateChange;

    public CircuitBreaker(CircuitBreakerConfig config)
    {
        _config = config;
    }

    public void Execute(Action fn)
    {
        if (!IsAllowingRequests())
            throw RollgateException.CircuitOpenError();

        lock (_lock)
        {
            if (_state == CircuitState.Open)
                TransitionTo(CircuitState.HalfOpen);
        }

        try
        {
            fn();
            lock (_lock) { RecordSuccess(); }
        }
        catch
        {
            lock (_lock) { RecordFailure(); }
            throw;
        }
    }

    public async Task ExecuteAsync(Func<Task> fn)
    {
        if (!IsAllowingRequests())
            throw RollgateException.CircuitOpenError();

        lock (_lock)
        {
            if (_state == CircuitState.Open)
                TransitionTo(CircuitState.HalfOpen);
        }

        try
        {
            await fn();
            lock (_lock) { RecordSuccess(); }
        }
        catch
        {
            lock (_lock) { RecordFailure(); }
            throw;
        }
    }

    public bool IsAllowingRequests()
    {
        lock (_lock)
        {
            return _state switch
            {
                CircuitState.Closed => true,
                CircuitState.HalfOpen => true,
                CircuitState.Open => (DateTime.UtcNow - _openedAt) >= _config.RecoveryTimeout,
                _ => true
            };
        }
    }

    public CircuitState GetState()
    {
        lock (_lock) { return _state; }
    }

    public string GetStateString()
    {
        lock (_lock)
        {
            return _state switch
            {
                CircuitState.Closed => "closed",
                CircuitState.Open => "open",
                CircuitState.HalfOpen => "half_open",
                _ => "closed"
            };
        }
    }

    public void OnStateChange(Action<CircuitState, CircuitState> fn)
    {
        lock (_lock) { _onStateChange = fn; }
    }

    private void RecordFailure()
    {
        var now = DateTime.UtcNow;
        _failures.Add(now);
        CleanOldFailures();

        if (_state == CircuitState.HalfOpen)
        {
            TransitionTo(CircuitState.Open);
            return;
        }

        if (CountRecentFailures() >= _config.FailureThreshold)
            TransitionTo(CircuitState.Open);
    }

    private void RecordSuccess()
    {
        if (_state == CircuitState.HalfOpen)
        {
            _halfOpenSuccesses++;
            if (_halfOpenSuccesses >= _config.SuccessThreshold)
                TransitionTo(CircuitState.Closed);
        }
    }

    private void TransitionTo(CircuitState newState)
    {
        if (_state == newState) return;
        var oldState = _state;
        _state = newState;

        if (newState == CircuitState.Open)
            _openedAt = DateTime.UtcNow;
        if (newState == CircuitState.Closed)
        {
            _failures.Clear();
            _halfOpenSuccesses = 0;
        }
        if (newState == CircuitState.HalfOpen)
            _halfOpenSuccesses = 0;

        _onStateChange?.Invoke(oldState, newState);
    }

    private void CleanOldFailures()
    {
        var cutoff = DateTime.UtcNow - _config.MonitoringWindow;
        _failures.RemoveAll(f => f < cutoff);
    }

    private int CountRecentFailures()
    {
        var cutoff = DateTime.UtcNow - _config.MonitoringWindow;
        return _failures.Count(f => f >= cutoff);
    }
}
