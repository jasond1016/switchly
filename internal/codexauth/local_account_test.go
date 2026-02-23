package codexauth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadLocalAccountReadsCandidate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")
	if err := seedAuthFile(path, map[string]any{
		"id_token":      buildIDToken(map[string]any{"email": "User@Example.com", "https://api.openai.com/auth": map[string]any{"chatgpt_account_id": "acct-from-token"}}),
		"access_token":  "access-1",
		"refresh_token": "refresh-1",
		"account_id":    "acct-from-file",
	}); err != nil {
		t.Fatalf("seed auth file: %v", err)
	}

	got, err := LoadLocalAccount(path)
	if err != nil {
		t.Fatalf("LoadLocalAccount: %v", err)
	}

	if got.ID != "codex:user@example.com" {
		t.Fatalf("unexpected id: %q", got.ID)
	}
	if got.Email != "User@Example.com" {
		t.Fatalf("unexpected email: %q", got.Email)
	}
	if got.Secrets.AccessToken != "access-1" {
		t.Fatalf("unexpected access token: %q", got.Secrets.AccessToken)
	}
	if got.Secrets.RefreshToken != "refresh-1" {
		t.Fatalf("unexpected refresh token: %q", got.Secrets.RefreshToken)
	}
	if got.Secrets.AccountID != "acct-from-file" {
		t.Fatalf("unexpected account id: %q", got.Secrets.AccountID)
	}
}

func TestLoadLocalAccountReturnsNotFound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "missing.json")
	_, err := LoadLocalAccount(path)
	if !errors.Is(err, ErrAuthFileNotFound) {
		t.Fatalf("expected ErrAuthFileNotFound, got %v", err)
	}
}

func TestLoadLocalAccountRequiresAccessToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "auth.json")
	if err := seedAuthFile(path, map[string]any{
		"id_token": buildIDToken(map[string]any{"email": "a@example.com"}),
	}); err != nil {
		t.Fatalf("seed auth file: %v", err)
	}

	_, err := LoadLocalAccount(path)
	if err == nil || err.Error() != "codex auth file does not contain access_token" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func seedAuthFile(path string, tokens map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]any{"tokens": tokens})
	if err != nil {
		return err
	}
	return os.WriteFile(path, payload, 0o600)
}

func buildIDToken(claims map[string]any) string {
	payload, _ := json.Marshal(claims)
	return "header." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}
