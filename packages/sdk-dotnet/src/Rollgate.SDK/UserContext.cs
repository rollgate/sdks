namespace Rollgate.SDK;

public class UserContext
{
    public string Id { get; set; } = "";
    public string Email { get; set; } = "";
    public Dictionary<string, object?> Attributes { get; set; } = new();
}
