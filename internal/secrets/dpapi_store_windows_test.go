//go:build windows

package secrets

import (
	"bytes"
	"testing"

	"switchly/internal/model"
)

func TestDPAPIProtectUnprotectRoundTrip(t *testing.T) {
	plain := bytes.Repeat([]byte("token-data-"), 700)

	protected, err := dpapiProtect(plain)
	if err != nil {
		t.Fatalf("protect failed: %v", err)
	}
	if len(protected) == 0 {
		t.Fatal("protect returned empty payload")
	}

	roundTrip, err := dpapiUnprotect(protected)
	if err != nil {
		t.Fatalf("unprotect failed: %v", err)
	}
	if !bytes.Equal(roundTrip, plain) {
		t.Fatal("round trip mismatch")
	}
}

func TestDPAPIStorePutGetDelete(t *testing.T) {
	store := &DPAPIStore{baseDir: t.TempDir()}
	accountID := "codex:test@example.com"
	want := model.AuthSecrets{
		AccessToken:  "access-token",
		RefreshToken: "refresh-token",
		IDToken:      "id-token",
	}

	if err := store.Put(accountID, want); err != nil {
		t.Fatalf("put failed: %v", err)
	}
	got, err := store.Get(accountID)
	if err != nil {
		t.Fatalf("get failed: %v", err)
	}
	if got.AccessToken != want.AccessToken || got.RefreshToken != want.RefreshToken || got.IDToken != want.IDToken {
		t.Fatalf("unexpected value: %#v", got)
	}

	if err := store.Delete(accountID); err != nil {
		t.Fatalf("delete failed: %v", err)
	}
	if _, err := store.Get(accountID); err == nil {
		t.Fatal("expected get error after delete")
	}
}
