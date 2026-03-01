use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::Emitter;
use tauri::{AppHandle, Manager, Runtime, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt;

const TRAY_ID: &str = "switchly-tray";
const MENU_OPEN_DASHBOARD: &str = "open_dashboard";
const MENU_REFRESH: &str = "refresh";
const MENU_DAEMON_START: &str = "daemon_start";
const MENU_DAEMON_STOP: &str = "daemon_stop";
const MENU_DAEMON_RESTART: &str = "daemon_restart";
const MENU_STRATEGY_FILL_FIRST: &str = "strategy_fill_first";
const MENU_STRATEGY_ROUND_ROBIN: &str = "strategy_round_robin";
const MENU_TOGGLE_AUTOSTART: &str = "toggle_autostart";
const MENU_QUIT: &str = "quit";
const MENU_ACCOUNT_PREFIX: &str = "account:";
const EVENT_DASHBOARD_REFRESH: &str = "switchly://dashboard-refresh";

#[tauri::command]
fn daemon_start(addr: String, public_base_url: String) -> Result<String, String> {
    run_switchly(&[
        "daemon",
        "start",
        "--addr",
        &addr,
        "--public-base-url",
        &public_base_url,
    ])
}

#[tauri::command]
fn daemon_stop(addr: String) -> Result<String, String> {
    run_switchly(&["daemon", "stop", "--addr", &addr])
}

#[tauri::command]
fn daemon_restart(addr: String, public_base_url: String) -> Result<String, String> {
    run_switchly(&[
        "daemon",
        "restart",
        "--addr",
        &addr,
        "--public-base-url",
        &public_base_url,
    ])
}

#[derive(Default)]
struct AppLifecycleState {
    quitting: AtomicBool,
}

#[derive(Debug, Clone, Deserialize)]
struct StatusSnapshot {
    active_account_id: Option<String>,
    strategy: RoutingStrategy,
    accounts: Vec<AccountSnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
struct AccountSnapshot {
    id: String,
    quota: QuotaSnapshot,
}

#[derive(Debug, Clone, Deserialize)]
struct QuotaSnapshot {
    session: QuotaWindow,
    weekly: QuotaWindow,
    session_supported: Option<bool>,
    limit_reached: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct QuotaWindow {
    used_percent: f64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum RoutingStrategy {
    RoundRobin,
    FillFirst,
}

impl RoutingStrategy {
    fn as_cli_value(&self) -> &'static str {
        match self {
            Self::RoundRobin => "round-robin",
            Self::FillFirst => "fill-first",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct DaemonInfo {
    pid: i64,
}

#[derive(Debug, Clone)]
struct TraySnapshot {
    status: Option<StatusSnapshot>,
    daemon: Option<DaemonInfo>,
    status_error: Option<String>,
    daemon_error: Option<String>,
}

fn run_switchly(args: &[&str]) -> Result<String, String> {
    if let Some(root) = find_repo_root() {
        let mut cmd = Command::new("go");
        cmd.current_dir(root)
            .arg("run")
            .arg("./cmd/switchly")
            .args(args);
        if let Some(out) = run_command(cmd)? {
            return Ok(out);
        }
    }

    let mut fallback = Command::new("switchly");
    fallback.args(args);
    let output = fallback
        .output()
        .map_err(|e| format!("failed to run switchly: {e}"))?;
    collect_output(output.status.success(), &output.stdout, &output.stderr)
}

fn run_switchly_json<T: for<'de> Deserialize<'de>>(args: &[&str]) -> Result<T, String> {
    let raw = run_switchly(args)?;
    serde_json::from_str::<T>(&raw)
        .map_err(|e| format!("failed to parse command JSON output: {e}; output: {raw}"))
}

fn pull_tray_snapshot() -> TraySnapshot {
    let status = run_switchly_json::<StatusSnapshot>(&["status"]);
    let daemon = run_switchly_json::<DaemonInfo>(&["daemon", "info"]);

    TraySnapshot {
        status: status.as_ref().ok().cloned(),
        daemon: daemon.as_ref().ok().cloned(),
        status_error: status.err(),
        daemon_error: daemon.err(),
    }
}

fn fmt_pct(value: f64) -> u8 {
    if !value.is_finite() {
        return 0;
    }
    value.round().clamp(0.0, 100.0) as u8
}

fn remaining_pct(used_percent: f64) -> u8 {
    100u8.saturating_sub(fmt_pct(used_percent))
}

fn account_menu_label(account: &AccountSnapshot) -> String {
    let limit = if account.quota.limit_reached {
        " !"
    } else {
        ""
    };
    let session_label = if account.quota.session_supported == Some(false) {
        "N/A".to_string()
    } else {
        format!("{}%", remaining_pct(account.quota.session.used_percent))
    };
    format!(
        "{} | S:{} W:{}%{}",
        account.id,
        session_label,
        remaining_pct(account.quota.weekly.used_percent),
        limit
    )
}

fn strategy_menu_label(strategy: Option<&RoutingStrategy>) -> String {
    match strategy {
        Some(value) => format!("Current mode: {}", value.as_cli_value()),
        None => "Current mode: unknown".to_string(),
    }
}

fn autostart_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

fn daemon_running(snapshot: &TraySnapshot) -> bool {
    snapshot.daemon.as_ref().map(|x| x.pid > 0).unwrap_or(false)
}

fn refresh_tray_menu<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let snapshot = pull_tray_snapshot();
    let autostart = autostart_enabled(app);

    let mut builder = MenuBuilder::new(app);
    builder = builder
        .item(
            &MenuItemBuilder::with_id(MENU_OPEN_DASHBOARD, "Open Dashboard")
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_REFRESH, "Refresh Now")
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new(if daemon_running(&snapshot) {
                "Daemon: running"
            } else {
                "Daemon: stopped"
            })
            .enabled(false)
            .build(app)
            .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_DAEMON_START, "Start Daemon")
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_DAEMON_STOP, "Stop Daemon")
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_DAEMON_RESTART, "Restart Daemon")
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .separator();

    let strategy = snapshot.status.as_ref().map(|s| &s.strategy);
    builder = builder
        .item(
            &MenuItemBuilder::new(strategy_menu_label(strategy))
                .enabled(false)
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &CheckMenuItemBuilder::with_id(MENU_STRATEGY_FILL_FIRST, "Fill First")
                .checked(strategy == Some(&RoutingStrategy::FillFirst))
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &CheckMenuItemBuilder::with_id(MENU_STRATEGY_ROUND_ROBIN, "Round Robin")
                .checked(strategy == Some(&RoutingStrategy::RoundRobin))
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .separator()
        .item(
            &MenuItemBuilder::new("Accounts (session + weekly remaining)")
                .enabled(false)
                .build(app)
                .map_err(|e| e.to_string())?,
        );

    if let Some(status) = &snapshot.status {
        if status.accounts.is_empty() {
            builder = builder.item(
                &MenuItemBuilder::new("  No accounts")
                    .enabled(false)
                    .build(app)
                    .map_err(|e| e.to_string())?,
            );
        } else {
            for account in &status.accounts {
                let id = format!("{MENU_ACCOUNT_PREFIX}{}", account.id);
                let active = status.active_account_id.as_deref() == Some(account.id.as_str());
                builder = builder.item(
                    &CheckMenuItemBuilder::with_id(id, account_menu_label(account))
                        .checked(active)
                        .build(app)
                        .map_err(|e| e.to_string())?,
                );
            }
        }
    } else {
        builder = builder.item(
            &MenuItemBuilder::new("  Status unavailable")
                .enabled(false)
                .build(app)
                .map_err(|e| e.to_string())?,
        );
    }

    if let Some(err) = &snapshot.status_error {
        builder = builder.item(
            &MenuItemBuilder::new(format!("  status error: {}", shorten_error(err)))
                .enabled(false)
                .build(app)
                .map_err(|e| e.to_string())?,
        );
    }
    if let Some(err) = &snapshot.daemon_error {
        builder = builder.item(
            &MenuItemBuilder::new(format!("  daemon error: {}", shorten_error(err)))
                .enabled(false)
                .build(app)
                .map_err(|e| e.to_string())?,
        );
    }

    builder = builder
        .separator()
        .item(
            &CheckMenuItemBuilder::with_id(MENU_TOGGLE_AUTOSTART, "Launch at Login")
                .checked(autostart)
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .item(
            &MenuItemBuilder::with_id(MENU_QUIT, "Quit")
                .build(app)
                .map_err(|e| e.to_string())?,
        );

    let menu = builder.build().map_err(|e| e.to_string())?;
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray icon not initialized".to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())
}

fn shorten_error(message: &str) -> String {
    const MAX_LEN: usize = 48;
    let mut trimmed = message.trim().replace('\n', " ");
    if trimmed.len() <= MAX_LEN {
        return trimmed;
    }
    trimmed.truncate(MAX_LEN);
    format!("{trimmed}...")
}

fn show_dashboard<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn tray_event_requires_dashboard_refresh(event_id: &str) -> bool {
    matches!(
        event_id,
        MENU_REFRESH
            | MENU_DAEMON_START
            | MENU_DAEMON_STOP
            | MENU_DAEMON_RESTART
            | MENU_STRATEGY_FILL_FIRST
            | MENU_STRATEGY_ROUND_ROBIN
            | MENU_TOGGLE_AUTOSTART
    ) || event_id.starts_with(MENU_ACCOUNT_PREFIX)
}

fn emit_dashboard_refresh<R: Runtime>(app: &AppHandle<R>) {
    if let Err(err) = app.emit(EVENT_DASHBOARD_REFRESH, ()) {
        eprintln!("emit dashboard refresh event failed: {err}");
    }
}

fn handle_tray_menu_event<R: Runtime>(app: &AppHandle<R>, event_id: &str) {
    let should_refresh_dashboard = tray_event_requires_dashboard_refresh(event_id);
    let result = if event_id == MENU_OPEN_DASHBOARD {
        show_dashboard(app);
        Ok("ok".to_string())
    } else if event_id == MENU_REFRESH {
        Ok("ok".to_string())
    } else if event_id == MENU_DAEMON_START {
        run_switchly(&["daemon", "start"])
    } else if event_id == MENU_DAEMON_STOP {
        run_switchly(&["daemon", "stop"])
    } else if event_id == MENU_DAEMON_RESTART {
        run_switchly(&["daemon", "restart"])
    } else if event_id == MENU_STRATEGY_FILL_FIRST {
        run_switchly(&["strategy", "set", "--value", "fill-first"])
    } else if event_id == MENU_STRATEGY_ROUND_ROBIN {
        run_switchly(&["strategy", "set", "--value", "round-robin"])
    } else if event_id == MENU_TOGGLE_AUTOSTART {
        toggle_autostart(app).map(|_| "ok".to_string())
    } else if event_id == MENU_QUIT {
        if let Some(state) = app.try_state::<AppLifecycleState>() {
            state.quitting.store(true, Ordering::Relaxed);
        }
        app.exit(0);
        return;
    } else if let Some(account_id) = event_id.strip_prefix(MENU_ACCOUNT_PREFIX) {
        run_switchly(&["account", "use", "--id", account_id])
    } else {
        Ok("ok".to_string())
    };

    if let Err(err) = result {
        eprintln!("tray action `{event_id}` failed: {err}");
    } else if should_refresh_dashboard {
        emit_dashboard_refresh(app);
    }
    if let Err(err) = refresh_tray_menu(app) {
        eprintln!("refresh tray menu failed: {err}");
    }
}

fn toggle_autostart<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    let enabled = autolaunch.is_enabled().map_err(|e| e.to_string())?;
    if enabled {
        autolaunch.disable().map_err(|e| e.to_string())?;
    } else {
        autolaunch.enable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let initial_menu = MenuBuilder::new(app)
        .item(
            &MenuItemBuilder::new("Loading Switchly tray...")
                .enabled(false)
                .build(app)
                .map_err(|e| e.to_string())?,
        )
        .build()
        .map_err(|e| e.to_string())?;

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID).menu(&initial_menu);
    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }
    tray_builder
        .on_menu_event(|app, event| handle_tray_menu_event(app, event.id().as_ref()))
        .build(app)
        .map_err(|e| e.to_string())?;

    refresh_tray_menu(app)?;

    let app_handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        if let Err(err) = refresh_tray_menu(&app_handle) {
            eprintln!("background tray refresh failed: {err}");
        }
    });

    Ok(())
}

fn should_close_window<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<AppLifecycleState>()
        .map(|state| state.quitting.load(Ordering::Relaxed))
        .unwrap_or(false)
}

fn run_command(mut cmd: Command) -> Result<Option<String>, String> {
    match cmd.output() {
        Ok(output) => Ok(Some(collect_output(
            output.status.success(),
            &output.stdout,
            &output.stderr,
        )?)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("failed to run command: {e}")),
    }
}

fn collect_output(success: bool, stdout: &[u8], stderr: &[u8]) -> Result<String, String> {
    let out = String::from_utf8_lossy(stdout).trim().to_string();
    let err = String::from_utf8_lossy(stderr).trim().to_string();
    if success {
        if out.is_empty() {
            return Ok("ok".to_string());
        }
        return Ok(out);
    }
    if err.is_empty() {
        Err("command failed".to_string())
    } else {
        Err(err)
    }
}

fn find_repo_root() -> Option<PathBuf> {
    let mut dir = std::env::current_dir().ok()?;
    loop {
        if is_switchly_root(&dir) {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

fn is_switchly_root(dir: &Path) -> bool {
    dir.join("go.mod").is_file() && dir.join("cmd").is_dir() && dir.join("internal").is_dir()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppLifecycleState::default())
        .setup(|app| {
            if let Err(err) = setup_tray(&app.handle()) {
                eprintln!("setup tray failed: {err}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !should_close_window(&window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&'static str>>,
        ))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            daemon_start,
            daemon_stop,
            daemon_restart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fmt_pct_clamps_and_rounds() {
        assert_eq!(fmt_pct(-12.0), 0);
        assert_eq!(fmt_pct(0.0), 0);
        assert_eq!(fmt_pct(12.2), 12);
        assert_eq!(fmt_pct(12.6), 13);
        assert_eq!(fmt_pct(120.0), 100);
    }

    #[test]
    fn remaining_pct_converts_from_used_percent() {
        assert_eq!(remaining_pct(0.0), 100);
        assert_eq!(remaining_pct(12.2), 88);
        assert_eq!(remaining_pct(12.6), 87);
        assert_eq!(remaining_pct(100.0), 0);
        assert_eq!(remaining_pct(120.0), 0);
    }

    #[test]
    fn account_menu_label_formats_remaining_and_limit() {
        let account = AccountSnapshot {
            id: "acc-a".to_string(),
            quota: QuotaSnapshot {
                session: QuotaWindow { used_percent: 22.1 },
                weekly: QuotaWindow { used_percent: 80.7 },
                session_supported: Some(true),
                limit_reached: true,
            },
        };

        let label = account_menu_label(&account);
        assert_eq!(label, "acc-a | S:78% W:19% !");
    }

    #[test]
    fn account_menu_label_uses_na_for_unsupported_session_window() {
        let account = AccountSnapshot {
            id: "acc-free".to_string(),
            quota: QuotaSnapshot {
                session: QuotaWindow { used_percent: 0.0 },
                weekly: QuotaWindow { used_percent: 1.0 },
                session_supported: Some(false),
                limit_reached: false,
            },
        };

        let label = account_menu_label(&account);
        assert_eq!(label, "acc-free | S:N/A W:99%");
    }

    #[test]
    fn routing_strategy_deserializes_from_api_format() {
        let raw = r#"{"active_account_id":"acc-1","strategy":"fill-first","accounts":[]}"#;
        let snapshot: StatusSnapshot =
            serde_json::from_str(raw).expect("status json should deserialize");
        assert_eq!(snapshot.strategy, RoutingStrategy::FillFirst);
    }

    #[test]
    fn shorten_error_limits_length() {
        let short = shorten_error("daemon down");
        assert_eq!(short, "daemon down");

        let long = shorten_error("abcdefghijklmnopqrstuvwxyz0123456789---suffix-extra-long");
        assert_eq!(long, "abcdefghijklmnopqrstuvwxyz0123456789---suffix-ex...");
    }

    #[test]
    fn tray_event_requires_dashboard_refresh_matches_expected_ids() {
        assert!(tray_event_requires_dashboard_refresh(MENU_REFRESH));
        assert!(tray_event_requires_dashboard_refresh(MENU_DAEMON_START));
        assert!(tray_event_requires_dashboard_refresh(
            MENU_STRATEGY_ROUND_ROBIN
        ));
        assert!(tray_event_requires_dashboard_refresh(MENU_TOGGLE_AUTOSTART));
        assert!(tray_event_requires_dashboard_refresh("account:acc-a"));

        assert!(!tray_event_requires_dashboard_refresh(MENU_OPEN_DASHBOARD));
        assert!(!tray_event_requires_dashboard_refresh(MENU_QUIT));
        assert!(!tray_event_requires_dashboard_refresh("unknown"));
    }
}
