package server

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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

func TestParseAccountActionPath(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		wantID    string
		wantAct   string
		expectErr bool
	}{
		{name: "activate path", path: "/v1/accounts/acc-1/activate", wantID: "acc-1", wantAct: "activate"},
		{name: "quota path", path: "/v1/accounts/acc-2/quota", wantID: "acc-2", wantAct: "quota"},
		{name: "missing action", path: "/v1/accounts/acc-2", expectErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, act, err := parseAccountActionPath(tt.path)
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
