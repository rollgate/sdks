namespace Rollgate.SDK;

public enum EvaluationReasonKind
{
    OFF,
    TARGET_MATCH,
    RULE_MATCH,
    FALLTHROUGH,
    ERROR,
    UNKNOWN
}

public enum EvaluationErrorKind
{
    NONE,
    FLAG_NOT_FOUND,
    MALFORMED_FLAG,
    USER_NOT_SPECIFIED,
    CLIENT_NOT_READY,
    EXCEPTION
}

public class EvaluationReason
{
    public EvaluationReasonKind Kind { get; set; }
    public string? RuleId { get; set; }
    public int RuleIndex { get; set; }
    public bool InRollout { get; set; }
    public EvaluationErrorKind ErrorKind { get; set; }

    public static EvaluationReason Off() => new() { Kind = EvaluationReasonKind.OFF };
    public static EvaluationReason TargetMatch() => new() { Kind = EvaluationReasonKind.TARGET_MATCH };
    public static EvaluationReason Fallthrough(bool inRollout) => new() { Kind = EvaluationReasonKind.FALLTHROUGH, InRollout = inRollout };
    public static EvaluationReason Unknown() => new() { Kind = EvaluationReasonKind.UNKNOWN };
    public static EvaluationReason Error(EvaluationErrorKind errorKind) => new() { Kind = EvaluationReasonKind.ERROR, ErrorKind = errorKind };
    public static EvaluationReason RuleMatch(string ruleId, int ruleIndex, bool inRollout) => new()
    {
        Kind = EvaluationReasonKind.RULE_MATCH,
        RuleId = ruleId,
        RuleIndex = ruleIndex,
        InRollout = inRollout
    };
}

public class EvaluationDetail<T>
{
    public T Value { get; set; } = default!;
    public EvaluationReason Reason { get; set; } = new();
    public string? VariationId { get; set; }
}
