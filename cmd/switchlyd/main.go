package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"switchly/internal/codexauth"
	"switchly/internal/core"
	"switchly/internal/oauth"
	"switchly/internal/secrets"
	"switchly/internal/server"
	"switchly/internal/store"
)

type daemonController struct {
	mu                sync.Mutex
	addr              string
	publicBaseURL     string
	defaultRestartCmd string
	httpServers       []*http.Server
	oauthCallbacks    *oauthCallbackLeases
	shuttingDown      bool
}

func newDaemonController(addr, publicBaseURL, restartCmd string, servers ...*http.Server) *daemonController {
	ctrl := &daemonController{
		addr:          addr,
		publicBaseURL: publicBaseURL,
		httpServers:   servers,
	}

	if strings.TrimSpace(restartCmd) != "" {
		ctrl.defaultRestartCmd = restartCmd
		return ctrl
	}

	exe, err := os.Executable()
	if err != nil {
		return ctrl
	}
	lowerExe := strings.ToLower(exe)
	if strings.Contains(lowerExe, "go-build") {
		// go run temp binaries are not stable restart targets.
		return ctrl
	}

	ctrl.defaultRestartCmd = fmt.Sprintf("\"%s\" --addr %s --public-base-url %s", exe, addr, publicBaseURL)
	return ctrl
}

func (d *daemonController) Info() server.DaemonInfo {
	d.mu.Lock()
	defer d.mu.Unlock()
	return server.DaemonInfo{
		PID:               os.Getpid(),
		Addr:              d.addr,
		PublicBaseURL:     d.publicBaseURL,
		RestartSupported:  d.defaultRestartCmd != "",
		DefaultRestartCmd: d.defaultRestartCmd,
	}
}

func (d *daemonController) Shutdown() error {
	d.mu.Lock()
	if d.shuttingDown {
		d.mu.Unlock()
		return nil
	}
	d.shuttingDown = true
	servers := append([]*http.Server(nil), d.httpServers...)
	callbacks := d.oauthCallbacks
	d.mu.Unlock()

	go func() {
		if callbacks != nil {
			callbacks.CloseAll()
		}
		time.Sleep(150 * time.Millisecond)
		for _, srv := range servers {
			if srv == nil {
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = srv.Shutdown(ctx)
			cancel()
		}
	}()
	return nil
}

func (d *daemonController) Restart(startCmd string) error {
	cmdStr := strings.TrimSpace(startCmd)
	if cmdStr == "" {
		d.mu.Lock()
		cmdStr = strings.TrimSpace(d.defaultRestartCmd)
		d.mu.Unlock()
	}
	if cmdStr == "" {
		return fmt.Errorf("restart command is empty; provide start_cmd or run switchlyd with --restart-cmd")
	}

	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("cmd", "/C", cmdStr)
	} else {
		cmd = exec.Command("sh", "-c", cmdStr)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start replacement daemon: %w", err)
	}

	return d.Shutdown()
}

func main() {
	addr := flag.String("addr", "127.0.0.1:7777", "listen address")
	publicBaseURL := flag.String("public-base-url", "http://localhost:7777", "public base URL used for OAuth callback")
	restartCmd := flag.String("restart-cmd", "", "command used by /v1/daemon/restart to spawn replacement daemon")
	flag.Parse()

	stateStore, err := store.NewStateStore()
	if err != nil {
		log.Fatalf("init state store: %v", err)
	}
	secretStore := secrets.NewDefaultStore()
	authApplier := codexauth.NewDefaultFileApplier()
	manager := core.NewManager(stateStore, secretStore, core.WithActiveAccountApplier(authApplier))
	oauthLeases := newOAuthCallbackLeases(*addr, *publicBaseURL)
	oauthService := oauth.NewService(manager, *publicBaseURL, oauth.WithCallbackLeaseManager(oauthLeases))

	httpServer := &http.Server{
		Addr:              *addr,
		ReadHeaderTimeout: 5 * time.Second,
	}

	daemonCtl := newDaemonController(*addr, *publicBaseURL, *restartCmd, httpServer)
	daemonCtl.oauthCallbacks = oauthLeases
	api := server.New(manager, oauthService, daemonCtl)
	httpServer.Handler = api.Handler()

	fmt.Printf("switchlyd listening on http://%s\n", *addr)
	fmt.Printf("state file: %s\n", stateStore.Path())
	if daemonCtl.defaultRestartCmd == "" {
		fmt.Println("daemon restart API: disabled (set --restart-cmd when running via go run)")
	}
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

type oauthCallbackLeases struct {
	mu        sync.Mutex
	listeners map[string]*oauthCallbackLease
	skipHosts map[string]struct{}
}

type oauthCallbackLease struct {
	server   *http.Server
	listener net.Listener
	path     string
	refCount int
}

func newOAuthCallbackLeases(hostsToSkip ...string) *oauthCallbackLeases {
	skipHosts := map[string]struct{}{}
	for _, raw := range hostsToSkip {
		host := normalizeHost(raw)
		if host != "" {
			skipHosts[host] = struct{}{}
		}
	}
	return &oauthCallbackLeases{
		listeners: map[string]*oauthCallbackLease{},
		skipHosts: skipHosts,
	}
}

func (m *oauthCallbackLeases) Acquire(redirectURI string, handler http.Handler) error {
	host, path, err := parseRedirectBinding(redirectURI)
	if err != nil {
		return err
	}
	if _, skip := m.skipHosts[host]; skip {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if lease, ok := m.listeners[host]; ok {
		if lease.path != path {
			return fmt.Errorf("oauth callback listener for %s already reserved on %s", host, lease.path)
		}
		lease.refCount++
		return nil
	}

	listener, err := net.Listen("tcp", host)
	if err != nil {
		return fmt.Errorf("oauth callback port %s is already in use", host)
	}
	mux := http.NewServeMux()
	mux.Handle(path, handler)
	server := &http.Server{
		Addr:              host,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	m.listeners[host] = &oauthCallbackLease{
		server:   server,
		listener: listener,
		path:     path,
		refCount: 1,
	}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Printf("oauth callback server error on %s: %v", host, err)
		}
	}()
	return nil
}

func (m *oauthCallbackLeases) Release(redirectURI string) {
	host, _, err := parseRedirectBinding(redirectURI)
	if err != nil {
		return
	}
	if _, skip := m.skipHosts[host]; skip {
		return
	}

	var server *http.Server
	m.mu.Lock()
	lease, ok := m.listeners[host]
	if !ok {
		m.mu.Unlock()
		return
	}
	lease.refCount--
	if lease.refCount > 0 {
		m.mu.Unlock()
		return
	}
	server = lease.server
	delete(m.listeners, host)
	m.mu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
}

func (m *oauthCallbackLeases) CloseAll() {
	m.mu.Lock()
	servers := make([]*http.Server, 0, len(m.listeners))
	for host, lease := range m.listeners {
		servers = append(servers, lease.server)
		delete(m.listeners, host)
	}
	m.mu.Unlock()

	for _, server := range servers {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = server.Shutdown(ctx)
		cancel()
	}
}

func normalizeHost(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if strings.Contains(trimmed, "://") {
		u, err := url.Parse(trimmed)
		if err == nil {
			return u.Host
		}
	}
	return trimmed
}

func parseRedirectBinding(raw string) (string, string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", "", fmt.Errorf("invalid oauth redirect uri %q: %w", raw, err)
	}
	host := strings.TrimSpace(u.Host)
	if host == "" {
		return "", "", fmt.Errorf("oauth redirect uri missing host: %q", raw)
	}
	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}
	return host, path, nil
}
