package store

import (
	"encoding/json"
	"errors"
	"os"
	"sync"
	"time"

	"switchly/internal/model"
	"switchly/internal/platform"
)

type StateStore struct {
	mu   sync.RWMutex
	path string
}

func NewStateStore() (*StateStore, error) {
	if _, err := platform.EnsureConfigDir(); err != nil {
		return nil, err
	}
	path, err := platform.DataFilePath()
	if err != nil {
		return nil, err
	}
	return &StateStore{path: path}, nil
}

func (s *StateStore) Load() (model.AppState, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return model.DefaultState(), nil
	}
	if err != nil {
		return model.AppState{}, err
	}

	var state model.AppState
	if err := json.Unmarshal(data, &state); err != nil {
		return model.AppState{}, err
	}
	if state.Accounts == nil {
		state.Accounts = map[string]model.Account{}
	}
	if state.Strategy == "" {
		state.Strategy = model.RoutingRoundRobin
	}
	return state, nil
}

func (s *StateStore) Save(state model.AppState) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	state.UpdatedAt = time.Now().UTC()
	if state.Accounts == nil {
		state.Accounts = map[string]model.Account{}
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.path, data, 0o600)
}

func (s *StateStore) Path() string {
	return s.path
}
