package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

func TestRunAccountImportCodexNoCandidate(t *testing.T) {
	candidateCalls := 0
	importCalls := 0
	client := &apiClient{
		baseURL: "http://switchly.local",
		http: &http.Client{
			Timeout: time.Second,
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				switch {
				case r.Method == http.MethodGet && r.URL.Path == "/v1/accounts/import/codex/candidate":
					candidateCalls++
					return jsonResponse(http.StatusOK, map[string]any{"found": false}), nil
				case r.Method == http.MethodPost && r.URL.Path == "/v1/accounts/import/codex":
					importCalls++
					return jsonResponse(http.StatusInternalServerError, map[string]any{"error": "should not be called"}), nil
				default:
					return jsonResponse(http.StatusNotFound, map[string]any{"error": "not found"}), nil
				}
			}),
		},
	}
	err := runAccount(client, []string{"import-codex"})
	if err == nil || !strings.Contains(err.Error(), "no logged-in Codex account found") {
		t.Fatalf("unexpected error: %v", err)
	}
	if candidateCalls != 1 {
		t.Fatalf("expected 1 candidate call, got %d", candidateCalls)
	}
	if importCalls != 0 {
		t.Fatalf("expected 0 import calls, got %d", importCalls)
	}
}

func TestRunAccountImportCodexSuccess(t *testing.T) {
	candidateCalls := 0
	importCalls := 0
	var importPayload struct {
		OverwriteExisting bool `json:"overwrite_existing"`
	}
	client := &apiClient{
		baseURL: "http://switchly.local",
		http: &http.Client{
			Timeout: time.Second,
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				switch {
				case r.Method == http.MethodGet && r.URL.Path == "/v1/accounts/import/codex/candidate":
					candidateCalls++
					return jsonResponse(http.StatusOK, map[string]any{
						"found": true,
						"candidate": map[string]any{
							"id":       "codex:local@example.com",
							"provider": "codex",
							"email":    "local@example.com",
						},
						"already_exists": false,
					}), nil
				case r.Method == http.MethodPost && r.URL.Path == "/v1/accounts/import/codex":
					importCalls++
					if err := json.NewDecoder(r.Body).Decode(&importPayload); err != nil {
						return nil, fmt.Errorf("decode import payload: %w", err)
					}
					return jsonResponse(http.StatusOK, map[string]any{
						"status": "ok",
						"action": "created",
						"account": map[string]any{
							"id": "codex:local@example.com",
						},
					}), nil
				default:
					return jsonResponse(http.StatusNotFound, map[string]any{"error": "not found"}), nil
				}
			}),
		},
	}
	out := captureStdout(t, func() {
		if err := runAccount(client, []string{"import-codex"}); err != nil {
			t.Fatalf("runAccount: %v", err)
		}
	})
	if candidateCalls != 1 {
		t.Fatalf("expected 1 candidate call, got %d", candidateCalls)
	}
	if importCalls != 1 {
		t.Fatalf("expected 1 import call, got %d", importCalls)
	}
	if !importPayload.OverwriteExisting {
		t.Fatalf("expected overwrite_existing=true by default")
	}
	if !strings.Contains(out, `"action": "created"`) {
		t.Fatalf("expected output to include import action, got: %s", out)
	}
}

func TestRunAccountImportCodexAlreadyExistsAndOverwriteDisabled(t *testing.T) {
	candidateCalls := 0
	importCalls := 0
	client := &apiClient{
		baseURL: "http://switchly.local",
		http: &http.Client{
			Timeout: time.Second,
			Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				switch {
				case r.Method == http.MethodGet && r.URL.Path == "/v1/accounts/import/codex/candidate":
					candidateCalls++
					return jsonResponse(http.StatusOK, map[string]any{
						"found": true,
						"candidate": map[string]any{
							"id":       "codex:local@example.com",
							"provider": "codex",
						},
						"already_exists": true,
					}), nil
				case r.Method == http.MethodPost && r.URL.Path == "/v1/accounts/import/codex":
					importCalls++
					return jsonResponse(http.StatusInternalServerError, map[string]any{"error": "should not be called"}), nil
				default:
					return jsonResponse(http.StatusNotFound, map[string]any{"error": "not found"}), nil
				}
			}),
		},
	}
	err := runAccount(client, []string{"import-codex", "--overwrite-existing=false"})
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("unexpected error: %v", err)
	}
	if candidateCalls != 1 {
		t.Fatalf("expected 1 candidate call, got %d", candidateCalls)
	}
	if importCalls != 0 {
		t.Fatalf("expected 0 import calls, got %d", importCalls)
	}
}

func captureStdout(t *testing.T, fn func()) string {
	t.Helper()

	origStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("create pipe: %v", err)
	}
	defer r.Close()

	os.Stdout = w
	defer func() {
		os.Stdout = origStdout
	}()

	done := make(chan string, 1)
	go func() {
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, r)
		done <- buf.String()
	}()

	fn()
	_ = w.Close()
	return <-done
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func jsonResponse(status int, body map[string]any) *http.Response {
	raw, _ := json.Marshal(body)
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(bytes.NewReader(raw)),
	}
}
