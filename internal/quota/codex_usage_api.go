package quota

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const codexUsageURL = "https://chatgpt.com/backend-api/wham/usage"

type codexUsageResponse struct {
	RateLimit *struct {
		LimitReached    bool            `json:"limit_reached"`
		PrimaryWindow   *codexAPIWindow `json:"primary_window"`
		SecondaryWindow *codexAPIWindow `json:"secondary_window"`
	} `json:"rate_limit"`
}

type codexAPIWindow struct {
	UsedPercent float64 `json:"used_percent"`
	ResetAt     int64   `json:"reset_at"`
}

func FetchCodexSnapshot(ctx context.Context, httpClient *http.Client, accessToken, accountID string) (Snapshot, error) {
	if strings.TrimSpace(accessToken) == "" {
		return Snapshot{}, fmt.Errorf("codex access token is empty")
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, codexUsageURL, nil)
	if err != nil {
		return Snapshot{}, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	if v := strings.TrimSpace(accountID); v != "" {
		req.Header.Set("ChatGPT-Account-Id", v)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return Snapshot{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			return Snapshot{}, fmt.Errorf("quota usage request failed: status %d", resp.StatusCode)
		}
		return Snapshot{}, fmt.Errorf("quota usage request failed: status %d: %s", resp.StatusCode, msg)
	}

	var raw codexUsageResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return Snapshot{}, err
	}
	if raw.RateLimit == nil {
		return Snapshot{}, fmt.Errorf("quota usage response missing rate_limit")
	}

	snap := Snapshot{
		SourceTimestamp: time.Now().UTC(),
		LimitReached:    raw.RateLimit.LimitReached,
	}
	// Primary/secondary mapping differs by account tier.
	// Paid accounts usually return both windows (primary=session, secondary=weekly).
	// Free accounts may return only one long-horizon window via primary (weekly).
	primary := toWindowFromAPI(raw.RateLimit.PrimaryWindow)
	secondary := toWindowFromAPI(raw.RateLimit.SecondaryWindow)
	if secondaryLooksPlaceholder(secondary) && looksLikeWeeklyOnlyPrimary(primary, snap.SourceTimestamp) {
		secondary = nil
	}
	if secondary != nil {
		snap.Session = primary
		snap.Weekly = secondary
	} else if looksLikeWeeklyOnlyPrimary(primary, snap.SourceTimestamp) {
		snap.Weekly = primary
		snap.SessionUnsupported = true
	} else {
		snap.Session = primary
	}
	return snap, nil
}

func toWindowFromAPI(raw *codexAPIWindow) *Window {
	if raw == nil {
		return nil
	}
	return toWindow(&rawWindow{
		UsedPercent: raw.UsedPercent,
		ResetsAt:    raw.ResetAt,
	})
}

func looksLikeWeeklyOnlyPrimary(primary *Window, now time.Time) bool {
	if primary == nil || primary.ResetAt.IsZero() {
		return false
	}
	return primary.ResetAt.After(now.Add(24 * time.Hour))
}

func secondaryLooksPlaceholder(secondary *Window) bool {
	if secondary == nil {
		return false
	}
	return secondary.UsedPercent == 0 && secondary.ResetAt.IsZero()
}
