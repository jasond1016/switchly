package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const defaultBaseURL = "http://127.0.0.1:7777"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	baseURL := os.Getenv("SWITCHLY_BASE_URL")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	client := &apiClient{baseURL: baseURL, http: &http.Client{Timeout: 15 * time.Second}}

	switch os.Args[1] {
	case "status":
		must(runStatus(client))
	case "account":
		must(runAccount(client, os.Args[2:]))
	case "quota":
		must(runQuota(client, os.Args[2:]))
	case "switch":
		must(runSwitch(client, os.Args[2:]))
	case "strategy":
		must(runStrategy(client, os.Args[2:]))
	case "oauth":
		must(runOAuth(client, os.Args[2:]))
	case "daemon":
		must(runDaemon(client, os.Args[2:]))
	default:
		printUsage()
		os.Exit(1)
	}
}

func runStatus(c *apiClient) error {
	var out map[string]interface{}
	if err := c.get("/v1/status", &out); err != nil {
		return err
	}
	return printJSON(out)
}

func runAccount(c *apiClient, args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("missing account command")
	}

	switch args[0] {
	case "add":
		fs := flag.NewFlagSet("account add", flag.ContinueOnError)
		var (
			id            = fs.String("id", "", "account id")
			provider      = fs.String("provider", "codex", "provider name")
			email         = fs.String("email", "", "account email")
			accessToken   = fs.String("access-token", "", "oauth access token")
			refreshToken  = fs.String("refresh-token", "", "oauth refresh token")
			idToken       = fs.String("id-token", "", "oauth id token")
			accountID     = fs.String("account-id", "", "provider account id")
			accessExpiry  = fs.String("access-expiry", "", "RFC3339")
			refreshExpiry = fs.String("refresh-expiry", "", "RFC3339")
		)
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if strings.TrimSpace(*id) == "" {
			return fmt.Errorf("--id is required")
		}
		if strings.TrimSpace(*accessToken) == "" {
			return fmt.Errorf("--access-token is required")
		}

		payload := map[string]string{
			"id":                 *id,
			"provider":           *provider,
			"email":              *email,
			"access_token":       *accessToken,
			"refresh_token":      *refreshToken,
			"id_token":           *idToken,
			"account_id":         *accountID,
			"access_expires_at":  *accessExpiry,
			"refresh_expires_at": *refreshExpiry,
		}
		var out map[string]interface{}
		if err := c.post("/v1/accounts", payload, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "list":
		var out map[string]interface{}
		if err := c.get("/v1/accounts", &out); err != nil {
			return err
		}
		return printJSON(out)
	case "use":
		fs := flag.NewFlagSet("account use", flag.ContinueOnError)
		id := fs.String("id", "", "account id")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *id == "" {
			return fmt.Errorf("--id is required")
		}
		var out map[string]interface{}
		if err := c.post(fmt.Sprintf("/v1/accounts/%s/activate", *id), map[string]string{}, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "apply":
		fs := flag.NewFlagSet("account apply", flag.ContinueOnError)
		id := fs.String("id", "", "account id (default: current active account)")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		targetID := strings.TrimSpace(*id)
		if targetID == "" {
			var status struct {
				ActiveAccountID string `json:"active_account_id"`
			}
			if err := c.get("/v1/status", &status); err != nil {
				return err
			}
			targetID = strings.TrimSpace(status.ActiveAccountID)
			if targetID == "" {
				return fmt.Errorf("no active account configured; pass --id explicitly")
			}
		}
		var out map[string]interface{}
		if err := c.post(fmt.Sprintf("/v1/accounts/%s/activate", targetID), map[string]string{}, &out); err != nil {
			return err
		}
		return printJSON(map[string]interface{}{
			"status":     "ok",
			"account_id": targetID,
			"action":     "applied",
		})
	default:
		return fmt.Errorf("unknown account command: %s", args[0])
	}
}

func runSwitch(c *apiClient, args []string) error {
	if len(args) < 1 || args[0] != "simulate-error" {
		return fmt.Errorf("usage: switchly switch simulate-error --status 429 --message \"quota exceeded\"")
	}
	fs := flag.NewFlagSet("switch simulate-error", flag.ContinueOnError)
	status := fs.Int("status", 429, "upstream status code")
	message := fs.String("message", "quota exceeded", "upstream error message")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}

	payload := map[string]interface{}{"status_code": *status, "error_message": *message}
	var out map[string]interface{}
	if err := c.post("/v1/switch/on-error", payload, &out); err != nil {
		return err
	}
	return printJSON(out)
}

func runQuota(c *apiClient, args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("missing quota command")
	}

	switch args[0] {
	case "sync":
		fs := flag.NewFlagSet("quota sync", flag.ContinueOnError)
		accountID := fs.String("id", "", "account id (default: active account)")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		payload := map[string]string{}
		if strings.TrimSpace(*accountID) != "" {
			payload["account_id"] = strings.TrimSpace(*accountID)
		}
		var out map[string]interface{}
		if err := c.post("/v1/quota/sync", payload, &out); err != nil {
			return err
		}
		return printJSON(out)
	case "sync-all":
		var out map[string]interface{}
		if err := c.post("/v1/quota/sync-all", map[string]string{}, &out); err != nil {
			return err
		}
		return printJSON(out)
	default:
		return fmt.Errorf("unknown quota command: %s", args[0])
	}
}

func runStrategy(c *apiClient, args []string) error {
	if len(args) < 1 || args[0] != "set" {
		return fmt.Errorf("usage: switchly strategy set --value round-robin|fill-first")
	}
	fs := flag.NewFlagSet("strategy set", flag.ContinueOnError)
	value := fs.String("value", "round-robin", "routing strategy")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	var out map[string]interface{}
	if err := c.patch("/v1/strategy", map[string]string{"strategy": *value}, &out); err != nil {
		return err
	}
	return printJSON(out)
}

type oauthSession struct {
	State     string `json:"state"`
	Provider  string `json:"provider"`
	Status    string `json:"status"`
	AuthURL   string `json:"auth_url"`
	AccountID string `json:"account_id"`
	Error     string `json:"error"`
	ExpiresAt string `json:"expires_at"`
}

func runOAuth(c *apiClient, args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("missing oauth command")
	}

	switch args[0] {
	case "providers":
		var out map[string]interface{}
		if err := c.get("/v1/oauth/providers", &out); err != nil {
			return err
		}
		return printJSON(out)
	case "start":
		fs := flag.NewFlagSet("oauth start", flag.ContinueOnError)
		provider := fs.String("provider", "codex", "provider name")
		openBrowserFlag := fs.Bool("open", true, "open browser automatically")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}

		var sess oauthSession
		if err := c.post("/v1/oauth/start", map[string]string{"provider": *provider}, &sess); err != nil {
			return err
		}
		if *openBrowserFlag {
			_ = openBrowser(sess.AuthURL)
		}
		return printJSON(sess)
	case "status":
		fs := flag.NewFlagSet("oauth status", flag.ContinueOnError)
		state := fs.String("state", "", "oauth state")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if strings.TrimSpace(*state) == "" {
			return fmt.Errorf("--state is required")
		}
		var sess oauthSession
		if err := c.get("/v1/oauth/status?state="+*state, &sess); err != nil {
			return err
		}
		return printJSON(sess)
	case "login":
		fs := flag.NewFlagSet("oauth login", flag.ContinueOnError)
		provider := fs.String("provider", "codex", "provider name")
		method := fs.String("method", "browser", "login method: browser|device")
		openBrowserFlag := fs.Bool("open", true, "open browser automatically")
		timeout := fs.Duration("timeout", 3*time.Minute, "overall timeout")
		interval := fs.Duration("poll-interval", 2*time.Second, "poll interval")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if strings.EqualFold(*method, "device") {
			return runOAuthLoginDevice(c, *provider)
		}

		var sess oauthSession
		if err := c.post("/v1/oauth/start", map[string]string{"provider": *provider}, &sess); err != nil {
			return err
		}
		if *openBrowserFlag {
			if err := openBrowser(sess.AuthURL); err != nil {
				fmt.Fprintf(os.Stderr, "warning: failed to open browser, open manually: %s\n", sess.AuthURL)
			}
		} else {
			fmt.Printf("Open this URL to continue login:\n%s\n", sess.AuthURL)
		}

		deadline := time.Now().Add(*timeout)
		for time.Now().Before(deadline) {
			time.Sleep(*interval)
			if err := c.get("/v1/oauth/status?state="+sess.State, &sess); err != nil {
				return err
			}
			switch sess.Status {
			case "success":
				return printJSON(sess)
			case "error", "expired":
				return fmt.Errorf("oauth %s: %s", sess.Status, sess.Error)
			}
		}
		return fmt.Errorf("oauth login timeout after %s", timeout.String())
	default:
		return fmt.Errorf("unknown oauth command: %s", args[0])
	}
}

type codexAuthFile struct {
	Tokens struct {
		IDToken      string `json:"id_token"`
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		AccountID    string `json:"account_id"`
	} `json:"tokens"`
}

func runOAuthLoginDevice(c *apiClient, provider string) error {
	if !strings.EqualFold(provider, "codex") {
		return fmt.Errorf("device method is currently supported only for provider=codex")
	}

	cmd := exec.Command("codex", "login", "--device-auth")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("codex device auth failed: %w", err)
	}

	auth, err := readCodexAuthFile()
	if err != nil {
		return fmt.Errorf("read ~/.codex/auth.json failed: %w", err)
	}
	if strings.TrimSpace(auth.Tokens.AccessToken) == "" {
		return fmt.Errorf("codex auth file does not contain access_token")
	}

	email, tokenAccountID := decodeEmailAndAccountID(auth.Tokens.IDToken)
	accountID := buildCodexAccountID(email, firstNonEmpty(auth.Tokens.AccountID, tokenAccountID))

	payload := map[string]string{
		"id":            accountID,
		"provider":      "codex",
		"email":         email,
		"access_token":  auth.Tokens.AccessToken,
		"refresh_token": auth.Tokens.RefreshToken,
		"id_token":      auth.Tokens.IDToken,
		"account_id":    firstNonEmpty(auth.Tokens.AccountID, tokenAccountID),
	}

	var out map[string]interface{}
	if err := c.post("/v1/accounts", payload, &out); err != nil {
		return err
	}
	return printJSON(map[string]interface{}{
		"status":  "ok",
		"method":  "device",
		"account": out,
	})
}

func readCodexAuthFile() (codexAuthFile, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return codexAuthFile{}, err
	}
	path := home + `\.codex\auth.json`
	data, err := os.ReadFile(path)
	if err != nil {
		return codexAuthFile{}, err
	}
	var out codexAuthFile
	if err := json.Unmarshal(data, &out); err != nil {
		return codexAuthFile{}, err
	}
	return out, nil
}

func decodeEmailAndAccountID(idToken string) (email, accountID string) {
	if strings.TrimSpace(idToken) == "" {
		return "", ""
	}
	parts := strings.Split(idToken, ".")
	if len(parts) < 2 {
		return "", ""
	}
	payload := parts[1]
	payload = strings.ReplaceAll(payload, "-", "+")
	payload = strings.ReplaceAll(payload, "_", "/")
	if mod := len(payload) % 4; mod != 0 {
		payload += strings.Repeat("=", 4-mod)
	}
	b, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", ""
	}
	var claims map[string]interface{}
	if err := json.Unmarshal(b, &claims); err != nil {
		return "", ""
	}
	if v, ok := claims["email"].(string); ok {
		email = strings.TrimSpace(v)
	}
	if nested, ok := claims["https://api.openai.com/auth"].(map[string]interface{}); ok {
		if v, ok := nested["chatgpt_account_id"].(string); ok {
			accountID = strings.TrimSpace(v)
		}
	}
	return email, accountID
}

func buildCodexAccountID(email, accountID string) string {
	if strings.TrimSpace(email) != "" {
		return "codex:" + strings.ToLower(strings.TrimSpace(email))
	}
	if strings.TrimSpace(accountID) != "" {
		return "codex:" + strings.TrimSpace(accountID)
	}
	return "codex:" + time.Now().UTC().Format("20060102150405")
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func runDaemon(c *apiClient, args []string) error {
	if len(args) < 1 {
		return fmt.Errorf("missing daemon command")
	}

	defaultAddr := hostPortFromBaseURL(c.baseURL)
	defaultPublicBase := publicBaseURLForAddr(defaultAddr)

	switch args[0] {
	case "info":
		var out map[string]interface{}
		if err := c.get("/v1/daemon/info", &out); err != nil {
			return err
		}
		return printJSON(out)
	case "stop":
		fs := flag.NewFlagSet("daemon stop", flag.ContinueOnError)
		addr := fs.String("addr", defaultAddr, "daemon address")
		viaAPI := fs.Bool("via-api", true, "use daemon API first, then fallback to local kill")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *viaAPI {
			var out map[string]interface{}
			if err := c.post("/v1/daemon/shutdown", map[string]string{}, &out); err == nil {
				out["mode"] = "api"
				return printJSON(out)
			}
		}
		port, err := portFromAddr(*addr)
		if err != nil {
			return err
		}
		killed, err := stopDaemonByPort(port)
		if err != nil {
			return err
		}
		return printJSON(map[string]interface{}{
			"status":      "stopped",
			"addr":        *addr,
			"port":        port,
			"mode":        "local-kill",
			"killed_pids": killed,
		})
	case "start":
		fs := flag.NewFlagSet("daemon start", flag.ContinueOnError)
		addr := fs.String("addr", defaultAddr, "daemon address")
		publicBaseURL := fs.String("public-base-url", defaultPublicBase, "oauth public base url")
		startCmd := fs.String("start-cmd", "", "custom start command; default uses go run ./cmd/switchlyd")
		wait := fs.Duration("wait", 8*time.Second, "health-check timeout")
		skipHealth := fs.Bool("skip-health-check", false, "skip /v1/health polling")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if err := startDaemonProcess(*startCmd, *addr, *publicBaseURL); err != nil {
			return err
		}
		if !*skipHealth {
			if err := waitForHealth(*addr, *wait); err != nil {
				return err
			}
		}
		return printJSON(map[string]interface{}{
			"status":          "started",
			"addr":            *addr,
			"public_base_url": *publicBaseURL,
		})
	case "restart":
		fs := flag.NewFlagSet("daemon restart", flag.ContinueOnError)
		addr := fs.String("addr", defaultAddr, "daemon address")
		publicBaseURL := fs.String("public-base-url", defaultPublicBase, "oauth public base url")
		startCmd := fs.String("start-cmd", "", "custom start command; default uses go run ./cmd/switchlyd")
		wait := fs.Duration("wait", 10*time.Second, "health-check timeout")
		viaAPI := fs.Bool("via-api", true, "use daemon API first, then fallback to local restart")
		skipHealth := fs.Bool("skip-health-check", false, "skip /v1/health polling")
		if err := fs.Parse(args[1:]); err != nil {
			return err
		}
		if *viaAPI {
			payload := map[string]string{"start_cmd": strings.TrimSpace(*startCmd)}
			var out map[string]interface{}
			if err := c.post("/v1/daemon/restart", payload, &out); err == nil {
				if !*skipHealth {
					if err := waitForHealth(*addr, *wait); err != nil {
						return err
					}
				}
				out["mode"] = "api"
				return printJSON(out)
			}
		}
		port, err := portFromAddr(*addr)
		if err != nil {
			return err
		}
		killed, err := stopDaemonByPort(port)
		if err != nil {
			return err
		}
		if err := startDaemonProcess(*startCmd, *addr, *publicBaseURL); err != nil {
			return err
		}
		if !*skipHealth {
			if err := waitForHealth(*addr, *wait); err != nil {
				return err
			}
		}
		return printJSON(map[string]interface{}{
			"status":          "restarted",
			"addr":            *addr,
			"public_base_url": *publicBaseURL,
			"mode":            "local-kill",
			"killed_pids":     killed,
		})
	default:
		return fmt.Errorf("unknown daemon command: %s", args[0])
	}
}

func hostPortFromBaseURL(base string) string {
	u, err := url.Parse(base)
	if err != nil {
		return "127.0.0.1:7777"
	}
	host := u.Hostname()
	port := u.Port()
	if host == "" {
		host = "127.0.0.1"
	}
	if port == "" {
		port = "7777"
	}
	return host + ":" + port
}

func publicBaseURLForAddr(addr string) string {
	port, err := portFromAddr(addr)
	if err != nil {
		return "http://localhost:7777"
	}
	return "http://localhost:" + strconv.Itoa(port)
}

func portFromAddr(addr string) (int, error) {
	idx := strings.LastIndex(addr, ":")
	if idx <= 0 || idx >= len(addr)-1 {
		return 0, fmt.Errorf("invalid addr: %s", addr)
	}
	port, err := strconv.Atoi(addr[idx+1:])
	if err != nil {
		return 0, fmt.Errorf("invalid addr port: %w", err)
	}
	return port, nil
}

func stopDaemonByPort(port int) ([]int, error) {
	if runtime.GOOS != "windows" {
		return nil, fmt.Errorf("daemon stop is currently implemented for windows only")
	}
	out, err := exec.Command("netstat", "-ano", "-p", "tcp").Output()
	if err != nil {
		return nil, fmt.Errorf("netstat failed: %w", err)
	}
	lines := strings.Split(string(out), "\n")
	wantSuffix := ":" + strconv.Itoa(port)
	pidSet := map[int]struct{}{}
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" || !strings.Contains(line, "LISTENING") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			continue
		}
		localAddr := fields[1]
		state := fields[3]
		if !strings.EqualFold(state, "LISTENING") {
			continue
		}
		if !strings.HasSuffix(localAddr, wantSuffix) {
			continue
		}
		pid, err := strconv.Atoi(fields[4])
		if err == nil {
			pidSet[pid] = struct{}{}
		}
	}
	pids := make([]int, 0, len(pidSet))
	for pid := range pidSet {
		pids = append(pids, pid)
	}
	if len(pids) == 0 {
		return pids, nil
	}
	for _, pid := range pids {
		cmd := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/F")
		if err := cmd.Run(); err != nil {
			return pids, fmt.Errorf("taskkill failed for pid %d: %w", pid, err)
		}
	}
	return pids, nil
}

func startDaemonProcess(startCmd, addr, publicBaseURL string) error {
	if strings.TrimSpace(startCmd) != "" {
		cmd := exec.Command("cmd", "/C", startCmd)
		return cmd.Start()
	}
	cmd := exec.Command("go", "run", "./cmd/switchlyd", "--addr", addr, "--public-base-url", publicBaseURL)
	return cmd.Start()
}

func waitForHealth(addr string, timeout time.Duration) error {
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	host := addr
	if strings.HasPrefix(host, "0.0.0.0:") || strings.HasPrefix(host, "[::]:") {
		_, p, _ := strings.Cut(host, ":")
		host = "127.0.0.1:" + p
	}
	healthURL := "http://" + host + "/v1/health"
	client := &http.Client{Timeout: 1200 * time.Millisecond}
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := client.Get(healthURL)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
			lastErr = fmt.Errorf("health returned status %d", resp.StatusCode)
		} else {
			lastErr = err
		}
		time.Sleep(400 * time.Millisecond)
	}
	return fmt.Errorf("daemon did not become healthy in %s: %v", timeout.String(), lastErr)
}

type apiClient struct {
	baseURL string
	http    *http.Client
}

func (c *apiClient) get(path string, out interface{}) error {
	return c.do(http.MethodGet, path, nil, out)
}

func (c *apiClient) post(path string, payload interface{}, out interface{}) error {
	return c.do(http.MethodPost, path, payload, out)
}

func (c *apiClient) patch(path string, payload interface{}, out interface{}) error {
	return c.do(http.MethodPatch, path, payload, out)
}

func (c *apiClient) do(method, path string, payload interface{}, out interface{}) error {
	var body io.Reader
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("http %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func printUsage() {
	fmt.Println("switchly commands:")
	fmt.Println("  status")
	fmt.Println("  account add --id <id> --provider codex --access-token <token> [--refresh-token <token>] [--email <email>]")
	fmt.Println("  account list")
	fmt.Println("  account use --id <id>")
	fmt.Println("  account apply [--id <id>]")
	fmt.Println("  quota sync [--id <id>]")
	fmt.Println("  quota sync-all")
	fmt.Println("  strategy set --value round-robin|fill-first")
	fmt.Println("  switch simulate-error --status 429 --message \"quota exceeded\"")
	fmt.Println("  oauth providers")
	fmt.Println("  oauth start --provider codex [--open=true]")
	fmt.Println("  oauth status --state <state>")
	fmt.Println("  oauth login --provider codex [--method browser|device] [--timeout=3m]")
	fmt.Println("  daemon info")
	fmt.Println("  daemon stop [--addr 127.0.0.1:7777] [--via-api=true]")
	fmt.Println("  daemon start [--addr 127.0.0.1:7777] [--public-base-url http://localhost:7777]")
	fmt.Println("  daemon restart [--addr 127.0.0.1:7777] [--public-base-url http://localhost:7777] [--via-api=true]")
}

func printJSON(v interface{}) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

func must(err error) {
	if err == nil {
		return
	}
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}

func openBrowser(link string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", link).Start()
	case "darwin":
		return exec.Command("open", link).Start()
	default:
		return exec.Command("xdg-open", link).Start()
	}
}
