package io.rollgate;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * User context for flag targeting.
 */
public class UserContext {
    private final String id;
    private final String email;
    private final Map<String, Object> attributes;

    private UserContext(Builder builder) {
        this.id = builder.id;
        this.email = builder.email;
        this.attributes = Collections.unmodifiableMap(new HashMap<>(builder.attributes));
    }

    public String getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public Map<String, Object> getAttributes() {
        return attributes;
    }

    public static Builder builder(String id) {
        return new Builder(id);
    }

    public static class Builder {
        private final String id;
        private String email;
        private Map<String, Object> attributes = new HashMap<>();

        public Builder(String id) {
            if (id == null || id.isEmpty()) {
                throw new IllegalArgumentException("User ID is required");
            }
            this.id = id;
        }

        public Builder email(String email) {
            this.email = email;
            return this;
        }

        public Builder attribute(String key, Object value) {
            this.attributes.put(key, value);
            return this;
        }

        public Builder attributes(Map<String, Object> attributes) {
            this.attributes.putAll(attributes);
            return this;
        }

        public UserContext build() {
            return new UserContext(this);
        }
    }
}
