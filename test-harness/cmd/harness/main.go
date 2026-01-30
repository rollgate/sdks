// Package main provides the entry point for the test harness.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/rollgate/test-harness/internal/harness"
)

var (
	mockPort = flag.Int("mock-port", 9000, "Port for mock Rollgate API server")
	apiKey   = flag.String("api-key", "test-api-key", "API key for mock server")
	services = flag.String("services", "", "Comma-separated list of name=url pairs (e.g., sdk-node=http://localhost:8001)")
	scenario = flag.String("scenario", "basic", "Initial scenario to load (basic, targeting, rollout, empty)")
	verbose  = flag.Bool("verbose", false, "Enable verbose logging")
)

func main() {
	flag.Parse()

	log.SetFlags(log.Ltime | log.Lmicroseconds)

	cfg := harness.Config{
		MockPort: *mockPort,
		APIKey:   *apiKey,
	}

	h := harness.New(cfg)

	// Parse and add services
	if *services != "" {
		for _, svc := range strings.Split(*services, ",") {
			parts := strings.SplitN(strings.TrimSpace(svc), "=", 2)
			if len(parts) != 2 {
				log.Fatalf("Invalid service format: %s (expected name=url)", svc)
			}
			h.AddService(parts[0], parts[1])
			if *verbose {
				log.Printf("Added service: %s at %s", parts[0], parts[1])
			}
		}
	}

	// Start mock server
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	log.Printf("Starting mock server on port %d...", *mockPort)
	if err := h.Start(ctx); err != nil {
		log.Fatalf("Failed to start mock server: %v", err)
	}
	log.Printf("Mock server started at %s", h.GetMockURL())

	// Load initial scenario
	h.SetScenario(*scenario)
	log.Printf("Loaded scenario: %s", *scenario)

	// Wait for services if specified
	if len(h.GetServices()) > 0 {
		log.Printf("Waiting for %d service(s) to become healthy...", len(h.GetServices()))
		waitCtx, waitCancel := context.WithTimeout(ctx, 30*time.Second)
		defer waitCancel()

		if err := h.WaitForServices(waitCtx, 30*time.Second); err != nil {
			log.Fatalf("Failed waiting for services: %v", err)
		}
		log.Printf("All services are healthy")
	}

	// Print configuration
	printConfig(h)

	// Wait for interrupt
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	log.Println("Press Ctrl+C to stop...")
	<-sigCh

	log.Println("Shutting down...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := h.Stop(shutdownCtx); err != nil {
		log.Printf("Error during shutdown: %v", err)
	}
	log.Println("Done")
}

func printConfig(h *harness.Harness) {
	config := map[string]interface{}{
		"mockUrl": h.GetMockURL(),
		"apiKey":  h.GetAPIKey(),
		"services": func() []map[string]string {
			var svcs []map[string]string
			for _, s := range h.GetServices() {
				svcs = append(svcs, map[string]string{
					"name": s.Name,
					"url":  s.URL,
				})
			}
			return svcs
		}(),
	}

	data, _ := json.MarshalIndent(config, "", "  ")
	log.Printf("Configuration:\n%s", string(data))

	// Print SDK init config
	sdkConfig := h.InitSDKConfig()
	sdkData, _ := json.MarshalIndent(sdkConfig, "", "  ")
	fmt.Printf("\nSDK Init Config (copy this):\n%s\n", string(sdkData))
}
