use std::path::{Path, PathBuf};
use std::process::Command;

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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            daemon_start,
            daemon_stop,
            daemon_restart
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
