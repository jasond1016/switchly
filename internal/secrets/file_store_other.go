//go:build !windows

package secrets

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"switchly/internal/model"
	"switchly/internal/platform"
)

type FileStore struct {
	baseDir string
}

func NewDefaultStore() Store {
	dir, err := platform.ConfigDir()
	if err != nil {
		dir = "."
	}
	_ = os.MkdirAll(filepath.Join(dir, "secrets"), 0o700)
	return &FileStore{baseDir: filepath.Join(dir, "secrets")}
}

func (s *FileStore) path(accountID string) string {
	return filepath.Join(s.baseDir, accountID+".json")
}

func (s *FileStore) Put(accountID string, secrets model.AuthSecrets) error {
	data, err := json.Marshal(secrets)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(accountID), data, 0o600)
}

func (s *FileStore) Get(accountID string) (model.AuthSecrets, error) {
	data, err := os.ReadFile(s.path(accountID))
	if err != nil {
		return model.AuthSecrets{}, err
	}
	var out model.AuthSecrets
	if err := json.Unmarshal(data, &out); err != nil {
		return model.AuthSecrets{}, err
	}
	return out, nil
}

func (s *FileStore) Delete(accountID string) error {
	err := os.Remove(s.path(accountID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
