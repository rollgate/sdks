using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace Rollgate.SDK;

/// <summary>
/// Options for tracking a conversion event.
/// </summary>
public class TrackEventOptions
{
    public required string FlagKey { get; set; }
    public required string EventName { get; set; }
    public required string UserId { get; set; }
    public string? VariationId { get; set; }
    public double? Value { get; set; }
    public Dictionary<string, object>? Metadata { get; set; }
}

/// <summary>
/// Configuration for the event collector.
/// </summary>
public class EventCollectorConfig
{
    public int FlushIntervalMs { get; set; } = 30000;
    public int MaxBufferSize { get; set; } = 100;
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// Buffers and batches conversion events for A/B testing.
/// </summary>
public class EventCollector : IDisposable
{
    private readonly string _endpoint;
    private readonly string _apiKey;
    private readonly HttpClient _httpClient;
    private readonly EventCollectorConfig _config;
    private readonly object _lock = new();
    private readonly List<Dictionary<string, object?>> _buffer = new();
    private CancellationTokenSource? _flushCts;

    public EventCollector(string endpoint, string apiKey, HttpClient httpClient, EventCollectorConfig? config = null)
    {
        _endpoint = endpoint;
        _apiKey = apiKey;
        _httpClient = httpClient;
        _config = config ?? new EventCollectorConfig();
    }

    /// <summary>
    /// Start the periodic flush task.
    /// </summary>
    public void Start()
    {
        if (!_config.Enabled) return;

        _flushCts = new CancellationTokenSource();
        var ct = _flushCts.Token;
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try { await Task.Delay(_config.FlushIntervalMs, ct); }
                catch (OperationCanceledException) { return; }
                try { await FlushAsync(ct); }
                catch { /* ignore flush errors */ }
            }
        }, ct);
    }

    /// <summary>
    /// Track a conversion event.
    /// </summary>
    public void Track(TrackEventOptions options)
    {
        if (!_config.Enabled) return;

        var evt = new Dictionary<string, object?>
        {
            ["flagKey"] = options.FlagKey,
            ["eventName"] = options.EventName,
            ["userId"] = options.UserId,
            ["timestamp"] = DateTime.UtcNow.ToString("O"),
        };

        if (options.VariationId != null) evt["variationId"] = options.VariationId;
        if (options.Value != null) evt["value"] = options.Value;
        if (options.Metadata != null) evt["metadata"] = options.Metadata;

        bool shouldFlush;
        lock (_lock)
        {
            _buffer.Add(evt);
            shouldFlush = _buffer.Count >= _config.MaxBufferSize;
        }

        if (shouldFlush)
        {
            _ = Task.Run(async () => { try { await FlushAsync(); } catch { } });
        }
    }

    /// <summary>
    /// Flush all buffered events to the server.
    /// </summary>
    public async Task FlushAsync(CancellationToken ct = default)
    {
        List<Dictionary<string, object?>> events;
        lock (_lock)
        {
            if (_buffer.Count == 0) return;
            events = new List<Dictionary<string, object?>>(_buffer);
            _buffer.Clear();
        }

        var payload = new Dictionary<string, object> { ["events"] = events };
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
                ReBuffer(events);
            }
        }
        catch
        {
            ReBuffer(events);
            throw;
        }
    }

    /// <summary>
    /// Get the current buffer size.
    /// </summary>
    public int BufferSize
    {
        get { lock (_lock) { return _buffer.Count; } }
    }

    public void Dispose()
    {
        _flushCts?.Cancel();
        // Best-effort final flush
        try { FlushAsync().GetAwaiter().GetResult(); }
        catch { }
    }

    private void ReBuffer(List<Dictionary<string, object?>> events)
    {
        lock (_lock)
        {
            events.AddRange(_buffer);
            _buffer.Clear();
            var maxSize = _config.MaxBufferSize * 2;
            if (events.Count > maxSize)
                _buffer.AddRange(events.GetRange(events.Count - maxSize, maxSize));
            else
                _buffer.AddRange(events);
        }
    }
}
