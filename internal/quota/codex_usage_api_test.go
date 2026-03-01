package quota

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestFetchCodexSnapshotSuccess(t *testing.T) {
	client := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			if got := req.Header.Get("Authorization"); got != "Bearer token-a" {
				t.Fatalf("unexpected auth header: %s", got)
			}
			if got := req.Header.Get("ChatGPT-Account-Id"); got != "acct-a" {
				t.Fatalf("unexpected account header: %s", got)
			}
			body := `{"rate_limit":{"limit_reached":true,"primary_window":{"used_percent":12.6,"reset_at":1771700000},"secondary_window":{"used_percent":34.2,"reset_at":1772700000}}}`
			return &http.Response{
				StatusCode: 200,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		}),
	}

	snap, err := FetchCodexSnapshot(context.Background(), client, "token-a", "acct-a")
	if err != nil {
		t.Fatalf("fetch snapshot: %v", err)
	}
	if snap.Session == nil || snap.Weekly == nil {
		t.Fatalf("missing windows: %#v", snap)
	}
	if snap.Session.UsedPercent != 13 || snap.Weekly.UsedPercent != 34 {
		t.Fatalf("unexpected percents: session=%d weekly=%d", snap.Session.UsedPercent, snap.Weekly.UsedPercent)
	}
	if !snap.LimitReached {
		t.Fatal("expected limit_reached=true")
	}
	if snap.SourceTimestamp.IsZero() || time.Since(snap.SourceTimestamp) > 5*time.Second {
		t.Fatalf("unexpected source timestamp: %s", snap.SourceTimestamp)
	}
}

func TestFetchCodexSnapshotHTTPError(t *testing.T) {
	client := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: 401,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"detail":"unauthorized"}`)),
			}, nil
		}),
	}

	_, err := FetchCodexSnapshot(context.Background(), client, "token-a", "")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if got := err.Error(); !strings.Contains(got, "status 401") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestFetchCodexSnapshotPrimaryOnlyLooksLikeWeekly(t *testing.T) {
	now := time.Now().UTC().Add(7 * 24 * time.Hour).Unix()
	client := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			body := `{"rate_limit":{"limit_reached":false,"primary_window":{"used_percent":2.1,"reset_at":` + strconv.FormatInt(now, 10) + `}}}`
			return &http.Response{
				StatusCode: 200,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		}),
	}

	snap, err := FetchCodexSnapshot(context.Background(), client, "token-a", "")
	if err != nil {
		t.Fatalf("fetch snapshot: %v", err)
	}
	if snap.Session != nil {
		t.Fatalf("expected session=nil for weekly-only primary, got %#v", snap.Session)
	}
	if snap.Weekly == nil || snap.Weekly.UsedPercent != 2 {
		t.Fatalf("expected weekly from primary, got %#v", snap.Weekly)
	}
	if !snap.SessionUnsupported {
		t.Fatalf("expected session_unsupported=true")
	}
}

func TestFetchCodexSnapshotPrimaryOnlyShortHorizonKeepsSession(t *testing.T) {
	now := time.Now().UTC().Add(2 * time.Hour).Unix()
	client := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			body := `{"rate_limit":{"limit_reached":false,"primary_window":{"used_percent":2.1,"reset_at":` + strconv.FormatInt(now, 10) + `}}}`
			return &http.Response{
				StatusCode: 200,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		}),
	}

	snap, err := FetchCodexSnapshot(context.Background(), client, "token-a", "")
	if err != nil {
		t.Fatalf("fetch snapshot: %v", err)
	}
	if snap.Session == nil || snap.Session.UsedPercent != 2 {
		t.Fatalf("expected session from primary, got %#v", snap.Session)
	}
	if snap.Weekly != nil {
		t.Fatalf("expected weekly=nil, got %#v", snap.Weekly)
	}
	if snap.SessionUnsupported {
		t.Fatalf("expected session_unsupported=false")
	}
}

func TestFetchCodexSnapshotIgnoresPlaceholderSecondaryForWeeklyOnly(t *testing.T) {
	primaryReset := time.Now().UTC().Add(7 * 24 * time.Hour).Unix()
	client := &http.Client{
		Transport: roundTripperFunc(func(req *http.Request) (*http.Response, error) {
			body := `{"rate_limit":{"limit_reached":false,"primary_window":{"used_percent":0.1,"reset_at":` + strconv.FormatInt(primaryReset, 10) + `},"secondary_window":{"used_percent":0,"reset_at":0}}}`
			return &http.Response{
				StatusCode: 200,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		}),
	}

	snap, err := FetchCodexSnapshot(context.Background(), client, "token-a", "")
	if err != nil {
		t.Fatalf("fetch snapshot: %v", err)
	}
	if snap.Session != nil {
		t.Fatalf("expected session=nil for weekly-only primary+placeholder secondary, got %#v", snap.Session)
	}
	if snap.Weekly == nil || snap.Weekly.UsedPercent != 0 {
		t.Fatalf("expected weekly from primary, got %#v", snap.Weekly)
	}
	if !snap.SessionUnsupported {
		t.Fatalf("expected session_unsupported=true")
	}
}
