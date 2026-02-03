class UserContext {
  final String id;
  final String email;
  final Map<String, dynamic> attributes;

  UserContext({
    required this.id,
    this.email = '',
    Map<String, dynamic>? attributes,
  }) : attributes = attributes ?? {};

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'attributes': attributes,
      };
}
