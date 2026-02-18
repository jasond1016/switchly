package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"switchly/internal/core"
	"switchly/internal/model"
)

type SessionStatus string

const (
	SessionPending SessionStatus = "pending"
	SessionSuccess SessionStatus = "success"
	SessionError   SessionStatus = "error"
	SessionExpired SessionStatus = "expired"
)

type ProviderConfig struct {
	Provider             string
	ClientID             string
	AuthURL              string
	TokenURL             string
	RedirectURI          string
	Scopes               []string
	AdditionalAuthParams map[string]string
}

type SessionSnapshot struct {
	State     string        `json:"state"`
	Provider  string        `json:"provider"`
	Status    SessionStatus `json:"status"`
	AuthURL   string        `json:"auth_url,omitempty"`
	AccountID string        `json:"account_id,omitempty"`
	Error     string        `json:"error,omitempty"`
	ExpiresAt time.Time     `json:"expires_at"`
}

type session struct {
	SessionSnapshot
	codeVerifier string
}

type Service struct {
	mu         sync.Mutex
	manager    *core.Manager
	httpClient *http.Client
	baseURL    string
	providers  map[string]ProviderConfig
	sessions   map[string]*session
}

func NewService(manager *core.Manager, baseURL string) *Service {
	providers := map[string]ProviderConfig{}
	for _, p := range defaultProviders() {
		providers[p.Provider] = p
	}

	return &Service{
		manager:    manager,
		httpClient: &http.Client{Timeout: 20 * time.Second},
		baseURL:    strings.TrimRight(baseURL, "/"),
		providers:  providers,
		sessions:   map[string]*session{},
	}
}

func defaultProviders() []ProviderConfig {
	return []ProviderConfig{
		{
			Provider:    "codex",
			ClientID:    "app_EMoamEEZ73f0CkXaXp7hrann",
			AuthURL:     "https://auth.openai.com/oauth/authorize",
			TokenURL:    "https://auth.openai.com/oauth/token",
			RedirectURI: "http://localhost:1455/auth/callback",
			Scopes:      []string{"openid", "profile", "email", "offline_access"},
			AdditionalAuthParams: map[string]string{
				"id_token_add_organizations": "true",
				"codex_cli_simplified_flow":  "true",
				"originator":                 "codex_cli_rs",
			},
		},
	}
}

func (s *Service) Providers() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.providers))
	for k := range s.providers {
		out = append(out, k)
	}
	return out
}

func (s *Service) RedirectURIs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.providers))
	for _, cfg := range s.providers {
		uri := strings.TrimSpace(cfg.RedirectURI)
		if uri == "" {
			uri = s.baseURL + "/auth/callback"
		}
		out = append(out, uri)
	}
	return out
}

func (s *Service) Start(provider string) (SessionSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg, ok := s.providers[strings.ToLower(strings.TrimSpace(provider))]
	if !ok {
		return SessionSnapshot{}, fmt.Errorf("unsupported provider: %s", provider)
	}

	state, err := randomURLSafe(24)
	if err != nil {
		return SessionSnapshot{}, err
	}
	verifier, err := randomURLSafe(32)
	if err != nil {
		return SessionSnapshot{}, err
	}
	challenge := pkceS256(verifier)

	redirectURI := strings.TrimSpace(cfg.RedirectURI)
	if redirectURI == "" {
		redirectURI = s.baseURL + "/auth/callback"
	}
	q := url.Values{}
	q.Set("response_type", "code")
	q.Set("client_id", cfg.ClientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("scope", strings.Join(cfg.Scopes, " "))
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	for k, v := range cfg.AdditionalAuthParams {
		q.Set(k, v)
	}

	authURL := cfg.AuthURL + "?" + q.Encode()
	snap := SessionSnapshot{
		State:     state,
		Provider:  cfg.Provider,
		Status:    SessionPending,
		AuthURL:   authURL,
		ExpiresAt: time.Now().UTC().Add(10 * time.Minute),
	}
	s.sessions[state] = &session{SessionSnapshot: snap, codeVerifier: verifier}
	return snap, nil
}

func (s *Service) Status(state string) (SessionSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sess, ok := s.sessions[state]
	if !ok {
		return SessionSnapshot{}, errors.New("state not found")
	}
	if sess.Status == SessionPending && time.Now().UTC().After(sess.ExpiresAt) {
		sess.Status = SessionExpired
		sess.Error = "oauth session expired"
	}
	return sess.SessionSnapshot, nil
}

func (s *Service) HandleCallback(w http.ResponseWriter, r *http.Request) {
	state := r.URL.Query().Get("state")
	if state == "" {
		writeOAuthHTML(w, false, "missing state")
		return
	}

	s.mu.Lock()
	sess, ok := s.sessions[state]
	if !ok {
		s.mu.Unlock()
		writeOAuthHTML(w, false, "unknown state")
		return
	}
	cfg, ok := s.providers[sess.Provider]
	if !ok {
		sess.Status = SessionError
		sess.Error = "provider config missing"
		s.mu.Unlock()
		writeOAuthHTML(w, false, sess.Error)
		return
	}
	if time.Now().UTC().After(sess.ExpiresAt) {
		sess.Status = SessionExpired
		sess.Error = "oauth session expired"
		s.mu.Unlock()
		writeOAuthHTML(w, false, sess.Error)
		return
	}
	s.mu.Unlock()

	if errMsg := r.URL.Query().Get("error"); errMsg != "" {
		s.failSession(state, fmt.Sprintf("oauth error: %s", errMsg))
		writeOAuthHTML(w, false, errMsg)
		return
	}

	code := r.URL.Query().Get("code")
	if code == "" {
		s.failSession(state, "missing authorization code")
		writeOAuthHTML(w, false, "missing authorization code")
		return
	}

	tokens, err := s.exchangeCode(r.Context(), cfg, code, sess.codeVerifier)
	if err != nil {
		log.Printf("oauth callback token exchange failed provider=%s state=%s err=%v", cfg.Provider, state, err)
		s.failSession(state, err.Error())
		writeOAuthHTML(w, false, err.Error())
		return
	}

	email, tokenAccountID := decodeIdentityFromIDToken(tokens.IDToken)
	accountID := buildAccountID(cfg.Provider, email, tokenAccountID)

	acct, err := s.manager.AddAccount(r.Context(), core.AddAccountInput{
		ID:       accountID,
		Provider: cfg.Provider,
		Email:    email,
		Secrets: model.AuthSecrets{
			AccessToken:      tokens.AccessToken,
			RefreshToken:     tokens.RefreshToken,
			IDToken:          tokens.IDToken,
			AccountID:        tokenAccountID,
			AccessExpiresAt:  tokens.AccessExpiresAt,
			RefreshExpiresAt: tokens.RefreshExpiresAt,
		},
	})
	if err != nil {
		userMsg, stage := classifyAddAccountError(err)
		log.Printf("oauth callback add-account failed provider=%s account_id=%s stage=%s state=%s err=%v", cfg.Provider, accountID, stage, state, err)
		s.failSession(state, userMsg)
		writeOAuthHTML(w, false, userMsg)
		return
	}

	s.completeSession(state, acct.ID)
	writeOAuthHTML(w, true, "Switchly login succeeded. You can close this tab.")
}

func classifyAddAccountError(err error) (message, stage string) {
	if errors.Is(err, core.ErrPersistSecrets) {
		return "failed to store OAuth credentials locally", "secret_persist"
	}
	if errors.Is(err, core.ErrPersistState) {
		return "failed to persist account metadata locally", "state_persist"
	}
	return err.Error(), "unknown"
}

func (s *Service) failSession(state, msg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess, ok := s.sessions[state]; ok {
		sess.Status = SessionError
		sess.Error = msg
	}
}

func (s *Service) completeSession(state, accountID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess, ok := s.sessions[state]; ok {
		sess.Status = SessionSuccess
		sess.AccountID = accountID
		sess.Error = ""
	}
}

type tokenResponse struct {
	AccessToken           string `json:"access_token"`
	RefreshToken          string `json:"refresh_token"`
	IDToken               string `json:"id_token"`
	ExpiresIn             int    `json:"expires_in"`
	RefreshTokenExpiresIn int    `json:"refresh_token_expires_in"`
}

func (s *Service) exchangeCode(ctx context.Context, cfg ProviderConfig, code, verifier string) (model.AuthSecrets, error) {
	redirectURI := strings.TrimSpace(cfg.RedirectURI)
	if redirectURI == "" {
		redirectURI = s.baseURL + "/auth/callback"
	}
	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("code", code)
	values.Set("redirect_uri", redirectURI)
	values.Set("client_id", cfg.ClientID)
	values.Set("code_verifier", verifier)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return model.AuthSecrets{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return model.AuthSecrets{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return model.AuthSecrets{}, fmt.Errorf("token exchange failed: status %d body=%s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var parsed tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return model.AuthSecrets{}, err
	}
	if parsed.AccessToken == "" {
		return model.AuthSecrets{}, errors.New("token exchange returned empty access_token")
	}

	now := time.Now().UTC()
	expiresIn := parsed.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}
	refreshIn := parsed.RefreshTokenExpiresIn

	out := model.AuthSecrets{
		AccessToken:     parsed.AccessToken,
		RefreshToken:    parsed.RefreshToken,
		IDToken:         parsed.IDToken,
		AccessExpiresAt: now.Add(time.Duration(expiresIn) * time.Second),
	}
	if refreshIn > 0 {
		out.RefreshExpiresAt = now.Add(time.Duration(refreshIn) * time.Second)
	}
	return out, nil
}

func buildAccountID(provider, email, accountID string) string {
	if email != "" {
		return fmt.Sprintf("%s:%s", provider, strings.ToLower(strings.TrimSpace(email)))
	}
	if accountID != "" {
		return fmt.Sprintf("%s:%s", provider, accountID)
	}
	stamp := time.Now().UTC().Format("20060102150405")
	return fmt.Sprintf("%s:%s", provider, stamp)
}

func decodeIdentityFromIDToken(idToken string) (email, accountID string) {
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
	if m := len(payload) % 4; m != 0 {
		payload += strings.Repeat("=", 4-m)
	}

	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", ""
	}

	var claims map[string]interface{}
	if err := json.Unmarshal(decoded, &claims); err != nil {
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

func randomURLSafe(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func pkceS256(verifier string) string {
	hash := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

func writeOAuthHTML(w http.ResponseWriter, ok bool, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	status := "Login failed"
	color := "#b91c1c"
	if ok {
		status = "Login successful"
		color = "#166534"
	}
	_, _ = fmt.Fprintf(w, "<!doctype html><html><head><meta charset=\"utf-8\"><title>Switchly OAuth</title></head><body style=\"font-family:Segoe UI,Arial,sans-serif;padding:24px;\"><h2 style=\"color:%s\">%s</h2><p>%s</p></body></html>", color, status, message)
}
