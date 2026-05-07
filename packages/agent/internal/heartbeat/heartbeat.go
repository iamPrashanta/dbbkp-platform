package heartbeat

import (
	"dbbkp-agent/internal/api"
	"fmt"
	"os"
	"time"
)

// Run sends a heartbeat to the control plane on the given interval.
// It never panics — errors are logged and retried on the next tick.
func Run(client *api.Client, agentVersion string, interval time.Duration) {
	start := time.Now()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for ; ; <-ticker.C {
		uptime := int(time.Since(start).Seconds())

		payload := map[string]any{
			"agentVersion": agentVersion,
			"uptime":       uptime,
		}

		if err := client.Post("/internal/nodes/heartbeat", payload); err != nil {
			fmt.Fprintf(os.Stderr, "[heartbeat] Failed to send heartbeat: %v\n", err)
		}
	}
}
