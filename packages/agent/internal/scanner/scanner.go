package scanner

import (
	"dbbkp-agent/internal/api"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var malwarePattern = regexp.MustCompile(
	`(?i)(base64_decode\(|gzinflate\(|shell_exec\(|system\(|passthru\(|assert\()` +
		`|(viagra|cialis|casino|porn)` +
		`|(document\.write\(unescape|atob\()`,
)

type threat struct {
	File       string `json:"file"`
	MatchCount int    `json:"match_count"`
	Sample     string `json:"sample"`
}

func scanDir(dir string) []threat {
	var threats []threat

	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".php" && ext != ".js" && ext != ".html" {
			return nil
		}
		if info.Size() > 5*1024*1024 {
			return nil // skip large files
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		matches := malwarePattern.FindAllIndex(content, -1)
		if len(matches) > 0 {
			sample := string(content[matches[0][0]:min(matches[0][1]+60, len(content))])
			threats = append(threats, threat{
				File:       path,
				MatchCount: len(matches),
				Sample:     sample,
			})
		}
		return nil
	})

	return threats
}

// Run performs file system scans on an interval and reports threats.
func Run(client *api.Client, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	dirs := []string{"/var/www/sites", "/var/www/html"}

	for ; ; <-ticker.C {
		for _, dir := range dirs {
			if _, err := os.Stat(dir); os.IsNotExist(err) {
				continue
			}
			threats := scanDir(dir)
			for _, t := range threats {
				err := client.Post("/internal/nodes/events", map[string]any{
					"type":     "malware",
					"severity": "high",
					"message":  "Malicious payload detected in file",
					"details":  t,
				})
				if err != nil {
					fmt.Fprintf(os.Stderr, "[scanner] Failed to report threat: %v\n", err)
				}
			}
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
