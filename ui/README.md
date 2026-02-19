# Switchly Desktop UI (Tauri + React)

This directory contains the first desktop UI shell for Switchly.

## What it includes

- Dashboard + accounts + OAuth + daemon panels
- Account quota sync from OpenAI usage API (`POST /v1/quota/sync`)
- Quota refresh modes: manual button, periodic auto-refresh, and event-trigger refresh (OAuth success / account switch / daemon start-restart)
- Direct calls to `switchlyd` HTTP APIs (`/v1/status`, `/v1/accounts/*`, `/v1/oauth/*`, `/v1/daemon/*`)
- Tauri commands to run daemon lifecycle via CLI:
  - `go run ./cmd/switchly daemon start|stop|restart`
  - fallback to `switchly daemon ...` if `go` is unavailable

## Run (web-only UI)

```powershell
cd ui
pnpm install
pnpm dev
```

## Run (desktop app)

```powershell
cd ui
pnpm tauri dev
```

## Notes

- Base URL is configurable in the top bar (default: `http://127.0.0.1:7777`).
- OAuth uses browser flow and polls `/v1/oauth/status`.
- If `cargo check` fails with `edition2024 is required`, your Rust/Cargo toolchain is too old for the currently resolved Tauri dependency graph. Upgrade Rust toolchain first.
