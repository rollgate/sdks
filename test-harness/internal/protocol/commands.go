// Package protocol defines the HTTP protocol for communication between
// the test harness and SDK test services.
package protocol

// Command represents a command sent to a test service.
type Command struct {
	Command            string       `json:"command"`
	Config             *Config      `json:"config,omitempty"`
	User               *UserContext `json:"user,omitempty"`
	FlagKey            string       `json:"flagKey,omitempty"`
	DefaultValue       *bool        `json:"defaultValue,omitempty"`
	DefaultStringValue string       `json:"defaultStringValue,omitempty"`
	DefaultNumberValue *float64     `json:"defaultNumberValue,omitempty"`
	DefaultJSONValue   interface{}  `json:"defaultJsonValue,omitempty"`
	// Event tracking fields
	EventName     string                 `json:"eventName,omitempty"`
	UserID        string                 `json:"userId,omitempty"`
	VariationID   string                 `json:"variationId,omitempty"`
	EventValue    *float64               `json:"eventValue,omitempty"`
	EventMetadata map[string]interface{} `json:"eventMetadata,omitempty"`
}

// Config represents SDK initialization configuration.
type Config struct {
	APIKey          string `json:"apiKey"`
	BaseURL         string `json:"baseUrl"`
	RefreshInterval int    `json:"refreshInterval,omitempty"` // ms, 0 to disable
	EnableStreaming bool   `json:"enableStreaming,omitempty"`
	Timeout         int    `json:"timeout,omitempty"` // ms
}

// UserContext represents a user for targeting.
type UserContext struct {
	ID         string                 `json:"id"`
	Email      string                 `json:"email,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

// Supported command types.
const (
	CommandInit              = "init"
	CommandIsEnabled         = "isEnabled"
	CommandIsEnabledDetail   = "isEnabledDetail"
	CommandIdentify          = "identify"
	CommandReset             = "reset"
	CommandGetAllFlags       = "getAllFlags"
	CommandGetState          = "getState"
	CommandClose             = "close"
	CommandGetString         = "getString"
	CommandGetNumber         = "getNumber"
	CommandGetJSON           = "getJson"
	CommandGetValueDetail    = "getValueDetail"
	CommandTrack             = "track"
	CommandFlushEvents       = "flushEvents"
	CommandFlushTelemetry    = "flushTelemetry"
	CommandGetTelemetryStats = "getTelemetryStats"
)

// NewInitCommand creates an init command.
func NewInitCommand(config Config, user *UserContext) Command {
	return Command{
		Command: CommandInit,
		Config:  &config,
		User:    user,
	}
}

// NewIsEnabledCommand creates an isEnabled command.
func NewIsEnabledCommand(flagKey string, defaultValue bool) Command {
	return Command{
		Command:      CommandIsEnabled,
		FlagKey:      flagKey,
		DefaultValue: &defaultValue,
	}
}

// NewIdentifyCommand creates an identify command.
func NewIdentifyCommand(user UserContext) Command {
	return Command{
		Command: CommandIdentify,
		User:    &user,
	}
}

// NewResetCommand creates a reset command.
func NewResetCommand() Command {
	return Command{Command: CommandReset}
}

// NewGetAllFlagsCommand creates a getAllFlags command.
func NewGetAllFlagsCommand() Command {
	return Command{Command: CommandGetAllFlags}
}

// NewGetStateCommand creates a getState command.
func NewGetStateCommand() Command {
	return Command{Command: CommandGetState}
}

// NewCloseCommand creates a close command.
func NewCloseCommand() Command {
	return Command{Command: CommandClose}
}

// NewGetStringCommand creates a getString command.
func NewGetStringCommand(flagKey, defaultValue string) Command {
	return Command{
		Command:            CommandGetString,
		FlagKey:            flagKey,
		DefaultStringValue: defaultValue,
	}
}

// NewGetNumberCommand creates a getNumber command.
func NewGetNumberCommand(flagKey string, defaultValue float64) Command {
	return Command{
		Command:            CommandGetNumber,
		FlagKey:            flagKey,
		DefaultNumberValue: &defaultValue,
	}
}

// NewGetJSONCommand creates a getJson command.
func NewGetJSONCommand(flagKey string, defaultValue interface{}) Command {
	return Command{
		Command:          CommandGetJSON,
		FlagKey:          flagKey,
		DefaultJSONValue: defaultValue,
	}
}

// NewIsEnabledDetailCommand creates an isEnabledDetail command.
func NewIsEnabledDetailCommand(flagKey string, defaultValue bool) Command {
	return Command{
		Command:      CommandIsEnabledDetail,
		FlagKey:      flagKey,
		DefaultValue: &defaultValue,
	}
}

// NewGetValueDetailCommand creates a getValueDetail command.
func NewGetValueDetailCommand(flagKey string, defaultValue interface{}) Command {
	return Command{
		Command:          CommandGetValueDetail,
		FlagKey:          flagKey,
		DefaultJSONValue: defaultValue,
	}
}

// NewTrackCommand creates a track command.
func NewTrackCommand(flagKey, eventName, userID string) Command {
	return Command{
		Command:   CommandTrack,
		FlagKey:   flagKey,
		EventName: eventName,
		UserID:    userID,
	}
}

// NewTrackCommandFull creates a track command with all optional fields.
func NewTrackCommandFull(flagKey, eventName, userID, variationID string, value *float64, metadata map[string]interface{}) Command {
	return Command{
		Command:       CommandTrack,
		FlagKey:       flagKey,
		EventName:     eventName,
		UserID:        userID,
		VariationID:   variationID,
		EventValue:    value,
		EventMetadata: metadata,
	}
}

// NewFlushEventsCommand creates a flushEvents command.
func NewFlushEventsCommand() Command {
	return Command{Command: CommandFlushEvents}
}

// NewFlushTelemetryCommand creates a flushTelemetry command.
func NewFlushTelemetryCommand() Command {
	return Command{Command: CommandFlushTelemetry}
}

// NewGetTelemetryStatsCommand creates a getTelemetryStats command.
func NewGetTelemetryStatsCommand() Command {
	return Command{Command: CommandGetTelemetryStats}
}
