package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

// TestEvent from `go test -json`
type TestEvent struct {
	Action  string  `json:"Action"`
	Package string  `json:"Package"`
	Test    string  `json:"Test"`
	Elapsed float64 `json:"Elapsed"`
	Output  string  `json:"Output"`
}

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

	// Send start event
	send(dashboardURL, map[string]any{"type": "start", "sdk": sdk, "total": 84})

	// Run go test -json
	args := append([]string{"test", "-json"}, os.Args[2:]...)
	cmd := exec.Command("go", args...)
	cmd.Dir = "../"
	stdout, _ := cmd.StdoutPipe()
	cmd.Stderr = os.Stderr
	cmd.Start()

	passed, failed, skipped := 0, 0, 0
	scanner := bufio.NewScanner(stdout)

	for scanner.Scan() {
		var e TestEvent
		if err := json.Unmarshal(scanner.Bytes(), &e); err != nil {
			continue
		}

		// Only process test-level events (not package-level)
		if e.Test == "" || strings.Contains(e.Test, "/") {
			continue
		}

		switch e.Action {
		case "pass":
			passed++
			send(dashboardURL, map[string]any{"type": "test", "sdk": sdk, "test": e.Test, "status": "pass"})
		case "fail":
			failed++
			send(dashboardURL, map[string]any{"type": "test", "sdk": sdk, "test": e.Test, "status": "fail"})
		case "skip":
			skipped++
			send(dashboardURL, map[string]any{"type": "test", "sdk": sdk, "test": e.Test, "status": "skip"})
		}
	}

	cmd.Wait()

	// Send done event
	send(dashboardURL, map[string]any{
		"type":    "done",
		"sdk":     sdk,
		"passed":  passed,
		"failed":  failed,
		"skipped": skipped,
	})

	if failed > 0 {
		os.Exit(1)
	}
}

func send(url string, event map[string]any) {
	data, _ := json.Marshal(event)
	http.Post(url+"/api/event", "application/json", bytes.NewReader(data))
}
