using System.Text.Json;

namespace Rollgate.SDK;

public class SSEClient : IDisposable
{
    private readonly RollgateConfig _config;
    private readonly HttpClient _httpClient;
    private CancellationTokenSource? _cts;
    private bool _connected;
    private int _reconnects;

    private Action<Dictionary<string, bool>>? _onFlags;
    private Action<Exception>? _onError;
    private Action? _onConnect;

    public SSEClient(RollgateConfig config)
    {
        _config = config;
        _httpClient = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
    }

    public void OnFlags(Action<Dictionary<string, bool>> fn) => _onFlags = fn;
    public void OnError(Action<Exception> fn) => _onError = fn;
    public void OnConnect(Action fn) => _onConnect = fn;
    public bool IsConnected => _connected;

    public void Connect(UserContext? user)
    {
        _cts = new CancellationTokenSource();
        _ = ConnectLoopAsync(user, _cts.Token);
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _httpClient.Dispose();
    }

    private async Task ConnectLoopAsync(UserContext? user, CancellationToken ct)
    {
        var backoff = TimeSpan.FromSeconds(1);
        var maxBackoff = TimeSpan.FromSeconds(30);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ConnectOnceAsync(user, ct);
                backoff = TimeSpan.FromSeconds(1);
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex)
            {
                _connected = false;
                _reconnects++;
                _onError?.Invoke(ex);
                try { await Task.Delay(backoff, ct); } catch { return; }
                backoff = TimeSpan.FromMilliseconds(Math.Min(backoff.TotalMilliseconds * 2, maxBackoff.TotalMilliseconds));
            }
        }
    }

    private async Task ConnectOnceAsync(UserContext? user, CancellationToken ct)
    {
        var baseUrl = _config.SseUrl ?? _config.BaseUrl;
        var url = $"{baseUrl}/api/v1/sdk/stream?token={Uri.EscapeDataString(_config.ApiKey)}";
        if (user != null && !string.IsNullOrEmpty(user.Id))
            url += $"&user_id={Uri.EscapeDataString(user.Id)}";

        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("Accept", "text/event-stream");
        request.Headers.Add("Cache-Control", "no-cache");
        request.Headers.Add("X-SDK-Name", "rollgate-dotnet");
        request.Headers.Add("X-SDK-Version", "0.1.0");

        var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        _connected = true;
        _onConnect?.Invoke();

        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(stream);

        string? eventType = null;
        string data = "";

        while (!ct.IsCancellationRequested)
        {
            var line = await reader.ReadLineAsync(ct);
            if (line == null) break; // Stream ended

            if (line == "")
            {
                if (eventType != null || data != "")
                    HandleEvent(eventType ?? "", data);
                eventType = null;
                data = "";
                continue;
            }

            if (line.StartsWith("event:"))
                eventType = line[6..].Trim();
            else if (line.StartsWith("data:"))
            {
                if (data != "") data += "\n";
                data += line[5..].Trim();
            }
        }
    }

    private void HandleEvent(string eventType, string data)
    {
        if (_onFlags == null) return;

        try
        {
            switch (eventType)
            {
                case "init":
                case "flags":
                {
                    var parsed = JsonSerializer.Deserialize<JsonElement>(data);
                    if (parsed.TryGetProperty("flags", out var flagsEl))
                    {
                        var flags = new Dictionary<string, bool>();
                        foreach (var prop in flagsEl.EnumerateObject())
                            flags[prop.Name] = prop.Value.GetBoolean();
                        _onFlags(flags);
                    }
                    break;
                }
                case "flag-update":
                {
                    var parsed = JsonSerializer.Deserialize<JsonElement>(data);
                    var key = parsed.GetProperty("key").GetString()!;
                    var enabled = parsed.GetProperty("enabled").GetBoolean();
                    _onFlags(new Dictionary<string, bool> { { key, enabled } });
                    break;
                }
            }
        }
        catch { /* ignore parse errors */ }
    }
}
