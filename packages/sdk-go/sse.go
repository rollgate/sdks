package rollgate

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// SSEClient handles Server-Sent Events connections.
type SSEClient struct {
	mu sync.RWMutex

	config    Config
	client    *http.Client
	url       string
	user      *UserContext
	connected bool
	stopChan  chan struct{}

	onFlags    func(map[string]bool)
	onError    func(error)
	onConnect  func()
	reconnects int
}

// SSEEvent represents a parsed SSE event.
type SSEEvent struct {
	Event string
	Data  string
	ID    string
	Retry int
}

// NewSSEClient creates a new SSE client.
func NewSSEClient(config Config) *SSEClient {
	sseURL := config.BaseURL
	if config.BaseURL == "" {
		sseURL = "https://api.rollgate.io"
	}

	return &SSEClient{
		config:   config,
		client:   &http.Client{Timeout: 0}, // No timeout for SSE
		url:      sseURL,
		stopChan: make(chan struct{}),
	}
}

// OnFlags sets the callback for flag updates.
func (s *SSEClient) OnFlags(fn func(map[string]bool)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onFlags = fn
}

// OnError sets the callback for errors.
func (s *SSEClient) OnError(fn func(error)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onError = fn
}

// OnConnect sets the callback for successful connections.
func (s *SSEClient) OnConnect(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onConnect = fn
}

// SetUser sets the user context for the SSE connection.
func (s *SSEClient) SetUser(user *UserContext) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.user = user
}

// Connect starts the SSE connection with automatic reconnection.
func (s *SSEClient) Connect(ctx context.Context) error {
	go s.connectLoop(ctx)
	return nil
}

// IsConnected returns true if currently connected.
func (s *SSEClient) IsConnected() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.connected
}

// Close stops the SSE connection.
func (s *SSEClient) Close() {
	close(s.stopChan)
}

func (s *SSEClient) connectLoop(ctx context.Context) {
	backoff := 1 * time.Second
	maxBackoff := 30 * time.Second

	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stopChan:
			return
		default:
		}

		err := s.connect(ctx)
		if err != nil {
			s.mu.Lock()
			s.connected = false
			s.reconnects++
			if s.onError != nil {
				s.onError(err)
			}
			s.mu.Unlock()

			if s.config.Logger != nil {
				s.config.Logger.Warn("SSE connection error, reconnecting", "error", err, "backoff", backoff)
			}

			// Wait before reconnecting
			select {
			case <-ctx.Done():
				return
			case <-s.stopChan:
				return
			case <-time.After(backoff):
			}

			// Exponential backoff
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		} else {
			// Reset backoff on successful connection
			backoff = 1 * time.Second
		}
	}
}

func (s *SSEClient) connect(ctx context.Context) error {
	u, err := url.Parse(s.url + "/api/v1/sdk/stream")
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	q := u.Query()
	q.Set("token", s.config.APIKey)

	s.mu.RLock()
	if s.user != nil && s.user.ID != "" {
		q.Set("user_id", s.user.ID)
	}
	s.mu.RUnlock()

	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("X-SDK-Name", "rollgate-go")
	req.Header.Set("X-SDK-Version", "0.1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	s.mu.Lock()
	s.connected = true
	if s.onConnect != nil {
		s.onConnect()
	}
	s.mu.Unlock()

	return s.readEvents(ctx, resp.Body)
}

func (s *SSEClient) readEvents(ctx context.Context, body io.Reader) error {
	scanner := bufio.NewScanner(body)
	var event SSEEvent

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.stopChan:
			return nil
		default:
		}

		line := scanner.Text()

		// Empty line signals end of event
		if line == "" {
			if event.Event != "" || event.Data != "" {
				s.handleEvent(event)
			}
			event = SSEEvent{}
			continue
		}

		// Parse SSE format
		if strings.HasPrefix(line, "event:") {
			event.Event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			if event.Data != "" {
				event.Data += "\n"
			}
			event.Data += strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		} else if strings.HasPrefix(line, "id:") {
			event.ID = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
		} else if strings.HasPrefix(line, "retry:") {
			// Parse retry value (milliseconds)
			var retry int
			fmt.Sscanf(strings.TrimPrefix(line, "retry:"), "%d", &retry)
			event.Retry = retry
		}
		// Ignore comments (lines starting with :)
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("read error: %w", err)
	}

	return nil
}

func (s *SSEClient) handleEvent(event SSEEvent) {
	s.mu.RLock()
	onFlags := s.onFlags
	s.mu.RUnlock()

	if onFlags == nil {
		return
	}

	switch event.Event {
	case "init", "flags":
		// Full flags payload
		var data struct {
			Flags map[string]bool `json:"flags"`
		}
		if err := json.Unmarshal([]byte(event.Data), &data); err != nil {
			if s.config.Logger != nil {
				s.config.Logger.Error("failed to parse flags event", "error", err)
			}
			return
		}
		onFlags(data.Flags)

	case "flag-update":
		// Single flag update
		var data struct {
			Key     string `json:"key"`
			Enabled bool   `json:"enabled"`
		}
		if err := json.Unmarshal([]byte(event.Data), &data); err != nil {
			if s.config.Logger != nil {
				s.config.Logger.Error("failed to parse flag-update event", "error", err)
			}
			return
		}
		// For single flag updates, we call with just that flag
		// The caller should merge this with existing flags
		onFlags(map[string]bool{data.Key: data.Enabled})

	case "flag-changed":
		// Signal to refresh all flags
		// This is typically used when multiple flags change at once
		if s.config.Logger != nil {
			s.config.Logger.Debug("flag-changed event received, caller should refresh")
		}
	}
}

// GetReconnectCount returns the number of reconnection attempts.
func (s *SSEClient) GetReconnectCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.reconnects
}
