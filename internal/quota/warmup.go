package quota

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const warmupPrompt = "Reply with exactly: ok"

func RunCodexWarmup(ctx context.Context) (string, error) {
	tempDir := os.TempDir()
	cmd := exec.CommandContext(ctx, "codex", "exec", "--json", "-C", tempDir, "--skip-git-repo-check", warmupPrompt)
	output, err := cmd.CombinedOutput()
	threadID := parseThreadIDFromExecOutput(output)

	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 600 {
			message = message[:600] + "..."
		}
		if message != "" {
			return "", fmt.Errorf("codex warmup failed: %w: %s", err, message)
		}
		return "", fmt.Errorf("codex warmup failed: %w", err)
	}

	if threadID == "" {
		return "", errors.New("codex warmup did not return thread_id")
	}
	return threadID, nil
}

func parseThreadIDFromExecOutput(output []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(output))
	scanner.Buffer(make([]byte, 64*1024), 10*1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "{") {
			continue
		}
		var event struct {
			Type     string `json:"type"`
			ThreadID string `json:"thread_id"`
		}
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			continue
		}
		if event.Type == "thread.started" && strings.TrimSpace(event.ThreadID) != "" {
			return strings.TrimSpace(event.ThreadID)
		}
	}
	return ""
}
