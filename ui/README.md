# Switchly Desktop UI (Tauri + React)

This directory contains the desktop UI for Switchly.

## What it includes

- Dashboard + accounts + OAuth + daemon panels
- Cross-platform tray/menu bar (Windows tray, macOS menu bar, Linux appindicator/tray)
- Account quota sync from OpenAI usage API (`POST /v1/quota/sync`, `POST /v1/quota/sync-all`)
- Quota refresh modes: manual button, periodic auto-refresh, and event-trigger refresh (OAuth success / account switch / daemon start-restart)
- Direct calls to `switchlyd` HTTP APIs (`/v1/status`, `/v1/accounts/*`, `/v1/oauth/*`, `/v1/daemon/*`)
- Tauri commands to run daemon lifecycle via CLI:
  - `go run ./cmd/switchly daemon start|stop|restart`
  - fallback to `switchly daemon ...` if `go` is unavailable

## Run (web-only UI)

```bash
cd ui
pnpm install
pnpm dev
```

## Run (desktop app)

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
pnpm tauri dev
```

## Notes

- Base URL is configurable in the top bar (default: `http://127.0.0.1:7777`).
- OAuth uses browser flow and polls `/v1/oauth/status`.
- Tray/menu bar shows all accounts with session + weekly remaining quota and uses native checkmark for the active account.
- Tray/menu bar includes daemon controls, account switch, strategy switch, open dashboard, launch-at-login toggle, and quit.
- Closing main window hides to tray/menu bar; use tray `Quit` to fully exit.
- Daemon stop/restart uses the daemon API first on every platform; CLI local-kill fallback is currently Windows-only.
- If `cargo check` fails with `edition2024 is required`, your Rust/Cargo toolchain is too old for the currently resolved Tauri dependency graph. Upgrade Rust toolchain first.
