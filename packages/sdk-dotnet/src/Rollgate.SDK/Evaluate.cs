using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Rollgate.SDK;

public static class Evaluate
{
    /// <summary>
    /// Determines if a user is in the rollout percentage using SHA-256 consistent hashing.
    /// hash = SHA-256(utf8("{flagKey}:{userId}"))
    /// value = BigEndian.Uint32(hash[0:4]) % 100
    /// result = value &lt; percentage
    /// </summary>
    public static bool IsInRollout(string flagKey, string userId, int percentage)
    {
        var input = Encoding.UTF8.GetBytes($"{flagKey}:{userId}");
        var hash = SHA256.HashData(input);
        uint value = (uint)((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]);
        return (value % 100) < (uint)percentage;
    }

    public static bool MatchesCondition(string op, object? attrValue, string condValue, UserContext? user)
    {
        bool exists = attrValue != null && attrValue.ToString() != "";

        switch (op)
        {
            case "is_set": return exists;
            case "is_not_set": return !exists;
        }

        if (!exists) return false;

        var value = ToString(attrValue).ToLowerInvariant();
        var cv = condValue.ToLowerInvariant();

        return op switch
        {
            "equals" or "eq" => value == cv,
            "not_equals" or "neq" => value != cv,
            "contains" => value.Contains(cv),
            "not_contains" => !value.Contains(cv),
            "starts_with" => value.StartsWith(cv),
            "ends_with" => value.EndsWith(cv),
            "in" => SplitAndTrim(condValue).Any(v => v.ToLowerInvariant() == value),
            "not_in" => !SplitAndTrim(condValue).Any(v => v.ToLowerInvariant() == value),
            "greater_than" or "gt" => CompareNumeric(attrValue, condValue, ">"),
            "greater_equal" or "gte" => CompareNumeric(attrValue, condValue, ">="),
            "less_than" or "lt" => CompareNumeric(attrValue, condValue, "<"),
            "less_equal" or "lte" => CompareNumeric(attrValue, condValue, "<="),
            "regex" => TryRegex(ToString(attrValue), condValue),
            "semver_gt" => CompareSemver(ToString(attrValue), condValue, ">"),
            "semver_lt" => CompareSemver(ToString(attrValue), condValue, "<"),
            "semver_eq" => CompareSemver(ToString(attrValue), condValue, "="),
            _ => false
        };
    }

    public static object? GetAttributeValue(string attribute, UserContext? user)
    {
        if (user == null) return null;
        return attribute switch
        {
            "id" => user.Id,
            "email" => user.Email,
            _ => user.Attributes.TryGetValue(attribute, out var val) ? val : null
        };
    }

    public static string ToString(object? v)
    {
        if (v == null) return "";
        if (v is string s) return s;
        if (v is bool b) return b ? "true" : "false";
        if (v is double d) return d.ToString("G", CultureInfo.InvariantCulture);
        if (v is float f) return f.ToString("G", CultureInfo.InvariantCulture);
        if (v is int i) return i.ToString();
        if (v is long l) return l.ToString();
        if (v is System.Text.Json.JsonElement je)
        {
            return je.ValueKind switch
            {
                System.Text.Json.JsonValueKind.String => je.GetString() ?? "",
                System.Text.Json.JsonValueKind.Number => je.GetDouble().ToString("G", CultureInfo.InvariantCulture),
                System.Text.Json.JsonValueKind.True => "true",
                System.Text.Json.JsonValueKind.False => "false",
                _ => je.ToString()
            };
        }
        return v.ToString() ?? "";
    }

    private static string[] SplitAndTrim(string s)
        => s.Split(',').Select(p => p.Trim()).ToArray();

    private static bool CompareNumeric(object? attrVal, string condVal, string op)
    {
        if (!TryToDouble(attrVal, out var a)) return false;
        if (!double.TryParse(condVal, NumberStyles.Float, CultureInfo.InvariantCulture, out var b)) return false;
        return op switch
        {
            ">" => a > b,
            ">=" => a >= b,
            "<" => a < b,
            "<=" => a <= b,
            _ => false
        };
    }

    private static bool TryToDouble(object? v, out double result)
    {
        result = 0;
        if (v == null) return false;
        if (v is double d) { result = d; return true; }
        if (v is float f) { result = f; return true; }
        if (v is int i) { result = i; return true; }
        if (v is long l) { result = l; return true; }
        if (v is string s) return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out result);
        if (v is System.Text.Json.JsonElement je && je.ValueKind == System.Text.Json.JsonValueKind.Number)
        {
            result = je.GetDouble();
            return true;
        }
        return false;
    }

    private static bool TryRegex(string value, string pattern)
    {
        try { return Regex.IsMatch(value, pattern); }
        catch { return false; }
    }

    private static bool CompareSemver(string attrVal, string condVal, string op)
    {
        var a = ParseVersion(attrVal);
        var b = ParseVersion(condVal);
        if (a == null || b == null) return false;

        while (a.Count < b.Count) a.Add(0);
        while (b.Count < a.Count) b.Add(0);

        for (int i = 0; i < a.Count; i++)
        {
            if (a[i] > b[i]) return op is ">" or ">=";
            if (a[i] < b[i]) return op is "<" or "<=";
        }
        return op is "=" or ">=" or "<=";
    }

    private static List<int>? ParseVersion(string v)
    {
        var clean = v.TrimStart('v');
        var parts = clean.Split('.');
        var result = new List<int>();
        foreach (var p in parts)
        {
            if (!int.TryParse(p, out var n)) return null;
            result.Add(n);
        }
        return result;
    }
}
