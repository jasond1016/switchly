package core

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"switchly/internal/model"
	"switchly/internal/quota"
)

func TestShouldSwitch(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		message string
		want    bool
	}{
		{name: "status 429", status: 429, message: "", want: true},
		{name: "quota pattern", status: 400, message: "insufficient_quota", want: true},
		{name: "rate limit text", status: 200, message: "Rate limit exceeded", want: true},
		{name: "regular 200", status: 200, message: "ok", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldSwitch(tt.status, tt.message)
			if got != tt.want {
				t.Fatalf("shouldSwitch(%d,%q)=%v want %v", tt.status, tt.message, got, tt.want)
			}
		})
	}
}

func TestValidateAddAccountInput(t *testing.T) {
	tests := []struct {
		name    string
		input   AddAccountInput
		wantErr string
	}{
		{
			name: "missing id",
			input: AddAccountInput{
				Provider: "codex",
				Secrets:  model.AuthSecrets{AccessToken: "token"},
			},
			wantErr: "id is required",
		},
		{
			name: "missing provider",
			input: AddAccountInput{
				ID:      "acc-1",
				Secrets: model.AuthSecrets{AccessToken: "token"},
			},
			wantErr: "provider is required",
		},
		{
			name: "missing access token",
			input: AddAccountInput{
				ID:       "acc-1",
				Provider: "codex",
			},
			wantErr: "access_token is required",
		},
		{
			name: "valid input",
			input: AddAccountInput{
				ID:       "acc-1",
				Provider: "codex",
				Secrets:  model.AuthSecrets{AccessToken: "token"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateAddAccountInput(tt.input)
			if tt.wantErr == "" && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.wantErr != "" {
				if err == nil || err.Error() != tt.wantErr {
					t.Fatalf("expected %q, got %v", tt.wantErr, err)
				}
			}
		})
	}
}

func TestMergeQuotaSnapshot(t *testing.T) {
	now := time.Date(2026, 2, 23, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		current model.QuotaSnapshot
		snap    quota.Snapshot
		want    model.QuotaSnapshot
	}{
		{
			name: "preserves missing windows and sets timestamp",
			current: model.QuotaSnapshot{
				Session: model.QuotaWindow{UsedPercent: 20},
				Weekly:  model.QuotaWindow{UsedPercent: 35},
			},
			snap: quota.Snapshot{},
			want: model.QuotaSnapshot{
				Session:      model.QuotaWindow{UsedPercent: 20},
				Weekly:       model.QuotaWindow{UsedPercent: 35},
				LimitReached: false,
				LastUpdated:  now,
			},
		},
		{
			name: "derives limit reached from merged values",
			current: model.QuotaSnapshot{
				Session: model.QuotaWindow{UsedPercent: 20},
				Weekly:  model.QuotaWindow{UsedPercent: 40},
			},
			snap: quota.Snapshot{
				Session: &quota.Window{UsedPercent: 100},
			},
			want: model.QuotaSnapshot{
				Session:      model.QuotaWindow{UsedPercent: 100},
				Weekly:       model.QuotaWindow{UsedPercent: 40},
				LimitReached: true,
				LastUpdated:  now,
			},
		},
		{
			name: "keeps explicit snapshot limit signal",
			current: model.QuotaSnapshot{
				Session: model.QuotaWindow{UsedPercent: 10},
				Weekly:  model.QuotaWindow{UsedPercent: 20},
			},
			snap: quota.Snapshot{
				Weekly:       &quota.Window{UsedPercent: 30},
				LimitReached: true,
			},
			want: model.QuotaSnapshot{
				Session:      model.QuotaWindow{UsedPercent: 10},
				Weekly:       model.QuotaWindow{UsedPercent: 30},
				LimitReached: true,
				LastUpdated:  now,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := mergeQuotaSnapshot(tt.current, tt.snap, now)
			if got.Session.UsedPercent != tt.want.Session.UsedPercent ||
				got.Weekly.UsedPercent != tt.want.Weekly.UsedPercent ||
				got.LimitReached != tt.want.LimitReached ||
				!got.LastUpdated.Equal(now) {
				t.Fatalf("mergeQuotaSnapshot()=%#v want %#v", got, tt.want)
			}
		})
	}
}

func TestOrderedCandidatesFillFirst(t *testing.T) {
	state := model.AppState{
		Strategy: model.RoutingFillFirst,
		Accounts: map[string]model.Account{
			"A": {ID: "A", Quota: model.QuotaSnapshot{Session: model.QuotaWindow{UsedPercent: 70}, Weekly: model.QuotaWindow{UsedPercent: 10}}},
			"B": {ID: "B", Quota: model.QuotaSnapshot{Session: model.QuotaWindow{UsedPercent: 30}, Weekly: model.QuotaWindow{UsedPercent: 10}}},
			"C": {ID: "C", Quota: model.QuotaSnapshot{Session: model.QuotaWindow{UsedPercent: 20}, Weekly: model.QuotaWindow{UsedPercent: 10}}},
		},
	}

	got := orderedCandidates(state, "A")
	if len(got) != 2 || got[0] != "C" || got[1] != "B" {
		t.Fatalf("unexpected order: %#v", got)
	}
}

func TestAddAccountDoesNotPersistStateWhenSecretWriteFails(t *testing.T) {
	state := &fakeStateStore{state: model.DefaultState()}
	secretErr := errors.New("secret write failed")
	secrets := &fakeSecretStore{putErr: secretErr}
	mgr := NewManager(state, secrets)

	_, err := mgr.AddAccount(context.Background(), AddAccountInput{
		ID:       "codex:test@example.com",
		Provider: "codex",
		Email:    "test@example.com",
		Secrets: model.AuthSecrets{
			AccessToken: "access-token",
		},
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, ErrPersistSecrets) {
		t.Fatalf("expected ErrPersistSecrets, got %v", err)
	}
	if state.saveCalls != 0 {
		t.Fatalf("state save should not be called, got %d", state.saveCalls)
	}
	if _, ok := state.state.Accounts["codex:test@example.com"]; ok {
		t.Fatal("account should not be persisted in state")
	}
}

func TestAddAccountRollsBackSecretsWhenStateSaveFails(t *testing.T) {
	state := &fakeStateStore{
		state:   model.DefaultState(),
		saveErr: errors.New("disk full"),
	}
	secrets := &fakeSecretStore{}
	mgr := NewManager(state, secrets)

	_, err := mgr.AddAccount(context.Background(), AddAccountInput{
		ID:       "codex:test@example.com",
		Provider: "codex",
		Email:    "test@example.com",
		Secrets: model.AuthSecrets{
			AccessToken: "access-token",
		},
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, ErrPersistState) {
		t.Fatalf("expected ErrPersistState, got %v", err)
	}
	if secrets.putCalls != 1 {
		t.Fatalf("expected one secret Put call, got %d", secrets.putCalls)
	}
	if secrets.deleteCalls != 1 {
		t.Fatalf("expected one secret Delete call, got %d", secrets.deleteCalls)
	}
	if _, ok := state.state.Accounts["codex:test@example.com"]; ok {
		t.Fatal("account should not be persisted in state")
	}
}

func TestSetActiveAccountAppliesTokens(t *testing.T) {
	state := &fakeStateStore{
		state: model.AppState{
			Version:         1,
			ActiveAccountID: "codex:old@example.com",
			Strategy:        model.RoutingRoundRobin,
			Accounts: map[string]model.Account{
				"codex:old@example.com": {ID: "codex:old@example.com", Provider: "codex", Status: model.AccountReady},
				"codex:new@example.com": {ID: "codex:new@example.com", Provider: "codex", Status: model.AccountReady},
			},
		},
	}
	secrets := &fakeSecretStore{
		entries: map[string]model.AuthSecrets{
			"codex:old@example.com": {AccessToken: "old"},
			"codex:new@example.com": {AccessToken: "new"},
		},
	}
	applier := &fakeApplier{}
	mgr := NewManager(state, secrets, WithActiveAccountApplier(applier))

	if err := mgr.SetActiveAccount(context.Background(), "codex:new@example.com"); err != nil {
		t.Fatalf("set active: %v", err)
	}
	if state.state.ActiveAccountID != "codex:new@example.com" {
		t.Fatalf("active account mismatch: %s", state.state.ActiveAccountID)
	}
	if applier.calls != 1 {
		t.Fatalf("expected one apply call, got %d", applier.calls)
	}
	if applier.lastAccountID != "codex:new@example.com" {
		t.Fatalf("applied wrong account: %s", applier.lastAccountID)
	}
	if state.state.Accounts["codex:new@example.com"].LastAppliedAt.IsZero() {
		t.Fatal("expected last_applied_at to be set")
	}
}

func TestSetActiveAccountDoesNotChangeStateWhenApplyFails(t *testing.T) {
	state := &fakeStateStore{
		state: model.AppState{
			Version:         1,
			ActiveAccountID: "codex:old@example.com",
			Strategy:        model.RoutingRoundRobin,
			Accounts: map[string]model.Account{
				"codex:old@example.com": {ID: "codex:old@example.com", Provider: "codex", Status: model.AccountReady},
				"codex:new@example.com": {ID: "codex:new@example.com", Provider: "codex", Status: model.AccountReady},
			},
		},
	}
	secrets := &fakeSecretStore{
		entries: map[string]model.AuthSecrets{
			"codex:old@example.com": {AccessToken: "old"},
			"codex:new@example.com": {AccessToken: "new"},
		},
	}
	applier := &fakeApplier{applyErr: errors.New("cannot write codex auth")}
	mgr := NewManager(state, secrets, WithActiveAccountApplier(applier))

	err := mgr.SetActiveAccount(context.Background(), "codex:new@example.com")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if state.state.ActiveAccountID != "codex:old@example.com" {
		t.Fatalf("active account should remain old, got %s", state.state.ActiveAccountID)
	}
}

func TestHandleQuotaErrorAppliesSwitchedAccount(t *testing.T) {
	state := &fakeStateStore{
		state: model.AppState{
			Version:         1,
			ActiveAccountID: "A",
			Strategy:        model.RoutingRoundRobin,
			Accounts: map[string]model.Account{
				"A": {ID: "A", Provider: "codex", Status: model.AccountReady},
				"B": {ID: "B", Provider: "codex", Status: model.AccountReady},
			},
		},
	}
	secrets := &fakeSecretStore{
		entries: map[string]model.AuthSecrets{
			"A": {AccessToken: "token-a", AccessExpiresAt: time.Now().UTC().Add(5 * time.Minute)},
			"B": {AccessToken: "token-b", AccessExpiresAt: time.Now().UTC().Add(5 * time.Minute)},
		},
	}
	applier := &fakeApplier{}
	mgr := NewManager(state, secrets, WithActiveAccountApplier(applier))

	decision, err := mgr.HandleQuotaError(context.Background(), 429, "quota exceeded")
	if err != nil {
		t.Fatalf("handle quota: %v", err)
	}
	if !decision.Switched || decision.ToAccountID != "B" {
		t.Fatalf("unexpected decision: %#v", decision)
	}
	if applier.lastAccountID != "B" {
		t.Fatalf("expected apply B, got %s", applier.lastAccountID)
	}
	if state.state.Accounts["B"].LastAppliedAt.IsZero() {
		t.Fatal("expected switched account last_applied_at to be set")
	}
}

func TestSyncQuotaFromCodexAPIFetchesViaAPI(t *testing.T) {
	state := &fakeStateStore{
		state: model.AppState{
			Version:         1,
			ActiveAccountID: "A",
			Strategy:        model.RoutingRoundRobin,
			Accounts: map[string]model.Account{
				"A": {
					ID:       "A",
					Provider: "codex",
					Status:   model.AccountReady,
				},
			},
		},
	}
	secrets := &fakeSecretStore{
		entries: map[string]model.AuthSecrets{
			"A": {
				AccessToken:     "token-a",
				AccountID:       "acct-a",
				AccessExpiresAt: time.Now().UTC().Add(5 * time.Minute),
			},
		},
	}
	var gotAccessToken string
	var gotAccountID string
	mgr := NewManager(
		state,
		secrets,
		WithCodexQuotaFetcher(func(ctx context.Context, httpClient *http.Client, accessToken, accountID string) (quota.Snapshot, error) {
			gotAccessToken = accessToken
			gotAccountID = accountID
			return quota.Snapshot{
				SourceTimestamp: time.Date(2026, 2, 19, 12, 2, 0, 0, time.UTC),
				Session:         &quota.Window{UsedPercent: 21},
				Weekly:          &quota.Window{UsedPercent: 33},
				LimitReached:    false,
			}, nil
		}),
	)

	result, err := mgr.SyncQuotaFromCodexAPI(context.Background(), "")
	if err != nil {
		t.Fatalf("expected api sync success, got err: %v", err)
	}
	if gotAccessToken != "token-a" || gotAccountID != "acct-a" {
		t.Fatalf("quota fetcher input mismatch: token=%s account_id=%s", gotAccessToken, gotAccountID)
	}
	if result.Quota.Session.UsedPercent != 21 || result.Quota.Weekly.UsedPercent != 33 {
		t.Fatalf("unexpected quota result: %#v", result.Quota)
	}
}

func TestSyncQuotaFromCodexAPIReturnsFetcherError(t *testing.T) {
	state := &fakeStateStore{
		state: model.AppState{
			Version:         1,
			ActiveAccountID: "A",
			Strategy:        model.RoutingRoundRobin,
			Accounts: map[string]model.Account{
				"A": {
					ID:       "A",
					Provider: "codex",
					Status:   model.AccountReady,
				},
			},
		},
	}
	secrets := &fakeSecretStore{
		entries: map[string]model.AuthSecrets{
			"A": {
				AccessToken:     "token-a",
				AccountID:       "acct-a",
				AccessExpiresAt: time.Now().UTC().Add(5 * time.Minute),
			},
		},
	}
	mgr := NewManager(
		state,
		secrets,
		WithCodexQuotaFetcher(func(ctx context.Context, httpClient *http.Client, accessToken, accountID string) (quota.Snapshot, error) {
			return quota.Snapshot{}, errors.New("usage api down")
		}),
	)

	_, err := mgr.SyncQuotaFromCodexAPI(context.Background(), "")
	if err == nil {
		t.Fatal("expected fetcher error, got nil")
	}
	if got := err.Error(); !strings.Contains(got, "usage api down") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSyncQuotaFromCodexAPIMarksNeedReauthWhenRefreshFails(t *testing.T) {
	state := &fakeStateStore{
		state: model.AppState{
			Version:         1,
			ActiveAccountID: "A",
			Strategy:        model.RoutingRoundRobin,
			Accounts: map[string]model.Account{
				"A": {
					ID:       "A",
					Provider: "codex",
					Status:   model.AccountReady,
				},
			},
		},
	}
	secrets := &fakeSecretStore{
		entries: map[string]model.AuthSecrets{
			"A": {
				AccessToken:     "token-a",
				AccessExpiresAt: time.Now().UTC().Add(-1 * time.Minute),
				// no refresh token
			},
		},
	}
	mgr := NewManager(state, secrets, WithCodexQuotaFetcher(func(ctx context.Context, httpClient *http.Client, accessToken, accountID string) (quota.Snapshot, error) {
		t.Fatal("quota fetcher should not be called when refresh fails")
		return quota.Snapshot{}, nil
	}))

	_, err := mgr.SyncQuotaFromCodexAPI(context.Background(), "")
	if err == nil {
		t.Fatal("expected refresh error, got nil")
	}
	if got := state.state.Accounts["A"].Status; got != model.AccountNeedReauth {
		t.Fatalf("expected need_reauth, got %s", got)
	}
}

func TestSyncAllQuotasFromCodexAPIContinuesOnPerAccountFailures(t *testing.T) {
	now := time.Now().UTC()
	state := &fakeStateStore{
		state: model.AppState{
			Version:         1,
			ActiveAccountID: "A",
			Strategy:        model.RoutingRoundRobin,
			Accounts: map[string]model.Account{
				"A": {ID: "A", Provider: "codex", Status: model.AccountReady},
				"B": {ID: "B", Provider: "codex", Status: model.AccountReady},
				"C": {ID: "C", Provider: "other", Status: model.AccountReady},
			},
		},
	}
	secrets := &fakeSecretStore{
		entries: map[string]model.AuthSecrets{
			"A": {AccessToken: "token-a", AccountID: "acct-a", AccessExpiresAt: now.Add(5 * time.Minute)},
			"B": {AccessToken: "token-b", AccountID: "acct-b", AccessExpiresAt: now.Add(5 * time.Minute)},
		},
	}

	mgr := NewManager(
		state,
		secrets,
		WithCodexQuotaFetcher(func(ctx context.Context, httpClient *http.Client, accessToken, accountID string) (quota.Snapshot, error) {
			switch accountID {
			case "acct-a":
				return quota.Snapshot{Session: &quota.Window{UsedPercent: 12}, Weekly: &quota.Window{UsedPercent: 20}}, nil
			case "acct-b":
				return quota.Snapshot{}, errors.New("upstream 500")
			default:
				return quota.Snapshot{}, errors.New("unexpected account")
			}
		}),
	)

	out, err := mgr.SyncAllQuotasFromCodexAPI(context.Background())
	if err != nil {
		t.Fatalf("sync all err: %v", err)
	}
	if out.Total != 3 || out.Succeeded != 1 || out.Failed != 2 {
		t.Fatalf("unexpected counters: %#v", out)
	}
	if len(out.Results) != 3 {
		t.Fatalf("expected 3 per-account results, got %d", len(out.Results))
	}

	var foundA, foundB, foundC bool
	for _, item := range out.Results {
		switch item.AccountID {
		case "A":
			foundA = true
			if !item.Success || item.Result == nil {
				t.Fatalf("expected A success with result, got %#v", item)
			}
		case "B":
			foundB = true
			if item.Success || !strings.Contains(item.Error, "upstream 500") {
				t.Fatalf("expected B fetch failure, got %#v", item)
			}
		case "C":
			foundC = true
			if item.Success || !strings.Contains(item.Error, "not supported") {
				t.Fatalf("expected C provider failure, got %#v", item)
			}
		}
	}
	if !foundA || !foundB || !foundC {
		t.Fatalf("missing expected account results: A=%v B=%v C=%v", foundA, foundB, foundC)
	}
}

func TestSyncAllQuotasFromCodexAPIWithNoAccounts(t *testing.T) {
	state := &fakeStateStore{state: model.DefaultState()}
	secrets := &fakeSecretStore{}
	mgr := NewManager(state, secrets)

	out, err := mgr.SyncAllQuotasFromCodexAPI(context.Background())
	if err != nil {
		t.Fatalf("sync all should not fail on empty state: %v", err)
	}
	if out.Total != 0 || out.Succeeded != 0 || out.Failed != 0 || len(out.Results) != 0 {
		t.Fatalf("unexpected output: %#v", out)
	}
}

func TestCodexSecretsNeedImport(t *testing.T) {
	tests := []struct {
		name     string
		current  model.AuthSecrets
		incoming model.AuthSecrets
		want     bool
	}{
		{
			name: "same refresh token and account id means no import",
			current: model.AuthSecrets{
				AccessToken:  "old-access",
				RefreshToken: "refresh-1",
				AccountID:    "acc-1",
			},
			incoming: model.AuthSecrets{
				AccessToken:  "new-access",
				RefreshToken: "refresh-1",
				AccountID:    "acc-1",
			},
			want: false,
		},
		{
			name: "refresh token mismatch requires import",
			current: model.AuthSecrets{
				RefreshToken: "refresh-1",
				AccountID:    "acc-1",
			},
			incoming: model.AuthSecrets{
				RefreshToken: "refresh-2",
				AccountID:    "acc-1",
			},
			want: true,
		},
		{
			name: "account id mismatch requires import",
			current: model.AuthSecrets{
				RefreshToken: "refresh-1",
				AccountID:    "acc-1",
			},
			incoming: model.AuthSecrets{
				RefreshToken: "refresh-1",
				AccountID:    "acc-2",
			},
			want: true,
		},
		{
			name: "fallback to access token when refresh token is empty",
			current: model.AuthSecrets{
				AccessToken: "access-1",
			},
			incoming: model.AuthSecrets{
				AccessToken: "access-2",
			},
			want: true,
		},
		{
			name: "fallback access token equal means no import",
			current: model.AuthSecrets{
				AccessToken: "access-1",
			},
			incoming: model.AuthSecrets{
				AccessToken: "access-1",
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := codexSecretsNeedImport(tt.current, tt.incoming)
			if got != tt.want {
				t.Fatalf("codexSecretsNeedImport()=%v want %v", got, tt.want)
			}
		})
	}
}

type fakeStateStore struct {
	state     model.AppState
	saveErr   error
	saveCalls int
}

func (s *fakeStateStore) Load() (model.AppState, error) {
	return cloneState(s.state), nil
}

func (s *fakeStateStore) Save(state model.AppState) error {
	s.saveCalls++
	if s.saveErr != nil {
		return s.saveErr
	}
	s.state = cloneState(state)
	return nil
}

type fakeSecretStore struct {
	entries     map[string]model.AuthSecrets
	putErr      error
	getErr      error
	deleteErr   error
	putCalls    int
	getCalls    int
	deleteCalls int
}

type fakeApplier struct {
	calls         int
	lastAccountID string
	applyErr      error
}

func (a *fakeApplier) Apply(_ context.Context, account model.Account, _ model.AuthSecrets) error {
	a.calls++
	a.lastAccountID = account.ID
	return a.applyErr
}

func (s *fakeSecretStore) Put(accountID string, secrets model.AuthSecrets) error {
	s.putCalls++
	if s.putErr != nil {
		return s.putErr
	}
	if s.entries == nil {
		s.entries = map[string]model.AuthSecrets{}
	}
	s.entries[accountID] = secrets
	return nil
}

func (s *fakeSecretStore) Get(accountID string) (model.AuthSecrets, error) {
	s.getCalls++
	if s.getErr != nil {
		return model.AuthSecrets{}, s.getErr
	}
	if s.entries == nil {
		return model.AuthSecrets{}, errors.New("not found")
	}
	value, ok := s.entries[accountID]
	if !ok {
		return model.AuthSecrets{}, errors.New("not found")
	}
	return value, nil
}

func (s *fakeSecretStore) Delete(accountID string) error {
	s.deleteCalls++
	if s.deleteErr != nil {
		return s.deleteErr
	}
	if s.entries != nil {
		delete(s.entries, accountID)
	}
	return nil
}

func cloneState(in model.AppState) model.AppState {
	out := in
	out.Accounts = map[string]model.Account{}
	for id, acct := range in.Accounts {
		out.Accounts[id] = acct
	}
	return out
}
