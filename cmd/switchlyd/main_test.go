package main

import (
	"net"
	"net/http"
	"testing"
	"time"
)

func TestOAuthCallbackLeasesAcquireAndRelease(t *testing.T) {
	addr := reserveTCPAddr(t)
	leases := newOAuthCallbackLeases()
	redirectURI := "http://" + addr + "/auth/callback"

	if err := leases.Acquire(redirectURI, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})); err != nil {
		t.Fatalf("acquire: %v", err)
	}

	if _, err := net.Listen("tcp", addr); err == nil {
		t.Fatal("expected addr to be in use after acquire")
	}

	leases.Release(redirectURI)

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		ln, err := net.Listen("tcp", addr)
		if err == nil {
			_ = ln.Close()
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("expected addr %s to be released", addr)
}

func TestOAuthCallbackLeasesSkipPrimaryDaemonHost(t *testing.T) {
	leases := newOAuthCallbackLeases("127.0.0.1:7777", "http://localhost:7777")
	redirectURI := "http://localhost:7777/auth/callback"
	if err := leases.Acquire(redirectURI, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})); err != nil {
		t.Fatalf("acquire skipped host: %v", err)
	}
	if len(leases.listeners) != 0 {
		t.Fatalf("expected no dedicated listeners for skipped host, got %d", len(leases.listeners))
	}
}

func reserveTCPAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve addr: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	return addr
}
