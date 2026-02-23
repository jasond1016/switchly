package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"switchly/internal/core"
	"switchly/internal/model"
)

func TestCodexImportCandidateFound(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if err := seedCodexAuthFile(filepath.Join(home, ".codex", "auth.json"), map[string]any{
		"id_token":      buildTestIDToken(map[string]any{"email": "local@example.com"}),
		"access_token":  "access-1",
		"refresh_token": "refresh-1",
	}); err != nil {
		t.Fatalf("seed codex auth file: %v", err)
	}

	mgr, _ := newTestManager()
	api := New(mgr, nil, nil).Handler()

	req := httptest.NewRequest(http.MethodGet, "/v1/accounts/import/codex/candidate", nil)
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Found         bool `json:"found"`
		AlreadyExists bool `json:"already_exists"`
		Candidate     struct {
			ID       string `json:"id"`
			Provider string `json:"provider"`
			Email    string `json:"email"`
		} `json:"candidate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Found {
		t.Fatalf("expected found=true")
	}
	if body.AlreadyExists {
		t.Fatalf("expected already_exists=false")
	}
	if body.Candidate.ID != "codex:local@example.com" {
		t.Fatalf("unexpected candidate id: %q", body.Candidate.ID)
	}
	if body.Candidate.Provider != "codex" {
		t.Fatalf("unexpected provider: %q", body.Candidate.Provider)
	}
}

func TestCodexImportCandidateNotFound(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	mgr, _ := newTestManager()
	api := New(mgr, nil, nil).Handler()

	req := httptest.NewRequest(http.MethodGet, "/v1/accounts/import/codex/candidate", nil)
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Found bool `json:"found"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Found {
		t.Fatalf("expected found=false")
	}
}

func TestCodexImportCreatesAndUpdates(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	authPath := filepath.Join(home, ".codex", "auth.json")
	if err := seedCodexAuthFile(authPath, map[string]any{
		"id_token":      buildTestIDToken(map[string]any{"email": "local@example.com"}),
		"access_token":  "access-1",
		"refresh_token": "refresh-1",
	}); err != nil {
		t.Fatalf("seed codex auth file: %v", err)
	}

	mgr, secrets := newTestManager()
	api := New(mgr, nil, nil).Handler()

	body := bytes.NewBufferString(`{"overwrite_existing":true}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/accounts/import/codex", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected create status: %d body=%s", rec.Code, rec.Body.String())
	}
	var createOut struct {
		Action  string        `json:"action"`
		Account model.Account `json:"account"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &createOut); err != nil {
		t.Fatalf("decode create response: %v", err)
	}
	if createOut.Action != "created" {
		t.Fatalf("unexpected action: %q", createOut.Action)
	}
	gotSecrets, ok := secrets.data["codex:local@example.com"]
	if !ok || gotSecrets.AccessToken != "access-1" {
		t.Fatalf("unexpected persisted secrets after create: %#v", gotSecrets)
	}

	if err := seedCodexAuthFile(authPath, map[string]any{
		"id_token":      buildTestIDToken(map[string]any{"email": "local@example.com"}),
		"access_token":  "access-2",
		"refresh_token": "refresh-2",
	}); err != nil {
		t.Fatalf("re-seed codex auth file: %v", err)
	}

	body = bytes.NewBufferString(`{"overwrite_existing":true}`)
	req = httptest.NewRequest(http.MethodPost, "/v1/accounts/import/codex", body)
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	api.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected update status: %d body=%s", rec.Code, rec.Body.String())
	}
	var updateOut struct {
		Action string `json:"action"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &updateOut); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	if updateOut.Action != "updated" {
		t.Fatalf("unexpected action: %q", updateOut.Action)
	}
	gotSecrets, ok = secrets.data["codex:local@example.com"]
	if !ok || gotSecrets.AccessToken != "access-2" {
		t.Fatalf("unexpected persisted secrets after update: %#v", gotSecrets)
	}
}

func TestCodexImportConflictWhenOverwriteDisabled(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	authPath := filepath.Join(home, ".codex", "auth.json")
	if err := seedCodexAuthFile(authPath, map[string]any{
		"id_token":      buildTestIDToken(map[string]any{"email": "local@example.com"}),
		"access_token":  "access-1",
		"refresh_token": "refresh-1",
	}); err != nil {
		t.Fatalf("seed codex auth file: %v", err)
	}

	mgr, _ := newTestManager()
	if _, err := mgr.AddAccount(context.Background(), core.AddAccountInput{
		ID:       "codex:local@example.com",
		Provider: "codex",
		Email:    "local@example.com",
		Secrets:  model.AuthSecrets{AccessToken: "old-access"},
	}); err != nil {
		t.Fatalf("preload account: %v", err)
	}
	api := New(mgr, nil, nil).Handler()

	body := bytes.NewBufferString(`{"overwrite_existing":false}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/accounts/import/codex", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	api.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("unexpected status: %d body=%s", rec.Code, rec.Body.String())
	}
}

type testStateStore struct {
	state model.AppState
}

func newTestManager() (*core.Manager, *testSecretsStore) {
	state := &testStateStore{state: model.DefaultState()}
	secrets := &testSecretsStore{data: map[string]model.AuthSecrets{}}
	return core.NewManager(state, secrets), secrets
}

func (s *testStateStore) Load() (model.AppState, error) {
	return cloneState(s.state), nil
}

func (s *testStateStore) Save(in model.AppState) error {
	s.state = cloneState(in)
	return nil
}

type testSecretsStore struct {
	data map[string]model.AuthSecrets
}

func (s *testSecretsStore) Put(accountID string, sec model.AuthSecrets) error {
	s.data[accountID] = sec
	return nil
}

func (s *testSecretsStore) Get(accountID string) (model.AuthSecrets, error) {
	return s.data[accountID], nil
}

func (s *testSecretsStore) Delete(accountID string) error {
	delete(s.data, accountID)
	return nil
}

func cloneState(in model.AppState) model.AppState {
	out := in
	out.Accounts = map[string]model.Account{}
	for id, account := range in.Accounts {
		out.Accounts[id] = account
	}
	return out
}

func seedCodexAuthFile(path string, tokens map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]any{"tokens": tokens})
	if err != nil {
		return err
	}
	return os.WriteFile(path, payload, 0o600)
}

func buildTestIDToken(claims map[string]any) string {
	raw, _ := json.Marshal(claims)
	return "header." + base64.RawURLEncoding.EncodeToString(raw) + ".signature"
}
