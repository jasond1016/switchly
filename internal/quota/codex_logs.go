package quota

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var ErrCodexQuotaNotFound = errors.New("codex quota snapshot not found")

type Window struct {
	UsedPercent int
	ResetAt     time.Time
}

type Snapshot struct {
	Session         *Window
	Weekly          *Window
	SourceTimestamp time.Time
}

func LatestCodexSnapshot() (Snapshot, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Snapshot{}, err
	}
	return LatestCodexSnapshotFromDir(filepath.Join(home, ".codex"))
}

func LatestCodexSnapshotFromDir(codexDir string) (Snapshot, error) {
	files, err := collectRecentJSONLFiles(codexDir)
	if err != nil {
		return Snapshot{}, err
	}
	return latestSnapshotFromFiles(files)
}

func LatestCodexSnapshotForThread(threadID string) (Snapshot, error) {
	id := strings.TrimSpace(threadID)
	if id == "" {
		return Snapshot{}, errors.New("thread_id is required")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return Snapshot{}, err
	}
	files, err := collectRecentJSONLFiles(filepath.Join(home, ".codex"))
	if err != nil {
		return Snapshot{}, err
	}

	idLower := strings.ToLower(id)
	threadFiles := make([]string, 0, 8)
	for _, path := range files {
		name := strings.ToLower(filepath.Base(path))
		if strings.Contains(name, idLower) {
			threadFiles = append(threadFiles, path)
		}
	}
	if len(threadFiles) == 0 {
		return Snapshot{}, fmt.Errorf("%w: no codex session file found for thread %s", ErrCodexQuotaNotFound, id)
	}
	return latestSnapshotFromFiles(threadFiles)
}

func latestSnapshotFromFiles(files []string) (Snapshot, error) {
	if len(files) == 0 {
		return Snapshot{}, fmt.Errorf("%w: no codex session files", ErrCodexQuotaNotFound)
	}

	var best Snapshot
	found := false
	for _, path := range files {
		snap, ok, err := parseLatestSnapshotFromFile(path)
		if err != nil {
			continue
		}
		if !ok {
			continue
		}
		if !found || snap.SourceTimestamp.After(best.SourceTimestamp) {
			best = snap
			found = true
		}
	}
	if !found {
		return Snapshot{}, fmt.Errorf("%w: no rate_limits event found", ErrCodexQuotaNotFound)
	}
	return best, nil
}

func collectRecentJSONLFiles(codexDir string) ([]string, error) {
	roots := []string{
		filepath.Join(codexDir, "sessions"),
		filepath.Join(codexDir, "archived_sessions"),
	}

	type fileInfo struct {
		path    string
		modTime time.Time
	}
	files := make([]fileInfo, 0, 128)
	for _, root := range roots {
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			continue
		}
		walkErr := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if !strings.HasSuffix(strings.ToLower(d.Name()), ".jsonl") {
				return nil
			}
			meta, err := d.Info()
			if err != nil {
				return nil
			}
			files = append(files, fileInfo{path: path, modTime: meta.ModTime()})
			return nil
		})
		if walkErr != nil {
			continue
		}
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].modTime.After(files[j].modTime)
	})

	const maxFiles = 60
	if len(files) > maxFiles {
		files = files[:maxFiles]
	}
	out := make([]string, 0, len(files))
	for _, f := range files {
		out = append(out, f.path)
	}
	return out, nil
}

func parseLatestSnapshotFromFile(path string) (Snapshot, bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return Snapshot{}, false, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 20*1024*1024)

	var best Snapshot
	found := false
	for scanner.Scan() {
		line := scanner.Bytes()
		if !bytes.Contains(line, []byte(`"rate_limits"`)) || !bytes.Contains(line, []byte(`"token_count"`)) {
			continue
		}

		var raw struct {
			Timestamp string `json:"timestamp"`
			Type      string `json:"type"`
			Payload   struct {
				Type       string `json:"type"`
				RateLimits *struct {
					Primary   *rawWindow `json:"primary"`
					Secondary *rawWindow `json:"secondary"`
				} `json:"rate_limits"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(line, &raw); err != nil {
			continue
		}
		if raw.Type != "event_msg" || raw.Payload.Type != "token_count" || raw.Payload.RateLimits == nil {
			continue
		}

		ts, err := parseSnapshotTime(raw.Timestamp)
		if err != nil {
			continue
		}

		session := toWindow(raw.Payload.RateLimits.Primary)
		weekly := toWindow(raw.Payload.RateLimits.Secondary)
		if session == nil && weekly == nil {
			continue
		}

		snap := Snapshot{
			Session:         session,
			Weekly:          weekly,
			SourceTimestamp: ts,
		}
		if !found || snap.SourceTimestamp.After(best.SourceTimestamp) {
			best = snap
			found = true
		}
	}
	if err := scanner.Err(); err != nil {
		return Snapshot{}, false, err
	}
	return best, found, nil
}

type rawWindow struct {
	UsedPercent float64 `json:"used_percent"`
	ResetsAt    int64   `json:"resets_at"`
}

func toWindow(raw *rawWindow) *Window {
	if raw == nil {
		return nil
	}
	win := &Window{
		UsedPercent: clampUsedPercent(raw.UsedPercent),
	}
	if raw.ResetsAt > 0 {
		win.ResetAt = time.Unix(raw.ResetsAt, 0).UTC()
	}
	return win
}

func clampUsedPercent(value float64) int {
	v := int(math.Round(value))
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func parseSnapshotTime(raw string) (time.Time, error) {
	if strings.TrimSpace(raw) == "" {
		return time.Time{}, errors.New("empty timestamp")
	}
	if ts, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return ts.UTC(), nil
	}
	if ts, err := time.Parse(time.RFC3339, raw); err == nil {
		return ts.UTC(), nil
	}
	return time.Time{}, errors.New("invalid timestamp")
}
