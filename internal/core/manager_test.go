package core

import (
	"context"
	"errors"
	"testing"

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
