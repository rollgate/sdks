package io.rollgate;

/**
 * Explains why a flag evaluated to a particular value.
 */
public class EvaluationReason {

    /**
     * The category of reason for a flag evaluation.
     */
    public enum Kind {
        /** Flag is disabled */
        OFF,
        /** User is in the target users list */
        TARGET_MATCH,
        /** User matched a targeting rule */
        RULE_MATCH,
        /** No rules matched, using default rollout */
        FALLTHROUGH,
        /** An error occurred during evaluation */
        ERROR,
        /** Flag not found or unknown reason */
        UNKNOWN
    }

    /**
     * Types of errors that can occur during evaluation.
     */
    public enum ErrorKind {
        /** The flag key does not exist */
        FLAG_NOT_FOUND,
        /** The flag configuration is invalid */
        MALFORMED_FLAG,
        /** No user context was provided */
        USER_NOT_SPECIFIED,
        /** The SDK client is not initialized */
        CLIENT_NOT_READY,
        /** An unexpected error occurred */
        EXCEPTION
    }

    private final Kind kind;
    private final String ruleId;
    private final Integer ruleIndex;
    private final Boolean inRollout;
    private final ErrorKind errorKind;

    private EvaluationReason(Kind kind, String ruleId, Integer ruleIndex,
                            Boolean inRollout, ErrorKind errorKind) {
        this.kind = kind;
        this.ruleId = ruleId;
        this.ruleIndex = ruleIndex;
        this.inRollout = inRollout;
        this.errorKind = errorKind;
    }

    public Kind getKind() {
        return kind;
    }

    public String getRuleId() {
        return ruleId;
    }

    public Integer getRuleIndex() {
        return ruleIndex;
    }

    public Boolean isInRollout() {
        return inRollout;
    }

    public ErrorKind getErrorKind() {
        return errorKind;
    }

    // Factory methods

    /**
     * Create a reason for a disabled flag.
     */
    public static EvaluationReason off() {
        return new EvaluationReason(Kind.OFF, null, null, null, null);
    }

    /**
     * Create a reason for a target user match.
     */
    public static EvaluationReason targetMatch() {
        return new EvaluationReason(Kind.TARGET_MATCH, null, null, null, null);
    }

    /**
     * Create a reason for a rule match.
     */
    public static EvaluationReason ruleMatch(String ruleId, int ruleIndex, boolean inRollout) {
        return new EvaluationReason(Kind.RULE_MATCH, ruleId, ruleIndex, inRollout, null);
    }

    /**
     * Create a reason for fallthrough to default rollout.
     */
    public static EvaluationReason fallthrough(boolean inRollout) {
        return new EvaluationReason(Kind.FALLTHROUGH, null, null, inRollout, null);
    }

    /**
     * Create a reason for an error.
     */
    public static EvaluationReason error(ErrorKind errorKind) {
        return new EvaluationReason(Kind.ERROR, null, null, null, errorKind);
    }

    /**
     * Create a reason for an unknown flag.
     */
    public static EvaluationReason unknown() {
        return new EvaluationReason(Kind.UNKNOWN, null, null, null, null);
    }

    /**
     * Create a reason from raw string values (for JSON parsing).
     * Package-private for use by RollgateClient.
     */
    static EvaluationReason fromStrings(String kindStr, String ruleId,
                                        Integer ruleIndex, Boolean inRollout, String errorKindStr) {
        Kind kind;
        try {
            kind = Kind.valueOf(kindStr);
        } catch (IllegalArgumentException e) {
            kind = Kind.UNKNOWN;
        }

        ErrorKind errorKind = null;
        if (errorKindStr != null) {
            try {
                errorKind = ErrorKind.valueOf(errorKindStr);
            } catch (IllegalArgumentException e) {
                // Ignore invalid error kind
            }
        }

        return new EvaluationReason(kind, ruleId, ruleIndex, inRollout, errorKind);
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("EvaluationReason{kind=").append(kind);
        if (ruleId != null) {
            sb.append(", ruleId=").append(ruleId);
        }
        if (ruleIndex != null) {
            sb.append(", ruleIndex=").append(ruleIndex);
        }
        if (inRollout != null) {
            sb.append(", inRollout=").append(inRollout);
        }
        if (errorKind != null) {
            sb.append(", errorKind=").append(errorKind);
        }
        return sb.append("}").toString();
    }
}
