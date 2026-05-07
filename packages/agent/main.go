package main

import (
	"dbbkp-agent/internal/api"
	"dbbkp-agent/internal/cron"
	"dbbkp-agent/internal/heartbeat"
	"dbbkp-agent/internal/metrics"
	"dbbkp-agent/internal/process"
	"dbbkp-agent/internal/scanner"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const AgentVersion = "1.0.0"

func main() {
	fmt.Printf("[dbbkp-agent] v%s starting...\n", AgentVersion)

	cfg := api.LoadConfig()

	if cfg.NodeID == "" || cfg.Token == "" {
		fmt.Println("[dbbkp-agent] Not registered. Run: dbbkp-agent register --name <name>")
		os.Exit(1)
	}

	client := api.NewClient(cfg)

	// Verify connectivity before starting goroutines
	if err := client.Ping(); err != nil {
		fmt.Printf("[dbbkp-agent] Cannot reach control plane at %s: %v\n", cfg.APIEndpoint, err)
		os.Exit(1)
	}
	fmt.Printf("[dbbkp-agent] Connected to control plane: %s\n", cfg.APIEndpoint)

	// ─── Launch goroutines ─────────────────────────────────────────────────────
	go heartbeat.Run(client, AgentVersion, 15*time.Second)
	go metrics.Run(client, 30*time.Second)
	go scanner.Run(client, 5*time.Minute)
	go process.Run(client, 60*time.Second)
	go cron.Run(client, 10*time.Minute)

	fmt.Println("[dbbkp-agent] All modules running. Waiting for signal...")

	// ─── Graceful shutdown ─────────────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	fmt.Println("[dbbkp-agent] Shutdown signal received. Stopping.")
}
