//! VotexProb.exe başlatma.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::app_settings::{load_settings, AppSettings};
use crate::prob_client::{health, PROB_BRIDGE_ADDR};

/// Kurulu / geliştirme yolu.
pub fn resolve_prob_exe() -> Option<PathBuf> {
    let s = load_settings();
    let custom = s.prob_engine_path.trim();
    if !custom.is_empty() {
        let p = PathBuf::from(custom);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        let installed = local
            .join("Programs")
            .join("VotexProb")
            .join("VotexProb.exe");
        if installed.is_file() {
            return Some(installed);
        }
    }
    // Dev: workspace votex-prob target
    let candidates = [
        PathBuf::from(r"C:\votex\votex-prob\target\release\VotexProb.exe"),
        PathBuf::from(r"C:\votex\votex-prob\target\debug\VotexProb.exe"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("votex-prob").join("target").join("release").join("VotexProb.exe"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("votex-prob").join("target").join("debug").join("VotexProb.exe"),
    ];
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    // Yama klasörü
    let yama = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("modules")
        .join("dft_packager")
        .join("dist")
        .join("VPE_Yama")
        .join("VotexProb.exe");
    if yama.is_file() {
        return Some(yama);
    }
    None
}

pub fn try_launch_prob(force: bool) -> Result<String, String> {
    let s = load_settings();
    if !force && !s.auto_launch_prob {
        return Ok("autoLaunchProb kapalı".into());
    }
    if health().is_ok() {
        return Ok(format!("VPE zaten dinliyor ({PROB_BRIDGE_ADDR})"));
    }
    let Some(exe) = resolve_prob_exe() else {
        return Err("VotexProb.exe bulunamadı (kur / VPE_Yama)".into());
    };
    launch_exe(&exe)?;
    // Kısa bekleme
    for _ in 0..12 {
        thread::sleep(Duration::from_millis(200));
        if health().is_ok() {
            return Ok(format!("VPE başlatıldı: {}", exe.display()));
        }
    }
    Ok(format!(
        "VPE başlatıldı ama health yok henüz: {}",
        exe.display()
    ))
}

pub fn spawn_auto_launch_prob(app: AppHandle) {
    thread::spawn(move || {
        let s = load_settings();
        if !s.auto_launch_prob {
            return;
        }
        match try_launch_prob(false) {
            Ok(msg) => {
                eprintln!("[votex] {msg}");
                let _ = app.emit(
                    "prob-engine",
                    serde_json::json!({
                        "ok": true,
                        "message": msg,
                        "status": crate::prob_client::probe_status(),
                    }),
                );
            }
            Err(e) => {
                eprintln!("[votex] VPE launch: {e}");
                let _ = app.emit(
                    "prob-engine",
                    serde_json::json!({
                        "ok": false,
                        "message": e,
                        "status": crate::prob_client::probe_status(),
                    }),
                );
            }
        }
    });
}

fn launch_exe(exe: &Path) -> Result<(), String> {
    let dir = exe.parent().unwrap_or(Path::new("."));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        Command::new(exe)
            .current_dir(dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("VPE spawn: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        Command::new(exe)
            .current_dir(dir)
            .spawn()
            .map_err(|e| format!("VPE spawn: {e}"))?;
    }
    let _ = fs::create_dir_all(
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Votex"),
    );
    Ok(())
}

/// Ayar alanları AppSettings'e eklendi — burada sadece path resolve yardımcı.
pub fn default_prob_path_string() -> String {
    resolve_prob_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

// AppSettings alanları app_settings.rs içinde; bu dosya launch odaklı.
pub fn ensure_settings_defaults(s: &mut AppSettings) {
    if s.prob_engine_path.trim().is_empty() {
        if let Some(p) = resolve_prob_exe() {
            s.prob_engine_path = p.to_string_lossy().into_owned();
        }
    }
}
