package process

import (
	"dbbkp-agent/internal/api"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var threatSignatures = []string{
	"xmrig", "kinsing", "masscan", "zmap",
	"cryptominer", "nc -l", "socat",
}

// Run scans /proc for known malicious process signatures on an interval.
func Run(client *api.Client, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for ; ; <-ticker.C {
		procs, err := os.ReadDir("/proc")
		if err != nil {
			continue
		}

		for _, proc := range procs {
			if !proc.IsDir() {
				continue
			}
			cmdline, err := os.ReadFile(filepath.Join("/proc", proc.Name(), "cmdline"))
			if err != nil {
				continue
			}
			// cmdline args are null-byte separated
			cmd := strings.ToLower(strings.ReplaceAll(string(cmdline), "\x00", " "))

			for _, sig := range threatSignatures {
				if strings.Contains(cmd, sig) {
					_ = client.Post("/internal/nodes/events", map[string]any{
						"type":     "suspicious_process",
						"severity": "critical",
						"message":  "Detected known malicious process signature",
						"details": map[string]any{
							"pid":     proc.Name(),
							"command": cmd,
							"threat":  sig,
						},
					})
					break
				}
			}
		}

		fmt.Fprintln(os.Stdout, "[process] Scan complete")
	}
}
