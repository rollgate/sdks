enum EvaluationReasonKind {
  OFF,
  TARGET_MATCH,
  RULE_MATCH,
  FALLTHROUGH,
  ERROR,
  UNKNOWN,
}

enum EvaluationErrorKind {
  NONE,
  FLAG_NOT_FOUND,
  MALFORMED_FLAG,
  USER_NOT_SPECIFIED,
  CLIENT_NOT_READY,
  EXCEPTION,
}

class EvaluationReason {
  final EvaluationReasonKind kind;
  final String? ruleId;
  final int ruleIndex;
  final bool inRollout;
  final EvaluationErrorKind errorKind;

  EvaluationReason({
    required this.kind,
    this.ruleId,
    this.ruleIndex = 0,
    this.inRollout = false,
    this.errorKind = EvaluationErrorKind.NONE,
  });

  factory EvaluationReason.off() =>
      EvaluationReason(kind: EvaluationReasonKind.OFF);

  factory EvaluationReason.targetMatch() =>
      EvaluationReason(kind: EvaluationReasonKind.TARGET_MATCH);

  factory EvaluationReason.fallthrough(bool inRollout) =>
      EvaluationReason(kind: EvaluationReasonKind.FALLTHROUGH, inRollout: inRollout);

  factory EvaluationReason.unknown() =>
      EvaluationReason(kind: EvaluationReasonKind.UNKNOWN);

  factory EvaluationReason.error(EvaluationErrorKind errorKind) =>
      EvaluationReason(kind: EvaluationReasonKind.ERROR, errorKind: errorKind);

  factory EvaluationReason.ruleMatch(String ruleId, int ruleIndex, bool inRollout) =>
      EvaluationReason(
        kind: EvaluationReasonKind.RULE_MATCH,
        ruleId: ruleId,
        ruleIndex: ruleIndex,
        inRollout: inRollout,
      );

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{'kind': kind.name};
    if (ruleId != null) map['ruleId'] = ruleId;
    if (ruleIndex != 0) map['ruleIndex'] = ruleIndex;
    if (inRollout) map['inRollout'] = inRollout;
    if (errorKind != EvaluationErrorKind.NONE) map['errorKind'] = errorKind.name;
    return map;
  }

  static EvaluationReason fromJson(Map<String, dynamic> json) {
    final kindStr = json['kind'] as String? ?? 'UNKNOWN';
    final kind = EvaluationReasonKind.values.firstWhere(
      (e) => e.name == kindStr,
      orElse: () => EvaluationReasonKind.UNKNOWN,
    );

    var errorKind = EvaluationErrorKind.NONE;
    if (json['errorKind'] != null) {
      final ekStr = json['errorKind'] as String;
      errorKind = EvaluationErrorKind.values.firstWhere(
        (e) => e.name == ekStr,
        orElse: () => EvaluationErrorKind.NONE,
      );
    }

    return EvaluationReason(
      kind: kind,
      ruleId: json['ruleId'] as String?,
      ruleIndex: json['ruleIndex'] as int? ?? 0,
      inRollout: json['inRollout'] as bool? ?? false,
      errorKind: errorKind,
    );
  }
}

class EvaluationDetail<T> {
  final T value;
  final EvaluationReason reason;
  final String? variationId;

  EvaluationDetail({
    required this.value,
    required this.reason,
    this.variationId,
  });
}
