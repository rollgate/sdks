package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// Regex patterns for `go test -v` output
var (
	passRegex = regexp.MustCompile(`^--- PASS: (\S+) \((\d+\.\d+)s\)`)
	failRegex = regexp.MustCompile(`^--- FAIL: (\S+) \((\d+\.\d+)s\)`)
	skipRegex = regexp.MustCompile(`^--- SKIP: (\S+) \((\d+\.\d+)s\)`)
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: runner <sdk-name> [go test args...]")
		os.Exit(1)
	}

	sdk := os.Args[1]
	dashboardURL := os.Getenv("DASHBOARD_URL")
	if dashboardURL == "" {
		dashboardURL = "http://localhost:8080"
	}

	// Connect to dashboard via WebSocket
	wsURL := httpToWs(dashboardURL) + "/ws"
	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		// Dashboard not running — continue without it
		fmt.Fprintf(os.Stderr, "Warning: dashboard not available (%v), running without live updates\n", err)
	}
	defer func() {
		if ws != nil {
			ws.Close()
		}
	}()

	// Send start event
	startTime := time.Now()
	wsSend(ws, map[string]any{"type": "start", "sdk": sdk, "total": 95})

	// Build command: use pre-compiled binary if TEST_BINARY is set, otherwise go test -v
	var cmd *exec.Cmd
	if bin := os.Getenv("TEST_BINARY"); bin != "" {
		args := []string{"-test.v", "-test.count=1"}
		cmd = exec.Command(bin, args...)
		cmd.Dir = "../"
	} else {
		args := append([]string{"test", "-v"}, os.Args[2:]...)
		cmd = exec.Command("go", args...)
		cmd.Dir = "../"
	}
	// Pass environment through (TEST_SERVICES, etc.)
	cmd.Env = os.Environ()
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = os.Stderr
	cmd.Start()

	passed, failed, skipped := 0, 0, 0
	scanner := bufio.NewScanner(stdout)
	// Increase scanner buffer for long output lines
	scanner.Buffer(make([]byte, 0, 256*1024), 256*1024)

	for scanner.Scan() {
		line := scanner.Text()

		// Try to match test result lines
		if m := passRegex.FindStringSubmatch(line); m != nil {
			test := m[1]
			elapsed, _ := strconv.ParseFloat(m[2], 64)
			// Skip subtests
			if strings.Contains(test, "/") {
				continue
			}
			passed++
			fmt.Printf("[%s] %s: pass\n", sdk, test)
			wsSend(ws, map[string]any{"type": "test", "sdk": sdk, "test": test, "status": "pass", "elapsed": elapsed})
		} else if m := failRegex.FindStringSubmatch(line); m != nil {
			test := m[1]
			elapsed, _ := strconv.ParseFloat(m[2], 64)
			if strings.Contains(test, "/") {
				continue
			}
			failed++
			fmt.Printf("[%s] %s: fail\n", sdk, test)
			wsSend(ws, map[string]any{"type": "test", "sdk": sdk, "test": test, "status": "fail", "elapsed": elapsed})
		} else if m := skipRegex.FindStringSubmatch(line); m != nil {
			test := m[1]
			elapsed, _ := strconv.ParseFloat(m[2], 64)
			if strings.Contains(test, "/") {
				continue
			}
			skipped++
			fmt.Printf("[%s] %s: skip\n", sdk, test)
			wsSend(ws, map[string]any{"type": "test", "sdk": sdk, "test": test, "status": "skip", "elapsed": elapsed})
		}
	}

	cmd.Wait()

	// Send done event
	totalElapsed := time.Since(startTime).Seconds()
	wsSend(ws, map[string]any{
		"type":         "done",
		"sdk":          sdk,
		"passed":       passed,
		"failed":       failed,
		"skipped":      skipped,
		"totalElapsed": totalElapsed,
	})

	fmt.Printf("[%s] Done: %d passed, %d failed, %d skipped (%.1fs)\n", sdk, passed, failed, skipped, totalElapsed)

	if failed > 0 {
		os.Exit(1)
	}
}

func httpToWs(httpURL string) string {
	u, err := url.Parse(httpURL)
	if err != nil {
		return "ws://localhost:8080"
	}
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	return u.String()
}

func wsSend(ws *websocket.Conn, event map[string]any) {
	if ws == nil {
		return
	}
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	ws.WriteMessage(websocket.TextMessage, data)
}
