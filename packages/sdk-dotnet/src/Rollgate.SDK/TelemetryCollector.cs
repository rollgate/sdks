using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Rollgate.SDK;

/// <summary>
/// Collects flag evaluation telemetry and flushes periodically to the server.
/// Thread-safe via ConcurrentDictionary and Interlocked operations.
/// </summary>
public class TelemetryCollector : IDisposable
{
    private readonly string _endpoint;
    private readonly string _apiKey;
    private readonly int _flushIntervalMs;
    private readonly int _maxBufferSize;
    private readonly HttpClient _httpClient;
    private readonly ConcurrentDictionary<string, TelemetryEvalStats> _evaluations = new();
    private CancellationTokenSource? _flushCts;
    private long _periodStartTicks;

    /// <summary>
    /// Tracks evaluation counts for a single flag. Thread-safe via Interlocked.
    /// </summary>
    private class TelemetryEvalStats
    {
        private int _total;
        private int _trueCount;
        private int _falseCount;

        public int Total => _total;
        public int TrueCount => _trueCount;
        public int FalseCount => _falseCount;

        public void Record(bool value)
        {
            Interlocked.Increment(ref _total);
            if (value)
                Interlocked.Increment(ref _trueCount);
            else
                Interlocked.Increment(ref _falseCount);
        }
    }

    public TelemetryCollector(
        string endpoint,
        string apiKey,
        int flushIntervalMs,
        int maxBufferSize,
        HttpClient httpClient)
    {
        _endpoint = endpoint;
        _apiKey = apiKey;
        _flushIntervalMs = flushIntervalMs;
        _maxBufferSize = maxBufferSize;
        _httpClient = httpClient;
        _periodStartTicks = Environment.TickCount64;
    }

    /// <summary>
    /// Start the periodic flush task.
    /// </summary>
    public void Start()
    {
        _flushCts = new CancellationTokenSource();
        var ct = _flushCts.Token;
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try { await Task.Delay(_flushIntervalMs, ct); }
                catch (OperationCanceledException) { return; }
                try { await FlushAsync(ct); }
                catch { /* ignore flush errors */ }
            }
        }, ct);
    }

    /// <summary>
    /// Stop the periodic flush and perform a final flush.
    /// </summary>
    public async Task StopAsync()
    {
        _flushCts?.Cancel();
        try { await FlushAsync(); }
        catch { /* best-effort final flush */ }
    }

    /// <summary>
    /// Record a flag evaluation result.
    /// </summary>
    public void RecordEvaluation(string flagKey, bool result)
    {
        var stats = _evaluations.GetOrAdd(flagKey, _ => new TelemetryEvalStats());
        stats.Record(result);

        // Auto-flush if buffer exceeds max size
        if (_evaluations.Count >= _maxBufferSize)
        {
            _ = Task.Run(async () => { try { await FlushAsync(); } catch { } });
        }
    }

    /// <summary>
    /// Flush all buffered telemetry to the server.
    /// </summary>
    public async Task FlushAsync(CancellationToken ct = default)
    {
        // Snapshot and clear atomically
        var snapshot = new Dictionary<string, TelemetryEvalStats>();
        foreach (var key in _evaluations.Keys)
        {
            if (_evaluations.TryRemove(key, out var stats))
                snapshot[key] = stats;
        }

        if (snapshot.Count == 0) return;

        var now = Environment.TickCount64;
        var periodMs = now - _periodStartTicks;
        _periodStartTicks = now;

        var evaluations = new Dictionary<string, object>();
        foreach (var kv in snapshot)
        {
            evaluations[kv.Key] = new Dictionary<string, int>
            {
                ["total"] = kv.Value.Total,
                ["true"] = kv.Value.TrueCount,
                ["false"] = kv.Value.FalseCount,
            };
        }

        var payload = new Dictionary<string, object>
        {
            ["evaluations"] = evaluations,
            ["period_ms"] = periodMs,
        };

        var json = JsonSerializer.Serialize(payload);
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var request = new HttpRequestMessage(HttpMethod.Post, _endpoint) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);

        try
        {
            using var requestCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            requestCts.CancelAfter(TimeSpan.FromSeconds(10));
            var response = await _httpClient.SendAsync(request, requestCts.Token);

            if (!response.IsSuccessStatusCode)
            {
                ReBuffer(snapshot);
            }
        }
        catch
        {
            ReBuffer(snapshot);
            throw;
        }
    }

    /// <summary>
    /// Get current buffer statistics.
    /// </summary>
    public (int flagCount, int evaluationCount) GetBufferStats()
    {
        var flagCount = _evaluations.Count;
        var evaluationCount = 0;
        foreach (var kv in _evaluations)
        {
            evaluationCount += kv.Value.Total;
        }
        return (flagCount, evaluationCount);
    }

    public void Dispose()
    {
        _flushCts?.Cancel();
        // Best-effort final flush
        try { FlushAsync().GetAwaiter().GetResult(); }
        catch { }
    }

    /// <summary>
    /// Re-buffer stats on flush failure to avoid data loss.
    /// </summary>
    private void ReBuffer(Dictionary<string, TelemetryEvalStats> snapshot)
    {
        foreach (var kv in snapshot)
        {
            _evaluations.AddOrUpdate(
                kv.Key,
                _ => kv.Value,
                (_, existing) =>
                {
                    // Merge: record each evaluation from the failed snapshot into the existing stats
                    for (var i = 0; i < kv.Value.TrueCount; i++) existing.Record(true);
                    for (var i = 0; i < kv.Value.FalseCount; i++) existing.Record(false);
                    return existing;
                });
        }
    }
}
