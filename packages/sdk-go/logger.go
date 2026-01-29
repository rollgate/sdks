package rollgate

import (
	"log"
	"os"
)

// DefaultLogger is a simple logger implementation using the standard library.
type DefaultLogger struct {
	debug *log.Logger
	info  *log.Logger
	warn  *log.Logger
	err   *log.Logger
}

// NewDefaultLogger creates a new DefaultLogger.
func NewDefaultLogger() *DefaultLogger {
	return &DefaultLogger{
		debug: log.New(os.Stdout, "[ROLLGATE DEBUG] ", log.LstdFlags),
		info:  log.New(os.Stdout, "[ROLLGATE INFO] ", log.LstdFlags),
		warn:  log.New(os.Stdout, "[ROLLGATE WARN] ", log.LstdFlags),
		err:   log.New(os.Stderr, "[ROLLGATE ERROR] ", log.LstdFlags),
	}
}

// Debug logs a debug message.
func (l *DefaultLogger) Debug(msg string, args ...any) {
	l.debug.Printf(msg+" %v", args...)
}

// Info logs an info message.
func (l *DefaultLogger) Info(msg string, args ...any) {
	l.info.Printf(msg+" %v", args...)
}

// Warn logs a warning message.
func (l *DefaultLogger) Warn(msg string, args ...any) {
	l.warn.Printf(msg+" %v", args...)
}

// Error logs an error message.
func (l *DefaultLogger) Error(msg string, args ...any) {
	l.err.Printf(msg+" %v", args...)
}

// NopLogger is a logger that discards all output.
type NopLogger struct{}

// Debug does nothing.
func (l *NopLogger) Debug(msg string, args ...any) {}

// Info does nothing.
func (l *NopLogger) Info(msg string, args ...any) {}

// Warn does nothing.
func (l *NopLogger) Warn(msg string, args ...any) {}

// Error does nothing.
func (l *NopLogger) Error(msg string, args ...any) {}
