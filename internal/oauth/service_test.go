package oauth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"switchly/internal/core"
)

func TestPKCES256RFCExample(t *testing.T) {
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	want := "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	if got := pkceS256(verifier); got != want {
		t.Fatalf("pkceS256 mismatch: got %s want %s", got, want)
	}
}

func TestDecodeIdentityFromIDToken(t *testing.T) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	payloadMap := map[string]interface{}{
		"email": "test@example.com",
		"https://api.openai.com/auth": map[string]interface{}{
			"chatgpt_account_id": "acct_123",
		},
	}
	payloadBytes, _ := json.Marshal(payloadMap)
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	token := header + "." + payload + "."

	email, acct := decodeIdentityFromIDToken(token)
	if email != "test@example.com" {
		t.Fatalf("email mismatch: %s", email)
	}
	if acct != "acct_123" {
		t.Fatalf("account mismatch: %s", acct)
	}
}

func TestClassifyAddAccountError(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantMsg   string
		wantStage string
	}{
		{
			name:      "secret persist",
			err:       errors.New("x"),
			wantMsg:   "failed to store OAuth credentials locally",
			wantStage: "secret_persist",
		},
		{
			name:      "state persist",
			err:       errors.New("y"),
			wantMsg:   "failed to persist account metadata locally",
			wantStage: "state_persist",
		},
		{
			name:      "unknown",
			err:       errors.New("other"),
			wantMsg:   "other",
			wantStage: "unknown",
		},
	}

	tests[0].err = fmt.Errorf("%w: %v", core.ErrPersistSecrets, tests[0].err)
	tests[1].err = fmt.Errorf("%w: %v", core.ErrPersistState, tests[1].err)

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, stage := classifyAddAccountError(tt.err)
			if msg != tt.wantMsg {
				t.Fatalf("message mismatch: got %q want %q", msg, tt.wantMsg)
			}
			if stage != tt.wantStage {
				t.Fatalf("stage mismatch: got %q want %q", stage, tt.wantStage)
			}
		})
	}
}
