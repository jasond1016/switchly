package core

import (
	"context"
	"errors"
	"testing"
	"time"

	"switchly/internal/model"
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
