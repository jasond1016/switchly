package codexauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"switchly/internal/model"
)

type FileApplier struct {
	path string
}

func NewDefaultFileApplier() *FileApplier {
	home, err := os.UserHomeDir()
	if err != nil {
		return &FileApplier{}
	}
	return &FileApplier{path: filepath.Join(home, ".codex", "auth.json")}
}

func NewFileApplier(path string) *FileApplier {
	return &FileApplier{path: strings.TrimSpace(path)}
}

func (a *FileApplier) Apply(_ context.Context, account model.Account, secrets model.AuthSecrets) error {
	if strings.ToLower(strings.TrimSpace(account.Provider)) != "codex" {
		return nil
	}
	if strings.TrimSpace(secrets.AccessToken) == "" {
		return errors.New("codex access token is empty")
	}
	if strings.TrimSpace(a.path) == "" {
		return errors.New("codex auth file path is empty")
	}

	dir := filepath.Dir(a.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create codex auth dir: %w", err)
	}

	doc := map[string]any{}
	if data, err := os.ReadFile(a.path); err == nil && len(data) > 0 {
		if err := json.Unmarshal(data, &doc); err != nil {
			return fmt.Errorf("decode codex auth file: %w", err)
		}
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read codex auth file: %w", err)
	}

	tokens := map[string]any{}
	if raw, ok := doc["tokens"].(map[string]any); ok {
		tokens = raw
	}
	tokens["access_token"] = secrets.AccessToken
	tokens["refresh_token"] = secrets.RefreshToken
	tokens["id_token"] = secrets.IDToken
	tokens["account_id"] = secrets.AccountID
	doc["tokens"] = tokens

	payload, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("encode codex auth file: %w", err)
	}
	if err := os.WriteFile(a.path, payload, 0o600); err != nil {
		return fmt.Errorf("write codex auth file: %w", err)
	}
	return nil
}

func (a *FileApplier) Clear(_ context.Context) error {
	if strings.TrimSpace(a.path) == "" {
		return errors.New("codex auth file path is empty")
	}
	if _, err := os.Stat(a.path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return fmt.Errorf("stat codex auth file: %w", err)
	}

	doc, err := a.loadDocument()
	if err != nil {
		return err
	}
	delete(doc, "tokens")
	return a.writeDocument(doc)
}

func (a *FileApplier) loadDocument() (map[string]any, error) {
	doc := map[string]any{}
	if data, err := os.ReadFile(a.path); err == nil && len(data) > 0 {
		if err := json.Unmarshal(data, &doc); err != nil {
			return nil, fmt.Errorf("decode codex auth file: %w", err)
		}
	} else if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return doc, nil
		}
		return nil, fmt.Errorf("read codex auth file: %w", err)
	}
	return doc, nil
}

func (a *FileApplier) writeDocument(doc map[string]any) error {
	dir := filepath.Dir(a.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create codex auth dir: %w", err)
	}

	payload, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("encode codex auth file: %w", err)
	}
	if err := os.WriteFile(a.path, payload, 0o600); err != nil {
		return fmt.Errorf("write codex auth file: %w", err)
	}
	return nil
}
