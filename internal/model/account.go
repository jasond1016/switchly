package model

import "time"

type RoutingStrategy string

const (
	RoutingRoundRobin RoutingStrategy = "round-robin"
	RoutingFillFirst  RoutingStrategy = "fill-first"
)

type AccountStatus string

const (
	AccountReady      AccountStatus = "ready"
	AccountNeedReauth AccountStatus = "need_reauth"
	AccountDisabled   AccountStatus = "disabled"
)

type QuotaWindow struct {
	UsedPercent int       `json:"used_percent"`
	ResetAt     time.Time `json:"reset_at,omitempty"`
}

type QuotaSnapshot struct {
	Session          QuotaWindow `json:"session"`
	Weekly           QuotaWindow `json:"weekly"`
	SessionSupported *bool       `json:"session_supported,omitempty"`
	LimitReached     bool        `json:"limit_reached"`
	LastUpdated      time.Time   `json:"last_updated"`
}

type Account struct {
	ID               string        `json:"id"`
	Provider         string        `json:"provider"`
	Email            string        `json:"email,omitempty"`
	Status           AccountStatus `json:"status"`
	LastAppliedAt    time.Time     `json:"last_applied_at,omitempty"`
	AccessExpiresAt  time.Time     `json:"access_expires_at,omitempty"`
	RefreshExpiresAt time.Time     `json:"refresh_expires_at,omitempty"`
	LastRefreshAt    time.Time     `json:"last_refresh_at,omitempty"`
	LastError        string        `json:"last_error,omitempty"`
	Quota            QuotaSnapshot `json:"quota"`
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
}

type AuthSecrets struct {
	AccessToken      string    `json:"access_token"`
	RefreshToken     string    `json:"refresh_token,omitempty"`
	IDToken          string    `json:"id_token,omitempty"`
	AccountID        string    `json:"account_id,omitempty"`
	AccessExpiresAt  time.Time `json:"access_expires_at,omitempty"`
	RefreshExpiresAt time.Time `json:"refresh_expires_at,omitempty"`
}
