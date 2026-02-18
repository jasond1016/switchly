package codexauth

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"switchly/internal/model"
)

func TestApplyUpdatesTokensAndPreservesOtherFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")
	seed := map[string]any{
		"welcome_seen": true,
		"tokens": map[string]any{
			"access_token":  "old-access",
			"refresh_token": "old-refresh",
		},
	}
	raw, _ := json.Marshal(seed)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("seed file: %v", err)
	}

	applier := NewFileApplier(path)
	err := applier.Apply(context.Background(), model.Account{Provider: "codex"}, model.AuthSecrets{
		AccessToken:  "new-access",
		RefreshToken: "new-refresh",
		IDToken:      "new-id",
		AccountID:    "acct-123",
	})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}

	updatedRaw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read updated file: %v", err)
	}
	var updated map[string]any
	if err := json.Unmarshal(updatedRaw, &updated); err != nil {
		t.Fatalf("decode updated file: %v", err)
	}

	if updated["welcome_seen"] != true {
		t.Fatalf("expected preserved field, got %#v", updated["welcome_seen"])
	}
	tokens, ok := updated["tokens"].(map[string]any)
	if !ok {
		t.Fatalf("tokens missing or invalid: %#v", updated["tokens"])
	}
	if tokens["access_token"] != "new-access" {
		t.Fatalf("access_token mismatch: %#v", tokens["access_token"])
	}
	if tokens["refresh_token"] != "new-refresh" {
		t.Fatalf("refresh_token mismatch: %#v", tokens["refresh_token"])
	}
	if tokens["id_token"] != "new-id" {
		t.Fatalf("id_token mismatch: %#v", tokens["id_token"])
	}
	if tokens["account_id"] != "acct-123" {
		t.Fatalf("account_id mismatch: %#v", tokens["account_id"])
	}
}

func TestApplySkipsNonCodexProvider(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")
	applier := NewFileApplier(path)
	err := applier.Apply(context.Background(), model.Account{Provider: "other"}, model.AuthSecrets{AccessToken: "x"})
	if err != nil {
		t.Fatalf("apply should skip non-codex provider, got %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("file should not be created for non-codex provider")
	}
}
