package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const TokenPath = "/etc/dbbkp-agent/token"
const ConfigPath = "/etc/dbbkp-agent/config"

type Config struct {
	NodeID      string
	Token       string
	APIEndpoint string
}

type Client struct {
	cfg        Config
	httpClient *http.Client
}

func LoadConfig() Config {
	endpoint := os.Getenv("API_ENDPOINT")
	if endpoint == "" {
		endpoint = "http://localhost:4000"
	}

	nodeID := os.Getenv("NODE_ID")
	token := os.Getenv("NODE_TOKEN")

	// Fall back to reading from /etc/dbbkp-agent/
	if nodeID == "" {
		if data, err := os.ReadFile(ConfigPath); err == nil {
			nodeID = strings.TrimSpace(string(data))
		}
	}
	if token == "" {
		if data, err := os.ReadFile(TokenPath); err == nil {
			token = strings.TrimSpace(string(data))
		}
	}

	return Config{
		NodeID:      nodeID,
		Token:       token,
		APIEndpoint: endpoint,
	}
}

func NewClient(cfg Config) *Client {
	return &Client{
		cfg: cfg,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (c *Client) Ping() error {
	resp, err := c.httpClient.Get(c.cfg.APIEndpoint + "/health")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	return nil
}

// Post sends an authenticated JSON request to a node internal endpoint.
func (c *Client) Post(path string, body any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", c.cfg.APIEndpoint+path, bytes.NewBuffer(data))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.cfg.Token)
	req.Header.Set("x-node-id", c.cfg.NodeID)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}

// Register performs one-time registration using the bootstrap INTERNAL_SECRET.
// Writes the returned token to /etc/dbbkp-agent/token.
func Register(endpoint, internalSecret, name, hostname string, sysInfo map[string]any) (nodeID, token string, err error) {
	client := &http.Client{Timeout: 10 * time.Second}

	payload, _ := json.Marshal(map[string]any{
		"name":     name,
		"hostname": hostname,
		"ip":       sysInfo["ip"],
		"os":       sysInfo["os"],
		"arch":     sysInfo["arch"],
		"cpuCores": sysInfo["cpuCores"],
		"memoryMb": sysInfo["memoryMb"],
	})

	req, _ := http.NewRequest("POST", endpoint+"/internal/nodes/register", bytes.NewBuffer(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-internal-key", internalSecret)

	resp, err := client.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("registration request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return "", "", fmt.Errorf("registration failed (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		NodeID  string `json:"nodeId"`
		Token   string `json:"token"`
		Message string `json:"message"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	// Persist token and nodeID to disk
	os.MkdirAll("/etc/dbbkp-agent", 0700)
	os.WriteFile(TokenPath, []byte(result.Token), 0600)
	os.WriteFile(ConfigPath, []byte(result.NodeID), 0600)

	fmt.Println("[Register]", result.Message)
	return result.NodeID, result.Token, nil
}
