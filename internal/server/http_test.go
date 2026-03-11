package server

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"switchly/internal/core"
	"switchly/internal/model"
	"switchly/internal/oauth"
)

func TestCORSMiddlewarePreflight(t *testing.T) {
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("preflight request should not reach next handler")
	}))

	req := httptest.NewRequest(http.MethodOptions, "/v1/status", nil)
	req.Header.Set("Origin", "http://localhost:1420")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected %d, got %d", http.StatusNoContent, rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("unexpected allow-origin header: %q", got)
	}
}

func TestCORSMiddlewarePassThrough(t *testing.T) {
	called := false
	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/v1/status", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("expected next handler to be called")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected %d, got %d", http.StatusOK, rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("unexpected allow-origin header: %q", got)
	}
}

func TestParseAccountPath(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		wantID    string
		wantAct   string
		expectErr bool
	}{
		{name: "delete path", path: "/v1/accounts/acc-0", wantID: "acc-0", wantAct: ""},
		{name: "activate path", path: "/v1/accounts/acc-1/activate", wantID: "acc-1", wantAct: "activate"},
		{name: "quota path", path: "/v1/accounts/acc-2/quota", wantID: "acc-2", wantAct: "quota"},
		{name: "trailing slash", path: "/v1/accounts/acc-2/", expectErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, act, err := parseAccountPath(tt.path)
			if tt.expectErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if id != tt.wantID || act != tt.wantAct {
				t.Fatalf("unexpected parse result: id=%q action=%q", id, act)
			}
		})
	}
}

func TestHandleAccountDetailDelete(t *testing.T) {
	state := &testStateStore{
		state: model.AppState{
			Version:         1,
			ActiveAccountID: "acc-a",
			Strategy:        model.RoutingRoundRobin,
			Accounts: map[string]model.Account{
				"acc-a": {ID: "acc-a", Provider: "codex", Status: model.AccountReady},
			},
		},
	}
	secrets := &testSecretsStore{
		data: map[string]model.AuthSecrets{
			"acc-a": {AccessToken: "token-a"},
		},
	}
	manager := core.NewManager(state, secrets, core.WithActiveAccountApplier(deleteTestApplier{}))
	server := New(manager, nil, nil)

	req := httptest.NewRequest(http.MethodDelete, "/v1/accounts/acc-a", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected %d, got %d body=%s", http.StatusOK, rec.Code, rec.Body.String())
	}
	if state.state.ActiveAccountID != "" {
		t.Fatalf("expected active account cleared, got %q", state.state.ActiveAccountID)
	}
	if _, ok := state.state.Accounts["acc-a"]; ok {
		t.Fatal("expected deleted account removed from state")
	}
}

func TestHandleOAuthCancel(t *testing.T) {
	oauthService := oauth.NewService(nil, "http://localhost:7777")
	session, err := oauthService.Start("codex")
	if err != nil {
		t.Fatalf("start oauth: %v", err)
	}
	server := New(nil, oauthService, nil)

	req := httptest.NewRequest(http.MethodPost, "/v1/oauth/cancel", bytes.NewBufferString(`{"state":"`+session.State+`"}`))
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected %d, got %d body=%s", http.StatusOK, rec.Code, rec.Body.String())
	}
	if _, err := oauthService.Status(session.State); err == nil {
		t.Fatal("expected cancelled session to be removed")
	}
}

func TestDecodeJSONBody(t *testing.T) {
	t.Run("allows empty body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/quota/sync", bytes.NewBuffer(nil))
		var body struct {
			AccountID string `json:"account_id"`
		}

		if err := decodeJSONBody(req, &body, true); err != nil {
			t.Fatalf("expected nil error, got %v", err)
		}
		if body.AccountID != "" {
			t.Fatalf("expected zero-value body, got %#v", body)
		}
	})

	t.Run("rejects empty body when disallowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/strategy", bytes.NewBuffer(nil))
		var body struct {
			Strategy string `json:"strategy"`
		}

		err := decodeJSONBody(req, &body, false)
		if err == nil || err != io.EOF {
			t.Fatalf("expected EOF error, got %v", err)
		}
	})
}

func TestRequireMethod(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/health", nil)
	rec := httptest.NewRecorder()

	ok := requireMethod(rec, req, http.MethodGet)
	if ok {
		t.Fatal("expected method check to fail")
	}
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected %d, got %d", http.StatusMethodNotAllowed, rec.Code)
	}
}

type deleteTestApplier struct{}

func (deleteTestApplier) Apply(context.Context, model.Account, model.AuthSecrets) error {
	return nil
}

func (deleteTestApplier) Clear(context.Context) error {
	return nil
}
