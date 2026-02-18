//go:build windows

package secrets

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"

	"switchly/internal/model"
	"switchly/internal/platform"
)

type DPAPIStore struct {
	baseDir string
}

func NewDefaultStore() Store {
	dir, err := platform.ConfigDir()
	if err != nil {
		dir = "."
	}
	baseDir := filepath.Join(dir, "secrets")
	_ = os.MkdirAll(baseDir, 0o700)
	return &DPAPIStore{baseDir: baseDir}
}

func (s *DPAPIStore) path(accountID string) string {
	name := base64.RawURLEncoding.EncodeToString([]byte(accountID))
	return filepath.Join(s.baseDir, name+".bin")
}

func (s *DPAPIStore) Put(accountID string, secrets model.AuthSecrets) error {
	payload, err := json.Marshal(secrets)
	if err != nil {
		return err
	}

	protected, err := dpapiProtect(payload)
	if err != nil {
		return err
	}
	return os.WriteFile(s.path(accountID), protected, 0o600)
}

func (s *DPAPIStore) Get(accountID string) (model.AuthSecrets, error) {
	protected, err := os.ReadFile(s.path(accountID))
	if err != nil {
		return model.AuthSecrets{}, err
	}

	payload, err := dpapiUnprotect(protected)
	if err != nil {
		return model.AuthSecrets{}, err
	}

	var out model.AuthSecrets
	if err := json.Unmarshal(payload, &out); err != nil {
		return model.AuthSecrets{}, err
	}
	return out, nil
}

func (s *DPAPIStore) Delete(accountID string) error {
	err := os.Remove(s.path(accountID))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func dpapiProtect(plain []byte) ([]byte, error) {
	in := bytesToBlob(plain)
	var out windows.DataBlob
	if err := windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("dpapi protect: %w", err)
	}
	defer func() {
		_, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	}()
	return blobToBytes(out), nil
}

func dpapiUnprotect(protected []byte) ([]byte, error) {
	in := bytesToBlob(protected)
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
		return nil, fmt.Errorf("dpapi unprotect: %w", err)
	}
	defer func() {
		_, _ = windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	}()
	return blobToBytes(out), nil
}

func bytesToBlob(data []byte) windows.DataBlob {
	if len(data) == 0 {
		return windows.DataBlob{}
	}
	return windows.DataBlob{
		Size: uint32(len(data)),
		Data: &data[0],
	}
}

func blobToBytes(blob windows.DataBlob) []byte {
	if blob.Data == nil || blob.Size == 0 {
		return nil
	}
	size := int(blob.Size)
	src := unsafe.Slice(blob.Data, size)
	out := make([]byte, size)
	copy(out, src)
	return out
}
