package codexauth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"switchly/internal/model"
)

var ErrAuthFileNotFound = errors.New("codex auth file not found")

type AuthFile struct {
	Tokens struct {
		IDToken      string `json:"id_token"`
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		AccountID    string `json:"account_id"`
	} `json:"tokens"`
}

type LocalAccount struct {
	ID      string
	Email   string
	Secrets model.AuthSecrets
}

func DefaultAuthFilePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex", "auth.json"), nil
}

func ReadAuthFile(path string) (AuthFile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return AuthFile{}, ErrAuthFileNotFound
		}
		return AuthFile{}, err
	}
	var out AuthFile
	if err := json.Unmarshal(data, &out); err != nil {
		return AuthFile{}, err
	}
	return out, nil
}

func LoadLocalAccountFromDefaultFile() (LocalAccount, error) {
	path, err := DefaultAuthFilePath()
	if err != nil {
		return LocalAccount{}, err
	}
	return LoadLocalAccount(path)
}

func LoadLocalAccount(path string) (LocalAccount, error) {
	auth, err := ReadAuthFile(path)
	if err != nil {
		return LocalAccount{}, err
	}
	if strings.TrimSpace(auth.Tokens.AccessToken) == "" {
		return LocalAccount{}, errors.New("codex auth file does not contain access_token")
	}

	email, tokenAccountID := DecodeEmailAndAccountID(auth.Tokens.IDToken)
	accountID := firstNonEmpty(auth.Tokens.AccountID, tokenAccountID)
	return LocalAccount{
		ID:    BuildCodexAccountID(email, accountID),
		Email: email,
		Secrets: model.AuthSecrets{
			AccessToken:  strings.TrimSpace(auth.Tokens.AccessToken),
			RefreshToken: strings.TrimSpace(auth.Tokens.RefreshToken),
			IDToken:      strings.TrimSpace(auth.Tokens.IDToken),
			AccountID:    accountID,
		},
	}, nil
}

func DecodeEmailAndAccountID(idToken string) (email, accountID string) {
	if strings.TrimSpace(idToken) == "" {
		return "", ""
	}
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 {
		return "", ""
	}
	payload := parts[1]
	payload = strings.ReplaceAll(payload, "-", "+")
	payload = strings.ReplaceAll(payload, "_", "/")
	if mod := len(payload) % 4; mod != 0 {
		payload += strings.Repeat("=", 4-mod)
	}
	b, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", ""
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(b, &claims); err != nil {
		return "", ""
	}
	if v, ok := claims["email"].(string); ok {
		email = strings.TrimSpace(v)
	}
	if nested, ok := claims["https://api.openai.com/auth"].(map[string]interface{}); ok {
		if v, ok := nested["chatgpt_account_id"].(string); ok {
			accountID = strings.TrimSpace(v)
		}
	}
	return email, accountID
}

func BuildCodexAccountID(email, accountID string) string {
	if strings.TrimSpace(email) != "" {
		return "codex:" + strings.ToLower(strings.TrimSpace(email))
	}
	if strings.TrimSpace(accountID) != "" {
		return "codex:" + strings.TrimSpace(accountID)
	}
	return "codex:" + time.Now().UTC().Format("20060102150405")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func (a LocalAccount) Validate() error {
	if strings.TrimSpace(a.ID) == "" {
		return fmt.Errorf("id is required")
	}
	if strings.TrimSpace(a.Secrets.AccessToken) == "" {
		return fmt.Errorf("access token is required")
	}
	return nil
}
