package model

import "time"

type AppState struct {
	Version         int                `json:"version"`
	ActiveAccountID string             `json:"active_account_id,omitempty"`
	Strategy        RoutingStrategy    `json:"strategy"`
	Accounts        map[string]Account `json:"accounts"`
	UpdatedAt       time.Time          `json:"updated_at"`
}

func DefaultState() AppState {
	return AppState{
		Version:  1,
		Strategy: RoutingRoundRobin,
		Accounts: map[string]Account{},
	}
}
