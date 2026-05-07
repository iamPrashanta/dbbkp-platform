package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Alert struct {
	Type     string         `json:"type"`
	Severity string         `json:"severity"`
	Message  string         `json:"message"`
	Details  map[string]any `json:"details"`
}

type Payload struct {
	Alerts []Alert `json:"alerts"`
}

// Config
var apiEndpoint = "http://localhost:4000/internal/security/report"
var internalSecret = os.Getenv("INTERNAL_SECRET")
var alerts = []Alert{}

func main() {
	if internalSecret == "" {
		internalSecret = "dbbkp-internal-secret-change-me" // Default matching API
	}

	fmt.Println("[EDR Agent] Starting security scan...")

	scanMalware()
	scanProcesses()
	scanCronJobs()

	if len(alerts) > 0 {
		fmt.Printf("[EDR Agent] Found %d threats. Reporting to API...\n", len(alerts))
		reportThreats()
	} else {
		fmt.Println("[EDR Agent] Scan complete. System is clean.")
	}
}

// ─── MALWARE SCANNER (File System) ───────────────────────────────────────────

var seoPattern = regexp.MustCompile(`(?i)(base64_decode\(|gzinflate\(|shell_exec\(|system\(|passthru\(|assert\(|viagra|cialis|casino|porn|สล็อต|บาคาร่า|document\.write\(unescape)`)

func scanMalware() {
	searchDirs := []string{"/var/www/sites", "/var/www/html"}

	for _, dir := range searchDirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}

		filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}

			// Only scan executable/web scripts
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".php" && ext != ".js" && ext != ".html" {
				return nil
			}

			// Skip massive files to save CPU
			if info.Size() > 5*1024*1024 {
				return nil
			}

			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}

			matches := seoPattern.FindAllIndex(content, -1)
			if len(matches) > 0 {
				// Prevent spamming if a file is heavily infected
				alerts = append(alerts, Alert{
					Type:     "malware",
					Severity: "high",
					Message:  "Detected malicious payload (SEO spam / backdoor)",
					Details: map[string]any{
						"file":        path,
						"match_count": len(matches),
						"sample":      string(content[matches[0][0]:min(matches[0][1]+30, len(content))]),
					},
				})
			}
			return nil
		})
	}
}

// ─── PROCESS SCANNER ────────────────────────────────────────────────────────

func scanProcesses() {
	threatPatterns := []string{"xmrig", "kinsing", "masscan", "zmap", "cryptominer", "nc -l", "socat"}

	procs, err := os.ReadDir("/proc")
	if err != nil {
		return
	}

	for _, proc := range procs {
		if !proc.IsDir() {
			continue
		}

		cmdlinePath := filepath.Join("/proc", proc.Name(), "cmdline")
		cmdlineBytes, err := os.ReadFile(cmdlinePath)
		if err != nil {
			continue
		}

		// cmdline args are null-separated
		cmdline := strings.ReplaceAll(string(cmdlineBytes), "\x00", " ")

		for _, threat := range threatPatterns {
			if strings.Contains(strings.ToLower(cmdline), threat) {
				alerts = append(alerts, Alert{
					Type:     "suspicious_process",
					Severity: "critical",
					Message:  "Detected known malicious process signature",
					Details: map[string]any{
						"pid":     proc.Name(),
						"command": cmdline,
						"threat":  threat,
					},
				})
				break
			}
		}
	}
}

// ─── CRON SCANNER ───────────────────────────────────────────────────────────

var cronThreats = regexp.MustCompile(`(?i)(curl .*\|.*bash|wget .*\|.*sh|nc |netcat|reverse-shell)`)

func scanCronJobs() {
	cronDirs := []string{"/etc/cron.d", "/var/spool/cron/crontabs"}

	for _, dir := range cronDirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}

		filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil || info.IsDir() {
				return nil
			}

			content, err := os.ReadFile(path)
			if err != nil {
				return nil
			}

			lines := strings.Split(string(content), "\n")
			for i, line := range lines {
				if strings.HasPrefix(strings.TrimSpace(line), "#") {
					continue
				}

				if cronThreats.MatchString(line) {
					alerts = append(alerts, Alert{
						Type:     "cron",
						Severity: "high",
						Message:  "Suspicious cron job detected (potential reverse shell/downloader)",
						Details: map[string]any{
							"file":    path,
							"line":    i + 1,
							"command": line,
						},
					})
				}
			}
			return nil
		})
	}
}

// ─── REPORTER ───────────────────────────────────────────────────────────────

func reportThreats() {
	payload := Payload{Alerts: alerts}
	jsonData, err := json.Marshal(payload)
	if err != nil {
		fmt.Printf("Failed to marshal alerts: %v\n", err)
		return
	}

	req, err := http.NewRequest("POST", apiEndpoint, bytes.NewBuffer(jsonData))
	if err != nil {
		fmt.Printf("Failed to create request: %v\n", err)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-key", internalSecret)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Printf("Failed to submit report to API: %v\n", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 200 {
		fmt.Println("[EDR Agent] Threats successfully reported to Control Plane.")
	} else {
		body, _ := io.ReadAll(resp.Body)
		fmt.Printf("[EDR Agent] API rejected report. Status: %d, Response: %s\n", resp.StatusCode, string(body))
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
