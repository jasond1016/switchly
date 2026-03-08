# switchly

Switchly is a local account switcher for AI subscriptions.

Current MVP scope:
- Multi-account storage (Codex-first)
- Manual active account switch
- Automatic switch decision on quota/rate-limit errors
- Cross-platform desktop UI and tray/menu bar control
- Windows DPAPI-encrypted local secret storage, file-backed secret storage on macOS/Linux
- CLI + daemon architecture

## Binaries

- `switchlyd`: local daemon (`http://127.0.0.1:7777` by default)
- `switchly`: CLI client
- `ui/`: Tauri desktop UI (React + TypeScript)

## Quick start

```bash
# 1) start daemon
go run ./cmd/switchlyd --addr 127.0.0.1:7777 --public-base-url http://localhost:7777

# 2) add account A
switchly account add --id A --provider codex --email a@example.com --access-token <ACCESS_A> --refresh-token <REFRESH_A>

# 3) add account B
switchly account add --id B --provider codex --email b@example.com --access-token <ACCESS_B> --refresh-token <REFRESH_B>

# 4) set active
switchly account use --id A

# 5) simulate quota error and auto-switch
switchly switch simulate-error --status 429 --message "quota exceeded"

# 6) inspect status
switchly status

# 7) (recommended) OAuth login flow
switchly oauth login --provider codex
```

## Commands

```text
switchly status
switchly account add --id <id> --provider codex --access-token <token> [--refresh-token <token>] [--email <email>]
switchly account list
switchly account use --id <id>
switchly account apply [--id <id>]
switchly account import-codex [--overwrite-existing=true]
switchly quota sync [--id <id>]
switchly quota sync-all
switchly strategy set --value round-robin|fill-first
switchly switch simulate-error --status 429 --message "quota exceeded"
switchly oauth providers
switchly oauth start --provider codex
switchly oauth status --state <state>
switchly oauth login --provider codex
switchly oauth login --provider codex --method device
switchly daemon info
switchly daemon stop
switchly daemon start
switchly daemon restart
```

## Desktop UI (Tauri)

### Prerequisites

- All platforms:
  - Rust toolchain
  - Node.js + `pnpm`
- Linux (Debian/Ubuntu/Mint):

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

- macOS:
  - Xcode Command Line Tools
- Windows:
  - Microsoft Visual Studio C++ Build Tools
  - WebView2 Runtime

### Run

```bash
cd ui
pnpm install
pnpm tauri dev
```

### Tray / Menu Bar

- Cross-platform implementation:
  - Windows: system tray menu
  - macOS: menu bar extra
  - Linux: appindicator/tray menu (desktop environment dependent)
- Expanded tray menu shows all accounts with session+weekly remaining quota and uses native checkmark for the active account.
- Tray menu supports:
  - daemon status + start/stop/restart
  - account quick switch
  - routing mode switch (`fill-first` / `round-robin`)
  - open dashboard
  - launch-at-login toggle
  - quit app
- Closing the dashboard window hides it to tray/menu bar; use tray `Quit` to fully exit.

## Data locations

- Config dir:
  - Windows: `%APPDATA%\\Switchly`
  - macOS: `~/Library/Application Support/Switchly`
  - Linux: `${XDG_CONFIG_HOME:-~/.config}/Switchly`
- State file: `<config-dir>/accounts.json`
- Secrets on Windows: `<config-dir>/secrets/*.bin` (DPAPI encrypted)
- Secrets on macOS/Linux: `<config-dir>/secrets/*.json` (permission-restricted local files)

## Notes

- OAuth browser login flow is implemented for Codex (`/v1/oauth/start`, `/v1/oauth/callback`, `/v1/oauth/status`).
- If your Windows blocks localhost callback port `1455`, use device auth: `switchly oauth login --provider codex --method device`.
- `codex` refresh flow is implemented using `https://auth.openai.com/oauth/token`.
- `account use` and automatic quota-based switching will apply the selected Codex account tokens to `~/.codex/auth.json`.
- `account apply` can be used to force re-apply the active account (or a specific account with `--id`).
- `account import-codex` imports the currently logged-in Codex CLI account from `~/.codex/auth.json`.
- Daemon API includes `/v1/daemon/info`, `/v1/daemon/shutdown`, `/v1/daemon/restart`.
- `switchly daemon stop` and `switchly daemon restart` use the daemon API first on every platform; the local process-kill fallback is currently Windows-only.
- For `go run`, daemon API restart may be unavailable unless `switchlyd` is started with `--restart-cmd`.
