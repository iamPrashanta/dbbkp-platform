package cron

import (
	"dbbkp-agent/internal/api"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var cronThreats = regexp.MustCompile(
	`(?i)(curl .*\|.*bash|wget .*\|.*sh|nc |netcat|socat|base64)`,
)

func scanFile(path string) []string {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var hits []string
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if cronThreats.MatchString(line) {
			hits = append(hits, line)
		}
	}
	return hits
}

// Run scans crontab directories for malicious entries on the given interval.
func Run(client *api.Client, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	dirs := []string{"/etc/cron.d", "/var/spool/cron/crontabs"}

	for ; ; <-ticker.C {
		for _, dir := range dirs {
			if _, err := os.Stat(dir); os.IsNotExist(err) {
				continue
			}
			filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
				if err != nil || info.IsDir() {
					return nil
				}
				hits := scanFile(path)
				for _, cmd := range hits {
					_ = client.Post("/internal/nodes/events", map[string]any{
						"type":     "cron",
						"severity": "high",
						"message":  "Suspicious cron job detected",
						"details": map[string]any{
							"file":    path,
							"command": cmd,
						},
					})
				}
				return nil
			})
		}
		fmt.Fprintln(os.Stdout, "[cron] Scan complete")
	}
}
