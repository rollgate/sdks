package io.rollgate;

/**
 * Contains the full result of a flag evaluation including the value and reason.
 *
 * @param <T> The type of the flag value
 */
public class EvaluationDetail<T> {

    private final T value;
    private final EvaluationReason reason;
    private final Integer variationIndex;
    private final String variationId;

    /**
     * Create an evaluation detail.
     *
     * @param value  The evaluated flag value
     * @param reason The reason for this evaluation result
     */
    public EvaluationDetail(T value, EvaluationReason reason) {
        this(value, reason, null, null);
    }

    /**
     * Create an evaluation detail with variation info.
     *
     * @param value          The evaluated flag value
     * @param reason         The reason for this evaluation result
     * @param variationIndex Index of the selected variation
     * @param variationId    ID of the selected variation
     */
    public EvaluationDetail(T value, EvaluationReason reason,
                           Integer variationIndex, String variationId) {
        this.value = value;
        this.reason = reason;
        this.variationIndex = variationIndex;
        this.variationId = variationId;
    }

    /**
     * Get the evaluated flag value.
     */
    public T getValue() {
        return value;
    }

    /**
     * Get the evaluation reason.
     */
    public EvaluationReason getReason() {
        return reason;
    }

    /**
     * Get the variation index (for multi-variate flags).
     */
    public Integer getVariationIndex() {
        return variationIndex;
    }

    /**
     * Get the variation ID (for multi-variate flags).
     */
    public String getVariationId() {
        return variationId;
    }

    /**
     * Check if this result was due to a default value being returned.
     */
    public boolean isDefaultValue() {
        return reason.getKind() == EvaluationReason.Kind.ERROR
            || reason.getKind() == EvaluationReason.Kind.UNKNOWN;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("EvaluationDetail{value=").append(value)
            .append(", reason=").append(reason);
        if (variationIndex != null) {
            sb.append(", variationIndex=").append(variationIndex);
        }
        if (variationId != null) {
            sb.append(", variationId=").append(variationId);
        }
        return sb.append("}").toString();
    }
}
