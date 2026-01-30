package protocol

// Response represents a response from a test service.
type Response struct {
	// For isEnabled
	Value *bool `json:"value,omitempty"`

	// For typed flags
	StringValue *string     `json:"stringValue,omitempty"`
	NumberValue *float64    `json:"numberValue,omitempty"`
	JSONValue   interface{} `json:"jsonValue,omitempty"`

	// For getAllFlags
	Flags map[string]bool `json:"flags,omitempty"`

	// For getState
	IsReady      *bool       `json:"isReady,omitempty"`
	CircuitState string      `json:"circuitState,omitempty"`
	CacheStats   *CacheStats `json:"cacheStats,omitempty"`

	// For success responses
	Success *bool `json:"success,omitempty"`

	// For errors
	Error   string `json:"error,omitempty"`
	Message string `json:"message,omitempty"`
}

// CacheStats represents cache statistics.
type CacheStats struct {
	Hits   int64 `json:"hits"`
	Misses int64 `json:"misses"`
}

// ErrorResponse creates an error response.
func ErrorResponse(errorType, message string) Response {
	return Response{
		Error:   errorType,
		Message: message,
	}
}

// ValueResponse creates a boolean value response.
func ValueResponse(value bool) Response {
	return Response{Value: &value}
}

// FlagsResponse creates a flags response.
func FlagsResponse(flags map[string]bool) Response {
	return Response{Flags: flags}
}

// SuccessResponse creates a success response.
func SuccessResponse() Response {
	t := true
	return Response{Success: &t}
}

// StateResponse creates a state response.
func StateResponse(isReady bool, circuitState string, cacheStats *CacheStats) Response {
	return Response{
		IsReady:      &isReady,
		CircuitState: circuitState,
		CacheStats:   cacheStats,
	}
}

// IsError returns true if the response is an error.
func (r Response) IsError() bool {
	return r.Error != ""
}

// GetValue returns the boolean value or the default if not present.
func (r Response) GetValue(defaultValue bool) bool {
	if r.Value != nil {
		return *r.Value
	}
	return defaultValue
}

// GetSuccess returns true if the operation was successful.
func (r Response) GetSuccess() bool {
	return r.Success != nil && *r.Success
}

// GetIsReady returns the ready state or false if not present.
func (r Response) GetIsReady() bool {
	return r.IsReady != nil && *r.IsReady
}
