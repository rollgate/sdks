using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Rollgate.SDK;

public class RollgateClient : IDisposable
{
    private readonly RollgateConfig _config;
    private readonly HttpClient _httpClient;
    private readonly CircuitBreaker _circuitBreaker;
    private readonly FlagCache _cache;
    private readonly Retryer _retryer;
    private readonly RequestDeduplicator _dedup;
    private readonly SDKMetrics _metrics;
    private readonly object _lock = new();

    private Dictionary<string, bool> _flags = new();
    private Dictionary<string, EvaluationReason> _flagReasons = new();
    private UserContext? _user;
    private string? _lastETag;
    private bool _ready;
    private CancellationTokenSource? _pollingCts;
    private SSEClient? _sseClient;
    private bool _streaming;

    public RollgateClient(RollgateConfig config)
    {
        if (string.IsNullOrEmpty(config.ApiKey))
            throw new ArgumentException("API key is required");

        _config = config;
        var handler = new SocketsHttpHandler
        {
            UseProxy = false,
            AllowAutoRedirect = false,
            PooledConnectionIdleTimeout = TimeSpan.FromMinutes(5),
            ConnectCallback = async (context, ct) =>
            {
                var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
                socket.NoDelay = true;
                try
                {
                    var host = context.DnsEndPoint.Host;
                    var addresses = await Dns.GetHostAddressesAsync(host, AddressFamily.InterNetwork, ct);
                    await socket.ConnectAsync(new IPEndPoint(addresses[0], context.DnsEndPoint.Port), ct);
                    return new NetworkStream(socket, ownsSocket: true);
                }
                catch
                {
                    socket.Dispose();
                    throw;
                }
            },
        };
        _httpClient = new HttpClient(handler) { Timeout = System.Threading.Timeout.InfiniteTimeSpan };
        _circuitBreaker = new CircuitBreaker(config.CircuitBreaker);
        _cache = new FlagCache(config.Cache);
        _retryer = new Retryer(config.Retry);
        _dedup = new RequestDeduplicator();
        _metrics = new SDKMetrics();

        _circuitBreaker.OnStateChange((from, to) => _metrics.RecordCircuitStateChange(to));
    }

    public async Task InitializeAsync(CancellationToken ct = default)
    {
        if (_config.Cache.Enabled)
        {
            var cached = _cache.Get();
            if (cached.Found)
            {
                lock (_lock) { _flags = cached.Flags!; }
                _cache.RecordHit(cached.Stale);
            }
        }

        if (_config.EnableStreaming)
        {
            await InitializeWithSSEAsync(ct);
            return;
        }

        try
        {
            await RefreshAsync(ct);
        }
        catch
        {
            if (!_cache.HasAny()) throw;
        }

        lock (_lock) { _ready = true; }

        if (_config.RefreshInterval > TimeSpan.Zero)
            StartPolling();
    }

    private async Task InitializeWithSSEAsync(CancellationToken ct)
    {
        try { await RefreshAsync(ct); }
        catch { if (!_cache.HasAny()) throw; }

        lock (_lock)
        {
            _ready = true;
            _streaming = true;
        }

        _sseClient = new SSEClient(_config);
        _sseClient.OnFlags(flags =>
        {
            lock (_lock)
            {
                if (flags.Count == 1)
                {
                    foreach (var kv in flags) _flags[kv.Key] = kv.Value;
                }
                else
                {
                    _flags = flags;
                    if (_config.Cache.Enabled) _cache.Set(flags);
                }
            }
        });
        _sseClient.OnError(_ => { });
        _sseClient.OnConnect(() => { });

        UserContext? user;
        lock (_lock) { user = _user; }
        _sseClient.Connect(user);
    }

    public bool IsEnabled(string flagKey, bool defaultValue = false)
        => IsEnabledDetail(flagKey, defaultValue).Value;

    public EvaluationDetail<bool> IsEnabledDetail(string flagKey, bool defaultValue = false)
    {
        _metrics.RecordEvaluation();

        lock (_lock)
        {
            if (!_ready)
                return new EvaluationDetail<bool>
                {
                    Value = defaultValue,
                    Reason = EvaluationReason.Error(EvaluationErrorKind.CLIENT_NOT_READY)
                };

            if (!_flags.TryGetValue(flagKey, out var value))
                return new EvaluationDetail<bool>
                {
                    Value = defaultValue,
                    Reason = EvaluationReason.Unknown()
                };

            if (_flagReasons.TryGetValue(flagKey, out var reason))
                return new EvaluationDetail<bool> { Value = value, Reason = reason };

            return new EvaluationDetail<bool>
            {
                Value = value,
                Reason = EvaluationReason.Fallthrough(value)
            };
        }
    }

    public Dictionary<string, bool> GetAllFlags()
    {
        lock (_lock) { return new Dictionary<string, bool>(_flags); }
    }

    public string GetString(string flagKey, string defaultValue) => defaultValue;
    public double GetNumber(string flagKey, double defaultValue) => defaultValue;
    public object? GetJson(string flagKey, object? defaultValue) => defaultValue;

    public async Task IdentifyAsync(UserContext user, CancellationToken ct = default)
    {
        lock (_lock) { _user = user; }

        if (!string.IsNullOrEmpty(user.Id))
        {
            try { await SendIdentifyAsync(user, ct); }
            catch { /* log but don't fail */ }
        }

        await RefreshAsync(ct);
    }

    public async Task ResetAsync(CancellationToken ct = default)
    {
        UserContext? oldUser;
        lock (_lock)
        {
            oldUser = _user;
            _user = null;
        }

        if (oldUser != null && !string.IsNullOrEmpty(oldUser.Id))
        {
            try { await SendIdentifyAsync(new UserContext { Id = oldUser.Id }, ct); }
            catch { }
        }

        await RefreshAsync(ct);
    }

    public async Task RefreshAsync(CancellationToken ct = default)
    {
        await _dedup.DedupeAsync<object?>("fetch-flags", async () =>
        {
            await FetchFlagsAsync(ct);
            return null;
        });
    }

    public bool IsReady { get { lock (_lock) { return _ready; } } }
    public bool IsStreaming { get { lock (_lock) { return _streaming; } } }

    public string GetCircuitState() => _circuitBreaker.GetStateString();

    public MetricsSnapshot GetMetrics() => _metrics.Snapshot();

    public CacheStats GetCacheStats() => _cache.GetStats();

    public void Dispose()
    {
        _pollingCts?.Cancel();
        _sseClient?.Dispose();
        _httpClient.Dispose();
        _dedup.Clear();
    }

    private async Task FetchFlagsAsync(CancellationToken ct)
    {
        if (!_circuitBreaker.IsAllowingRequests())
        {
            UseCachedFallback();
            throw RollgateException.CircuitOpenError();
        }

        var sw = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            await _circuitBreaker.ExecuteAsync(async () =>
            {
                var result = await _retryer.DoAsync(ct, () => DoFetchRequest(ct));
                if (!result.Success) throw result.Error!;
            });
        }
        catch (Exception ex)
        {
            sw.Stop();
            _metrics.RecordRequest(sw.ElapsedMilliseconds, false, RollgateException.Classify(ex));
            UseCachedFallback();
            throw;
        }

        sw.Stop();
        _metrics.RecordRequest(sw.ElapsedMilliseconds, true, ErrorCategory.None);
    }

    private async Task DoFetchRequest(CancellationToken ct)
    {
        var url = $"{_config.BaseUrl}/api/v1/sdk/flags?withReasons=true";

        string? userId;
        string? etag;
        lock (_lock)
        {
            userId = _user?.Id;
            etag = _lastETag;
        }

        if (!string.IsNullOrEmpty(userId))
            url += $"&user_id={Uri.EscapeDataString(userId)}";

        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.ApiKey);
        request.Headers.Add("X-SDK-Name", "rollgate-dotnet");
        request.Headers.Add("X-SDK-Version", "0.1.0");

        if (!string.IsNullOrEmpty(etag))
            request.Headers.IfNoneMatch.Add(new EntityTagHeaderValue(etag));

        HttpResponseMessage response;
        try
        {
            using var requestCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            requestCts.CancelAfter(_config.Timeout);
            response = await _httpClient.SendAsync(request, requestCts.Token);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw RollgateException.NetworkError("request timed out");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw RollgateException.NetworkError("request failed", ex);
        }

        if (response.StatusCode == System.Net.HttpStatusCode.NotModified)
            return;

        if (!response.IsSuccessStatusCode)
        {
            HandleErrorResponse(response);
            return;
        }

        if (response.Headers.ETag != null)
            lock (_lock) { _lastETag = response.Headers.ETag.Tag; }

        var body = await response.Content.ReadAsStringAsync(ct);
        var json = JsonSerializer.Deserialize<JsonElement>(body);

        if (json.TryGetProperty("flags", out var flagsEl))
        {
            var flags = new Dictionary<string, bool>();
            foreach (var prop in flagsEl.EnumerateObject())
                flags[prop.Name] = prop.Value.GetBoolean();

            var reasons = new Dictionary<string, EvaluationReason>();
            if (json.TryGetProperty("reasons", out var reasonsEl))
            {
                foreach (var prop in reasonsEl.EnumerateObject())
                {
                    var r = new EvaluationReason();
                    if (prop.Value.TryGetProperty("kind", out var kindEl))
                    {
                        var kindStr = kindEl.GetString() ?? "UNKNOWN";
                        r.Kind = Enum.TryParse<EvaluationReasonKind>(kindStr, true, out var k) ? k : EvaluationReasonKind.UNKNOWN;
                    }
                    if (prop.Value.TryGetProperty("ruleId", out var ruleIdEl))
                        r.RuleId = ruleIdEl.GetString();
                    if (prop.Value.TryGetProperty("ruleIndex", out var ruleIndexEl))
                        r.RuleIndex = ruleIndexEl.GetInt32();
                    if (prop.Value.TryGetProperty("inRollout", out var inRolloutEl))
                        r.InRollout = inRolloutEl.GetBoolean();
                    if (prop.Value.TryGetProperty("errorKind", out var errorKindEl))
                    {
                        var ekStr = errorKindEl.GetString() ?? "";
                        r.ErrorKind = Enum.TryParse<EvaluationErrorKind>(ekStr, true, out var ek) ? ek : EvaluationErrorKind.NONE;
                    }
                    reasons[prop.Name] = r;
                }
            }

            lock (_lock)
            {
                _flags = flags;
                if (reasons.Count > 0) _flagReasons = reasons;
            }

            if (_config.Cache.Enabled)
                _cache.Set(flags);
        }
    }

    private void HandleErrorResponse(HttpResponseMessage response)
    {
        var status = (int)response.StatusCode;
        throw status switch
        {
            401 => RollgateException.AuthError("invalid API key"),
            403 => RollgateException.AuthError("access denied"),
            429 => RollgateException.RateLimitError(ParseRetryAfter(response)),
            400 => RollgateException.ValidationError("bad request"),
            >= 500 => RollgateException.ServerError(status, $"server error: {status}"),
            _ => new RollgateException($"unexpected status code: {status}", ErrorCategory.Unknown, status)
        };
    }

    private static int ParseRetryAfter(HttpResponseMessage response)
    {
        if (response.Headers.TryGetValues("Retry-After", out var values))
        {
            var val = values.FirstOrDefault();
            if (val != null && int.TryParse(val, out var seconds))
                return seconds;
        }
        return 60;
    }

    private async Task SendIdentifyAsync(UserContext user, CancellationToken ct)
    {
        var url = $"{_config.BaseUrl}/api/v1/sdk/identify";
        var payload = new
        {
            user = new
            {
                id = user.Id,
                email = user.Email,
                attributes = user.Attributes
            }
        };

        var json = JsonSerializer.Serialize(payload);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _config.ApiKey);

        using var requestCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        requestCts.CancelAfter(_config.Timeout);
        var response = await _httpClient.SendAsync(request, requestCts.Token);
        if (!response.IsSuccessStatusCode)
            throw new RollgateException($"identify failed with status {(int)response.StatusCode}", ErrorCategory.Server);
    }

    private void UseCachedFallback()
    {
        if (!_config.Cache.Enabled) return;
        var cached = _cache.Get();
        if (cached.Found)
        {
            lock (_lock) { _flags = cached.Flags!; }
            _cache.RecordHit(cached.Stale);
        }
        else
        {
            _cache.RecordMiss();
        }
    }

    private void StartPolling()
    {
        _pollingCts = new CancellationTokenSource();
        var ct = _pollingCts.Token;
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try { await Task.Delay(_config.RefreshInterval, ct); }
                catch (OperationCanceledException) { return; }
                try { await RefreshAsync(ct); }
                catch { /* ignore polling errors */ }
            }
        }, ct);
    }
}
