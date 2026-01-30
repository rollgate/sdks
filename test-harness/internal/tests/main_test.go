package tests

import (
	"flag"
	"log"
	"os"
	"strings"
	"testing"
)

var servicesFlag = flag.String("services", "", "Comma-separated list of name=url pairs")

func TestMain(m *testing.M) {
	flag.Parse()

	// Parse services from flag or environment variable
	servicesStr := *servicesFlag
	if servicesStr == "" {
		servicesStr = os.Getenv("TEST_SERVICES")
	}

	if servicesStr == "" {
		log.Println("No test services specified. Skipping contract tests.")
		log.Println("Use -services flag or TEST_SERVICES env var: sdk-node=http://localhost:8001,sdk-go=http://localhost:8002")
		os.Exit(0)
	}

	// Parse services
	services := make(map[string]string)
	for _, svc := range strings.Split(servicesStr, ",") {
		parts := strings.SplitN(strings.TrimSpace(svc), "=", 2)
		if len(parts) != 2 {
			log.Fatalf("Invalid service format: %s (expected name=url)", svc)
		}
		services[parts[0]] = parts[1]
		log.Printf("Registered test service: %s at %s", parts[0], parts[1])
	}

	// Setup harness
	h, err := SetupHarness(services)
	if err != nil {
		log.Fatalf("Failed to setup harness: %v", err)
	}

	// Run tests
	code := m.Run()

	// Teardown
	TeardownHarness(h)

	os.Exit(code)
}
