package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"switchly/internal/model"
	"switchly/internal/secrets"
)

const codexClientID = "app_EMoamEEZ73f0CkXaXp7hrann"

type AddAccountInput struct {
	ID       string
	Provider string
	Email    string
	Secrets  model.AuthSecrets
}

type SwitchDecision struct {
	Switched      bool   `json:"switched"`
	FromAccountID string `json:"from_account_id,omitempty"`
	ToAccountID   string `json:"to_account_id,omitempty"`
	Reason        string `json:"reason,omitempty"`
}

type StatusSnapshot struct {
	ActiveAccountID string                `json:"active_account_id,omitempty"`
	Strategy        model.RoutingStrategy `json:"strategy"`
	Accounts        []model.Account       `json:"accounts"`
}

var (
	ErrPersistSecrets = errors.New("persist secrets failed")
	ErrPersistState   = errors.New("persist state failed")
)

type stateStore interface {
	Load() (model.AppState, error)
	Save(state model.AppState) error
}

type Manager struct {
	mu         sync.Mutex
	stateStore stateStore
	secrets    secrets.Store
	httpClient *http.Client
}

func NewManager(stateStore stateStore, secretStore secrets.Store) *Manager {
	return &Manager{
		stateStore: stateStore,
		secrets:    secretStore,
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
}

func (m *Manager) AddAccount(ctx context.Context, in AddAccountInput) (model.Account, error) {
	_ = ctx
	if strings.TrimSpace(in.ID) == "" {
		return model.Account{}, errors.New("id is required")
	}
	if strings.TrimSpace(in.Provider) == "" {
		return model.Account{}, errors.New("provider is required")
	}
	if strings.TrimSpace(in.Secrets.AccessToken) == "" {
		return model.Account{}, errors.New("access_token is required")
	}

	now := time.Now().UTC()
	if in.Secrets.AccessExpiresAt.IsZero() {
		in.Secrets.AccessExpiresAt = now.Add(50 * time.Minute)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	state, err := m.stateStore.Load()
	if err != nil {
		return model.Account{}, err
	}

	existing, ok := state.Accounts[in.ID]
	createdAt := now
	if ok {
		createdAt = existing.CreatedAt
	}

	acct := model.Account{
		ID:               in.ID,
		Provider:         strings.ToLower(strings.TrimSpace(in.Provider)),
		Email:            strings.TrimSpace(in.Email),
		Status:           model.AccountReady,
		AccessExpiresAt:  in.Secrets.AccessExpiresAt.UTC(),
		RefreshExpiresAt: in.Secrets.RefreshExpiresAt.UTC(),
		CreatedAt:        createdAt,
		UpdatedAt:        now,
	}

	state.Accounts[in.ID] = acct
	if state.ActiveAccountID == "" {
		state.ActiveAccountID = in.ID
	}

	if err := m.secrets.Put(in.ID, in.Secrets); err != nil {
		return model.Account{}, fmt.Errorf("%w: %v", ErrPersistSecrets, err)
	}
	if err := m.stateStore.Save(state); err != nil {
		if rollbackErr := m.secrets.Delete(in.ID); rollbackErr != nil {
			return model.Account{}, fmt.Errorf("%w: %v (rollback failed: %v)", ErrPersistState, err, rollbackErr)
		}
		return model.Account{}, fmt.Errorf("%w: %v", ErrPersistState, err)
	}

	return acct, nil
}

func (m *Manager) ListAccounts(ctx context.Context) ([]model.Account, error) {
	_ = ctx
	state, err := m.stateStore.Load()
	if err != nil {
		return nil, err
	}
	accounts := make([]model.Account, 0, len(state.Accounts))
	for _, a := range state.Accounts {
		accounts = append(accounts, a)
	}
	sort.Slice(accounts, func(i, j int) bool {
		if accounts[i].UpdatedAt.Equal(accounts[j].UpdatedAt) {
			return accounts[i].ID < accounts[j].ID
		}
		return accounts[i].UpdatedAt.After(accounts[j].UpdatedAt)
	})
	return accounts, nil
}

func (m *Manager) SetActiveAccount(ctx context.Context, accountID string) error {
	_ = ctx
	m.mu.Lock()
	defer m.mu.Unlock()

	state, err := m.stateStore.Load()
	if err != nil {
		return err
	}

	acct, ok := state.Accounts[accountID]
	if !ok {
		return fmt.Errorf("account %s not found", accountID)
	}
	if acct.Status == model.AccountNeedReauth || acct.Status == model.AccountDisabled {
		return fmt.Errorf("account %s is not ready", accountID)
	}

	state.ActiveAccountID = accountID
	acct.UpdatedAt = time.Now().UTC()
	state.Accounts[accountID] = acct
	return m.stateStore.Save(state)
}

func (m *Manager) SetStrategy(ctx context.Context, strategy model.RoutingStrategy) error {
	_ = ctx
	if strategy != model.RoutingRoundRobin && strategy != model.RoutingFillFirst {
		return fmt.Errorf("invalid strategy: %s", strategy)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	state, err := m.stateStore.Load()
	if err != nil {
		return err
	}
	state.Strategy = strategy
	return m.stateStore.Save(state)
}

func (m *Manager) Status(ctx context.Context) (StatusSnapshot, error) {
	accounts, err := m.ListAccounts(ctx)
	if err != nil {
		return StatusSnapshot{}, err
	}
	state, err := m.stateStore.Load()
	if err != nil {
		return StatusSnapshot{}, err
	}
	return StatusSnapshot{
		ActiveAccountID: state.ActiveAccountID,
		Strategy:        state.Strategy,
		Accounts:        accounts,
	}, nil
}

func (m *Manager) UpdateQuota(ctx context.Context, accountID string, quota model.QuotaSnapshot) error {
	_ = ctx
	m.mu.Lock()
	defer m.mu.Unlock()

	state, err := m.stateStore.Load()
	if err != nil {
		return err
	}
	acct, ok := state.Accounts[accountID]
	if !ok {
		return fmt.Errorf("account %s not found", accountID)
	}
	quota.LastUpdated = time.Now().UTC()
	acct.Quota = quota
	acct.UpdatedAt = time.Now().UTC()
	state.Accounts[accountID] = acct
	return m.stateStore.Save(state)
}

func (m *Manager) HandleQuotaError(ctx context.Context, statusCode int, errorMessage string) (SwitchDecision, error) {
	if !shouldSwitch(statusCode, errorMessage) {
		return SwitchDecision{Switched: false, Reason: "not-switchable-error"}, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	state, err := m.stateStore.Load()
	if err != nil {
		return SwitchDecision{}, err
	}
	if state.ActiveAccountID == "" {
		return SwitchDecision{}, errors.New("no active account configured")
	}
	if len(state.Accounts) == 0 {
		return SwitchDecision{}, errors.New("no accounts configured")
	}

	activeID := state.ActiveAccountID
	order := orderedCandidates(state, activeID)
	for _, accountID := range order {
		acct := state.Accounts[accountID]
		if acct.Status == model.AccountDisabled {
			continue
		}

		if err := m.ensureFreshToken(ctx, &acct); err != nil {
			acct.Status = model.AccountNeedReauth
			acct.LastError = err.Error()
			acct.UpdatedAt = time.Now().UTC()
			state.Accounts[accountID] = acct
			continue
		}

		acct.Status = model.AccountReady
		acct.LastError = ""
		acct.UpdatedAt = time.Now().UTC()
		state.Accounts[accountID] = acct
		state.ActiveAccountID = accountID

		if err := m.stateStore.Save(state); err != nil {
			return SwitchDecision{}, err
		}

		return SwitchDecision{
			Switched:      true,
			FromAccountID: activeID,
			ToAccountID:   accountID,
			Reason:        "quota-exceeded",
		}, nil
	}

	if err := m.stateStore.Save(state); err != nil {
		return SwitchDecision{}, err
	}
	return SwitchDecision{Switched: false, FromAccountID: activeID, Reason: "no-available-account"}, nil
}

func orderedCandidates(state model.AppState, activeID string) []string {
	ids := make([]string, 0, len(state.Accounts))
	for id := range state.Accounts {
		if id == activeID {
			continue
		}
		ids = append(ids, id)
	}

	if state.Strategy == model.RoutingFillFirst {
		sort.Slice(ids, func(i, j int) bool {
			left := state.Accounts[ids[i]].Quota.Session.UsedPercent + state.Accounts[ids[i]].Quota.Weekly.UsedPercent
			right := state.Accounts[ids[j]].Quota.Session.UsedPercent + state.Accounts[ids[j]].Quota.Weekly.UsedPercent
			if left == right {
				return ids[i] < ids[j]
			}
			return left < right
		})
		return ids
	}

	// round-robin fallback: deterministic by ID for now.
	sort.Strings(ids)
	return ids
}

func shouldSwitch(statusCode int, message string) bool {
	switch statusCode {
	case 429, 500, 503:
		return true
	case 200, 201, 202, 203, 204, 205, 206, 207, 208, 226, 400, 401, 403, 422:
		// Continue to pattern checks below.
	default:
		// Continue to pattern checks below.
	}

	lower := strings.ToLower(message)
	patterns := []string{
		"quota exceeded", "rate limit", "limit reached", "insufficient_quota",
		"resource_exhausted", "overloaded", "capacity", "too many requests",
		"throttl", "authentication", "unauthorized", "access denied",
	}
	for _, p := range patterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return statusCode == 429 || statusCode == 503 || statusCode == 500
}

func (m *Manager) ensureFreshToken(ctx context.Context, account *model.Account) error {
	secretsData, err := m.secrets.Get(account.ID)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	if secretsData.AccessExpiresAt.IsZero() || secretsData.AccessExpiresAt.After(now.Add(30*time.Second)) {
		account.AccessExpiresAt = secretsData.AccessExpiresAt
		account.RefreshExpiresAt = secretsData.RefreshExpiresAt
		return nil
	}

	if strings.TrimSpace(secretsData.RefreshToken) == "" {
		return errors.New("refresh token missing")
	}
	if !secretsData.RefreshExpiresAt.IsZero() && secretsData.RefreshExpiresAt.Before(now) {
		return errors.New("refresh token expired")
	}

	if strings.ToLower(account.Provider) != "codex" {
		return fmt.Errorf("provider %s refresh is not implemented", account.Provider)
	}

	updated, err := m.refreshCodexAccessToken(ctx, secretsData.RefreshToken)
	if err != nil {
		return err
	}
	secretsData.AccessToken = updated.AccessToken
	secretsData.AccessExpiresAt = updated.AccessExpiresAt
	if updated.IDToken != "" {
		secretsData.IDToken = updated.IDToken
	}

	if err := m.secrets.Put(account.ID, secretsData); err != nil {
		return err
	}

	account.AccessExpiresAt = secretsData.AccessExpiresAt
	account.RefreshExpiresAt = secretsData.RefreshExpiresAt
	account.LastRefreshAt = now
	return nil
}

type codexRefreshResponse struct {
	AccessToken string `json:"access_token"`
	IDToken     string `json:"id_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func (m *Manager) refreshCodexAccessToken(ctx context.Context, refreshToken string) (model.AuthSecrets, error) {
	body := map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": refreshToken,
		"client_id":     codexClientID,
	}
	payload, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://auth.openai.com/oauth/token", bytes.NewReader(payload))
	if err != nil {
		return model.AuthSecrets{}, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := m.httpClient.Do(req)
	if err != nil {
		return model.AuthSecrets{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return model.AuthSecrets{}, fmt.Errorf("token refresh failed: status %d", resp.StatusCode)
	}

	var parsed codexRefreshResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return model.AuthSecrets{}, err
	}
	if parsed.AccessToken == "" {
		return model.AuthSecrets{}, errors.New("token refresh returned empty access_token")
	}

	expiresIn := parsed.ExpiresIn
	if expiresIn <= 0 {
		expiresIn = 3600
	}

	return model.AuthSecrets{
		AccessToken:     parsed.AccessToken,
		IDToken:         parsed.IDToken,
		AccessExpiresAt: time.Now().UTC().Add(time.Duration(expiresIn) * time.Second),
	}, nil
}
