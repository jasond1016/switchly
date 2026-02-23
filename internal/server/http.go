package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"switchly/internal/codexauth"
	"switchly/internal/core"
	"switchly/internal/model"
	"switchly/internal/oauth"
)

type APIServer struct {
	manager *core.Manager
	oauth   *oauth.Service
	daemon  DaemonController
}

func New(manager *core.Manager, oauthService *oauth.Service, daemonCtl DaemonController) *APIServer {
	return &APIServer{manager: manager, oauth: oauthService, daemon: daemonCtl}
}

func (s *APIServer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/health", s.handleHealth)
	mux.HandleFunc("/v1/status", s.handleStatus)
	mux.HandleFunc("/v1/strategy", s.handleStrategy)
	mux.HandleFunc("/v1/accounts", s.handleAccounts)
	mux.HandleFunc("/v1/accounts/", s.handleAccountDetail)
	mux.HandleFunc("/v1/accounts/import/codex/candidate", s.handleCodexImportCandidate)
	mux.HandleFunc("/v1/accounts/import/codex", s.handleCodexImport)
	mux.HandleFunc("/v1/quota/sync", s.handleQuotaSync)
	mux.HandleFunc("/v1/quota/sync-all", s.handleQuotaSyncAll)
	mux.HandleFunc("/v1/switch/on-error", s.handleSwitchOnError)
	mux.HandleFunc("/v1/oauth/providers", s.handleOAuthProviders)
	mux.HandleFunc("/v1/oauth/start", s.handleOAuthStart)
	mux.HandleFunc("/v1/oauth/status", s.handleOAuthStatus)
	mux.HandleFunc("/v1/oauth/callback", s.handleOAuthCallback)
	mux.HandleFunc("/auth/callback", s.handleOAuthCallback)
	mux.HandleFunc("/v1/daemon/info", s.handleDaemonInfo)
	mux.HandleFunc("/v1/daemon/shutdown", s.handleDaemonShutdown)
	mux.HandleFunc("/v1/daemon/restart", s.handleDaemonRestart)
	return loggingMiddleware(corsMiddleware(mux))
}

func (s *APIServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *APIServer) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	status, err := s.manager.Status(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *APIServer) handleStrategy(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPatch) {
		return
	}
	var req struct {
		Strategy model.RoutingStrategy `json:"strategy"`
	}
	if err := decodeJSONBody(r, &req, false); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.manager.SetStrategy(r.Context(), req.Strategy); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *APIServer) handleAccounts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		accounts, err := s.manager.ListAccounts(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string][]model.Account{"accounts": accounts})
	case http.MethodPost:
		var req struct {
			ID               string `json:"id"`
			Provider         string `json:"provider"`
			Email            string `json:"email"`
			AccessToken      string `json:"access_token"`
			RefreshToken     string `json:"refresh_token"`
			IDToken          string `json:"id_token"`
			AccountID        string `json:"account_id"`
			AccessExpiresAt  string `json:"access_expires_at"`
			RefreshExpiresAt string `json:"refresh_expires_at"`
		}
		if err := decodeJSONBody(r, &req, false); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}

		accessExpiry, err := parseOptionalTime(req.AccessExpiresAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid access_expires_at: %w", err))
			return
		}
		refreshExpiry, err := parseOptionalTime(req.RefreshExpiresAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, fmt.Errorf("invalid refresh_expires_at: %w", err))
			return
		}

		account, err := s.manager.AddAccount(r.Context(), core.AddAccountInput{
			ID:       req.ID,
			Provider: req.Provider,
			Email:    req.Email,
			Secrets: model.AuthSecrets{
				AccessToken:      req.AccessToken,
				RefreshToken:     req.RefreshToken,
				IDToken:          req.IDToken,
				AccountID:        req.AccountID,
				AccessExpiresAt:  accessExpiry,
				RefreshExpiresAt: refreshExpiry,
			},
		})
		if err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusCreated, account)
	default:
		methodNotAllowed(w)
	}
}

type codexImportCandidate struct {
	ID             string `json:"id"`
	Provider       string `json:"provider"`
	Email          string `json:"email,omitempty"`
	AccountIDKnown bool   `json:"account_id_present"`
}

type codexImportCandidateResponse struct {
	Found         bool                  `json:"found"`
	Candidate     *codexImportCandidate `json:"candidate,omitempty"`
	AlreadyExists bool                  `json:"already_exists,omitempty"`
}

func (s *APIServer) handleCodexImportCandidate(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}

	localAccount, err := codexauth.LoadLocalAccountFromDefaultFile()
	if err != nil {
		if errors.Is(err, codexauth.ErrAuthFileNotFound) {
			writeJSON(w, http.StatusOK, codexImportCandidateResponse{Found: false})
			return
		}
		writeError(w, http.StatusBadRequest, fmt.Errorf("discover codex auth candidate: %w", err))
		return
	}
	if err := localAccount.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("discover codex auth candidate: %w", err))
		return
	}

	accounts, err := s.manager.ListAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	exists := containsAccount(accounts, localAccount.ID)
	writeJSON(w, http.StatusOK, codexImportCandidateResponse{
		Found: true,
		Candidate: &codexImportCandidate{
			ID:             localAccount.ID,
			Provider:       "codex",
			Email:          localAccount.Email,
			AccountIDKnown: strings.TrimSpace(localAccount.Secrets.AccountID) != "",
		},
		AlreadyExists: exists,
	})
}

func (s *APIServer) handleCodexImport(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	var req struct {
		OverwriteExisting *bool `json:"overwrite_existing"`
	}
	if err := decodeJSONBody(r, &req, true); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	overwriteExisting := true
	if req.OverwriteExisting != nil {
		overwriteExisting = *req.OverwriteExisting
	}

	localAccount, err := codexauth.LoadLocalAccountFromDefaultFile()
	if err != nil {
		if errors.Is(err, codexauth.ErrAuthFileNotFound) {
			writeError(w, http.StatusNotFound, err)
			return
		}
		writeError(w, http.StatusBadRequest, fmt.Errorf("import codex auth: %w", err))
		return
	}
	if err := localAccount.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("import codex auth: %w", err))
		return
	}

	accounts, err := s.manager.ListAccounts(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	exists := containsAccount(accounts, localAccount.ID)
	if exists && !overwriteExisting {
		writeError(w, http.StatusConflict, errors.New("account already exists"))
		return
	}

	account, err := s.manager.AddAccount(r.Context(), core.AddAccountInput{
		ID:       localAccount.ID,
		Provider: "codex",
		Email:    localAccount.Email,
		Secrets:  localAccount.Secrets,
	})
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	action := "created"
	if exists {
		action = "updated"
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":  "ok",
		"action":  action,
		"account": account,
	})
}

func (s *APIServer) handleAccountDetail(w http.ResponseWriter, r *http.Request) {
	accountID, action, err := parseAccountActionPath(r.URL.Path)
	if err != nil {
		writeError(w, http.StatusNotFound, errors.New("not found"))
		return
	}

	switch action {
	case "activate":
		if !requireMethod(w, r, http.MethodPost) {
			return
		}
		if err := s.manager.SetActiveAccount(r.Context(), accountID); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	case "quota":
		if !requireMethod(w, r, http.MethodPatch) {
			return
		}
		var q model.QuotaSnapshot
		if err := decodeJSONBody(r, &q, false); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := s.manager.UpdateQuota(r.Context(), accountID, q); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	default:
		writeError(w, http.StatusNotFound, errors.New("not found"))
	}
}

func containsAccount(accounts []model.Account, accountID string) bool {
	for _, account := range accounts {
		if account.ID == accountID {
			return true
		}
	}
	return false
}

func (s *APIServer) handleSwitchOnError(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	var req struct {
		StatusCode   int    `json:"status_code"`
		ErrorMessage string `json:"error_message"`
	}
	if err := decodeJSONBody(r, &req, false); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	decision, err := s.manager.HandleQuotaError(context.Background(), req.StatusCode, req.ErrorMessage)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, decision)
}

func (s *APIServer) handleQuotaSync(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	var req struct {
		AccountID string `json:"account_id"`
	}
	if err := decodeJSONBody(r, &req, true); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	result, err := s.manager.SyncQuotaFromCodexAPI(r.Context(), req.AccountID)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *APIServer) handleQuotaSyncAll(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}

	result, err := s.manager.SyncAllQuotasFromCodexAPI(r.Context())
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *APIServer) handleOAuthProviders(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if s.oauth == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("oauth service not configured"))
		return
	}
	writeJSON(w, http.StatusOK, map[string][]string{"providers": s.oauth.Providers()})
}

func (s *APIServer) handleOAuthStart(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if s.oauth == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("oauth service not configured"))
		return
	}

	var req struct {
		Provider string `json:"provider"`
	}
	if err := decodeJSONBody(r, &req, false); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	snap, err := s.oauth.Start(req.Provider)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, snap)
}

func (s *APIServer) handleOAuthStatus(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if s.oauth == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("oauth service not configured"))
		return
	}

	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state == "" {
		writeError(w, http.StatusBadRequest, errors.New("missing state"))
		return
	}

	snap, err := s.oauth.Status(state)
	if err != nil {
		writeError(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *APIServer) handleOAuthCallback(w http.ResponseWriter, r *http.Request) {
	if s.oauth == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("oauth service not configured"))
		return
	}
	s.oauth.HandleCallback(w, r)
}

func (s *APIServer) handleDaemonInfo(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	if s.daemon == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("daemon control not configured"))
		return
	}
	writeJSON(w, http.StatusOK, s.daemon.Info())
}

func (s *APIServer) handleDaemonShutdown(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if s.daemon == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("daemon control not configured"))
		return
	}
	if err := s.daemon.Shutdown(); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "shutting_down"})
}

func (s *APIServer) handleDaemonRestart(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodPost) {
		return
	}
	if s.daemon == nil {
		writeError(w, http.StatusServiceUnavailable, errors.New("daemon control not configured"))
		return
	}
	var req struct {
		StartCmd string `json:"start_cmd"`
	}
	if err := decodeJSONBody(r, &req, true); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := s.daemon.Restart(strings.TrimSpace(req.StartCmd)); err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "restarting"})
}

func parseOptionalTime(s string) (time.Time, error) {
	if strings.TrimSpace(s) == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339, s)
}

func parseAccountActionPath(path string) (string, string, error) {
	trimmed := strings.TrimPrefix(path, "/v1/accounts/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 {
		return "", "", errors.New("not found")
	}
	return parts[0], parts[1], nil
}

func decodeJSONBody(r *http.Request, dst interface{}, allowEmpty bool) error {
	err := json.NewDecoder(r.Body).Decode(dst)
	if err != nil && allowEmpty && errors.Is(err, io.EOF) {
		return nil
	}
	return err
}

func requireMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method != method {
		methodNotAllowed(w)
		return false
	}
	return true
}

func methodNotAllowed(w http.ResponseWriter) {
	writeError(w, http.StatusMethodNotAllowed, errors.New("method not allowed"))
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		_ = start
	})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
