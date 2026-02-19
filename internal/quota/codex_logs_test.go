package quota

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLatestCodexSnapshotFromDir(t *testing.T) {
	root := t.TempDir()
	sessionsDir := filepath.Join(root, "sessions", "2026", "02", "19")
	if err := os.MkdirAll(sessionsDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	older := filepath.Join(sessionsDir, "older.jsonl")
	newer := filepath.Join(sessionsDir, "newer.jsonl")

	olderLine := `{"timestamp":"2026-02-19T10:00:00Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":12.4,"resets_at":1771500000},"secondary":{"used_percent":34.9,"resets_at":1772000000}}}}`
	newerLine := `{"timestamp":"2026-02-19T12:34:56Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":55.1,"resets_at":1771600000},"secondary":{"used_percent":78.6,"resets_at":1772600000}}}}`

	if err := os.WriteFile(older, []byte(olderLine+"\n"), 0o600); err != nil {
		t.Fatalf("write older: %v", err)
	}
	if err := os.WriteFile(newer, []byte(newerLine+"\n"), 0o600); err != nil {
		t.Fatalf("write newer: %v", err)
	}

	snap, err := LatestCodexSnapshotFromDir(root)
	if err != nil {
		t.Fatalf("latest snapshot: %v", err)
	}
	if snap.Session == nil || snap.Weekly == nil {
		t.Fatalf("expected both windows, got %#v", snap)
	}
	if snap.Session.UsedPercent != 55 || snap.Weekly.UsedPercent != 79 {
		t.Fatalf("unexpected used percent: session=%d weekly=%d", snap.Session.UsedPercent, snap.Weekly.UsedPercent)
	}
	if got := snap.SourceTimestamp.Format(time.RFC3339); got != "2026-02-19T12:34:56Z" {
		t.Fatalf("unexpected source timestamp: %s", got)
	}
}

func TestLatestCodexSnapshotFromDirNotFound(t *testing.T) {
	root := t.TempDir()
	_, err := LatestCodexSnapshotFromDir(root)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestLatestSnapshotFromFiles(t *testing.T) {
	_, err := latestSnapshotFromFiles(nil)
	if err == nil {
		t.Fatal("expected error for empty files")
	}
	if !strings.Contains(err.Error(), "no codex session files") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLatestCodexSnapshotForThread(t *testing.T) {
	root := t.TempDir()
	t.Setenv("USERPROFILE", root)
	t.Setenv("HOME", root)

	sessionsDir := filepath.Join(root, ".codex", "sessions", "2026", "02", "19")
	if err := os.MkdirAll(sessionsDir, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	threadID := "019c0000-abcd-1234-eeee-ffffffffffff"
	otherID := "019c1111-abcd-1234-eeee-ffffffffffff"
	target := filepath.Join(sessionsDir, "rollout-"+threadID+".jsonl")
	other := filepath.Join(sessionsDir, "rollout-"+otherID+".jsonl")

	targetLine := `{"timestamp":"2026-02-19T16:00:00Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":9.8,"resets_at":1771700000},"secondary":{"used_percent":10.2,"resets_at":1772700000}}}}`
	otherLine := `{"timestamp":"2026-02-19T17:00:00Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":99.8,"resets_at":1771700000},"secondary":{"used_percent":91.2,"resets_at":1772700000}}}}`

	if err := os.WriteFile(target, []byte(targetLine+"\n"), 0o600); err != nil {
		t.Fatalf("write target: %v", err)
	}
	if err := os.WriteFile(other, []byte(otherLine+"\n"), 0o600); err != nil {
		t.Fatalf("write other: %v", err)
	}

	snap, err := LatestCodexSnapshotForThread(threadID)
	if err != nil {
		t.Fatalf("snapshot for thread: %v", err)
	}
	if snap.Session == nil || snap.Weekly == nil {
		t.Fatalf("expected both windows, got %#v", snap)
	}
	if snap.Session.UsedPercent != 10 || snap.Weekly.UsedPercent != 10 {
		t.Fatalf("unexpected used percent: session=%d weekly=%d", snap.Session.UsedPercent, snap.Weekly.UsedPercent)
	}
}
