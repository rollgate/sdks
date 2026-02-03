namespace Rollgate.SDK;

public class RequestDeduplicator
{
    private readonly object _lock = new();
    private readonly Dictionary<string, TaskCompletionSource<object?>> _inflight = new();

    public async Task<T?> DedupeAsync<T>(string key, Func<Task<T?>> fn)
    {
        TaskCompletionSource<object?>? existing;

        lock (_lock)
        {
            if (_inflight.TryGetValue(key, out existing))
            {
                // Wait for existing request
            }
            else
            {
                existing = null;
                var tcs = new TaskCompletionSource<object?>();
                _inflight[key] = tcs;
            }
        }

        if (existing != null)
        {
            var result = await existing.Task;
            if (result is Exception ex) throw ex;
            return (T?)result;
        }

        TaskCompletionSource<object?> myTcs;
        lock (_lock) { myTcs = _inflight[key]; }

        try
        {
            var result = await fn();
            myTcs.SetResult(result);
            return result;
        }
        catch (Exception ex)
        {
            myTcs.SetResult(ex);
            throw;
        }
        finally
        {
            lock (_lock) { _inflight.Remove(key); }
        }
    }

    public void Clear()
    {
        lock (_lock) { _inflight.Clear(); }
    }
}
