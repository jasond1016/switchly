package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

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
	d.mu.Unlock()

	go func() {
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
	manager := core.NewManager(stateStore, secretStore)
	oauthService := oauth.NewService(manager, *publicBaseURL)

	httpServer := &http.Server{
		Addr:              *addr,
		ReadHeaderTimeout: 5 * time.Second,
	}
	callbackServers, err := buildOAuthCallbackServers(oauthService)
	if err != nil {
		log.Fatalf("init oauth callback listeners: %v", err)
	}

	daemonCtl := newDaemonController(*addr, *publicBaseURL, *restartCmd, append([]*http.Server{httpServer}, callbackServers...)...)
	api := server.New(manager, oauthService, daemonCtl)
	httpServer.Handler = api.Handler()

	fmt.Printf("switchlyd listening on http://%s\n", *addr)
	fmt.Printf("state file: %s\n", stateStore.Path())
	if daemonCtl.defaultRestartCmd == "" {
		fmt.Println("daemon restart API: disabled (set --restart-cmd when running via go run)")
	}
	for _, srv := range callbackServers {
		srv := srv
		go func() {
			if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Printf("oauth callback server error on %s: %v", srv.Addr, err)
			}
		}()
	}
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func buildOAuthCallbackServers(oauthService *oauth.Service) ([]*http.Server, error) {
	if oauthService == nil {
		return nil, nil
	}
	uris := oauthService.RedirectURIs()
	bindings := map[string]map[string]struct{}{}
	for _, raw := range uris {
		u, err := url.Parse(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid oauth redirect uri %q: %w", raw, err)
		}
		host := u.Host
		if host == "" {
			return nil, fmt.Errorf("oauth redirect uri missing host: %q", raw)
		}
		p := u.EscapedPath()
		if p == "" {
			p = "/"
		}
		if _, ok := bindings[host]; !ok {
			bindings[host] = map[string]struct{}{}
		}
		bindings[host][p] = struct{}{}
	}

	hosts := make([]string, 0, len(bindings))
	for h := range bindings {
		hosts = append(hosts, h)
	}
	sort.Strings(hosts)

	servers := make([]*http.Server, 0, len(hosts))
	for _, host := range hosts {
		paths := bindings[host]
		mux := http.NewServeMux()
		for p := range paths {
			mux.HandleFunc(p, oauthService.HandleCallback)
		}
		// Backward-compatible route.
		mux.HandleFunc("/v1/oauth/callback", oauthService.HandleCallback)

		servers = append(servers, &http.Server{
			Addr:              host,
			Handler:           mux,
			ReadHeaderTimeout: 5 * time.Second,
		})
	}
	return servers, nil
}
