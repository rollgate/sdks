using System.Text.Json;
using System.Text.Json.Serialization;
using Rollgate.SDK;

var port = Environment.GetEnvironmentVariable("PORT") ?? "8007";
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
builder.Logging.SetMinimumLevel(LogLevel.Warning);

var app = builder.Build();

RollgateClient? client = null;
var clientLock = new object();

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    PropertyNameCaseInsensitive = true
};

app.MapGet("/", () => Results.Json(new { success = true }, jsonOptions));

app.MapDelete("/", () =>
{
    lock (clientLock)
    {
        client?.Dispose();
        client = null;
    }
    return Results.Json(new { success = true }, jsonOptions);
});

app.MapPost("/", async (HttpContext ctx) =>
{
    var body = await JsonSerializer.DeserializeAsync<JsonElement>(ctx.Request.Body, jsonOptions);
    var command = body.GetProperty("command").GetString() ?? "";

    object result = command switch
    {
        "init" => await HandleInit(body),
        "isEnabled" => HandleIsEnabled(body),
        "isEnabledDetail" => HandleIsEnabledDetail(body),
        "getString" => HandleGetString(body),
        "getNumber" => HandleGetNumber(body),
        "getJson" => HandleGetJson(body),
        "getValueDetail" => HandleGetValueDetail(body),
        "identify" => await HandleIdentify(body),
        "reset" => await HandleReset(),
        "getAllFlags" => HandleGetAllFlags(),
        "getState" => HandleGetState(),
        "close" => HandleClose(),
        _ => new { error = "UnknownCommand", message = $"Unknown command: {command}" }
    };

    return Results.Json(result, jsonOptions);
});

app.Run();

async Task<object> HandleInit(JsonElement body)
{
    try
    {
        if (!body.TryGetProperty("config", out var configEl))
            return new { error = "ValidationError", message = "config is required" };

        var config = new RollgateConfig
        {
            ApiKey = configEl.GetProperty("apiKey").GetString() ?? "",
            BaseUrl = configEl.GetProperty("baseUrl").GetString() ?? "",
        };

        if (configEl.TryGetProperty("refreshInterval", out var ri) && ri.GetInt32() > 0)
            config.RefreshInterval = TimeSpan.FromMilliseconds(ri.GetInt32());
        else
            config.RefreshInterval = TimeSpan.Zero;

        if (configEl.TryGetProperty("timeout", out var to) && to.GetInt32() > 0)
            config.Timeout = TimeSpan.FromMilliseconds(to.GetInt32());

        if (configEl.TryGetProperty("enableStreaming", out var es))
            config.EnableStreaming = es.GetBoolean();

        var c = new RollgateClient(config);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await c.InitializeAsync(cts.Token);

        if (body.TryGetProperty("user", out var userEl))
        {
            var user = ParseUser(userEl);
            if (user != null)
                await c.IdentifyAsync(user, cts.Token);
        }

        lock (clientLock) { client = c; }
        return new { success = true };
    }
    catch (Exception ex)
    {
        return new { error = "InitError", message = ex.Message };
    }
}

object HandleIsEnabled(JsonElement body)
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    var flagKey = body.TryGetProperty("flagKey", out var fk) ? fk.GetString() ?? "" : "";
    if (flagKey == "") return new { error = "ValidationError", message = "flagKey is required" };

    var defaultValue = body.TryGetProperty("defaultValue", out var dv) && dv.GetBoolean();
    var value = c.IsEnabled(flagKey, defaultValue);
    return new { value };
}

object HandleIsEnabledDetail(JsonElement body)
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    var flagKey = body.TryGetProperty("flagKey", out var fk) ? fk.GetString() ?? "" : "";
    if (flagKey == "") return new { error = "ValidationError", message = "flagKey is required" };

    var defaultValue = body.TryGetProperty("defaultValue", out var dv) && dv.GetBoolean();
    var detail = c.IsEnabledDetail(flagKey, defaultValue);

    return new
    {
        value = detail.Value,
        reason = new
        {
            kind = detail.Reason.Kind.ToString(),
            ruleId = detail.Reason.RuleId,
            ruleIndex = detail.Reason.RuleIndex,
            inRollout = detail.Reason.InRollout,
            errorKind = detail.Reason.ErrorKind == EvaluationErrorKind.NONE ? null : detail.Reason.ErrorKind.ToString()
        },
        variationId = detail.VariationId
    };
}

object HandleGetString(JsonElement body)
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    var flagKey = body.TryGetProperty("flagKey", out var fk) ? fk.GetString() ?? "" : "";
    if (flagKey == "") return new { error = "ValidationError", message = "flagKey is required" };

    var defaultValue = body.TryGetProperty("defaultStringValue", out var dsv) ? dsv.GetString() ?? "" : "";
    var value = c.GetString(flagKey, defaultValue);
    return new { stringValue = value };
}

object HandleGetNumber(JsonElement body)
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    var flagKey = body.TryGetProperty("flagKey", out var fk) ? fk.GetString() ?? "" : "";
    if (flagKey == "") return new { error = "ValidationError", message = "flagKey is required" };

    var defaultValue = body.TryGetProperty("defaultNumberValue", out var dnv) ? dnv.GetDouble() : 0.0;
    var value = c.GetNumber(flagKey, defaultValue);
    return new { numberValue = value };
}

object HandleGetJson(JsonElement body)
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    var flagKey = body.TryGetProperty("flagKey", out var fk) ? fk.GetString() ?? "" : "";
    if (flagKey == "") return new { error = "ValidationError", message = "flagKey is required" };

    object? defaultValue = body.TryGetProperty("defaultJsonValue", out var djv) ? djv : null;
    var value = c.GetJson(flagKey, defaultValue);
    return new { jsonValue = value };
}

object HandleGetValueDetail(JsonElement body)
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    var flagKey = body.TryGetProperty("flagKey", out var fk) ? fk.GetString() ?? "" : "";
    if (flagKey == "") return new { error = "ValidationError", message = "flagKey is required" };

    var defaultValue = body.TryGetProperty("defaultValue", out var dv) && dv.GetBoolean();
    var detail = c.IsEnabledDetail(flagKey, defaultValue);

    return new
    {
        value = detail.Value,
        reason = new
        {
            kind = detail.Reason.Kind.ToString(),
            ruleId = detail.Reason.RuleId,
            ruleIndex = detail.Reason.RuleIndex,
            inRollout = detail.Reason.InRollout,
            errorKind = detail.Reason.ErrorKind == EvaluationErrorKind.NONE ? null : detail.Reason.ErrorKind.ToString()
        },
        variationId = detail.VariationId
    };
}

async Task<object> HandleIdentify(JsonElement body)
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    if (!body.TryGetProperty("user", out var userEl))
        return new { error = "ValidationError", message = "user is required" };

    var user = ParseUser(userEl);
    if (user == null) return new { error = "ValidationError", message = "invalid user" };

    try
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await c.IdentifyAsync(user, cts.Token);
        return new { success = true };
    }
    catch (Exception ex)
    {
        return new { error = "IdentifyError", message = ex.Message };
    }
}

async Task<object> HandleReset()
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    try
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await c.ResetAsync(cts.Token);
        return new { success = true };
    }
    catch (Exception ex)
    {
        return new { error = "ResetError", message = ex.Message };
    }
}

object HandleGetAllFlags()
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null) return new { error = "NotInitializedError", message = "Client not initialized" };

    var flags = c.GetAllFlags();
    return new { flags };
}

object HandleGetState()
{
    RollgateClient? c;
    lock (clientLock) { c = client; }
    if (c == null)
        return new { isReady = false, circuitState = "UNKNOWN" };

    var metrics = c.GetMetrics();
    return new
    {
        isReady = c.IsReady,
        circuitState = c.GetCircuitState(),
        cacheStats = new { hits = metrics.CacheHits, misses = metrics.CacheMisses }
    };
}

object HandleClose()
{
    lock (clientLock)
    {
        client?.Dispose();
        client = null;
    }
    return new { success = true };
}

UserContext? ParseUser(JsonElement el)
{
    var user = new UserContext();
    if (el.TryGetProperty("id", out var id)) user.Id = id.GetString() ?? "";
    if (el.TryGetProperty("email", out var email)) user.Email = email.GetString() ?? "";
    if (el.TryGetProperty("attributes", out var attrs))
    {
        foreach (var prop in attrs.EnumerateObject())
        {
            user.Attributes[prop.Name] = prop.Value.ValueKind switch
            {
                JsonValueKind.String => prop.Value.GetString(),
                JsonValueKind.Number => prop.Value.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Null => null,
                _ => prop.Value.ToString()
            };
        }
    }
    return user;
}
