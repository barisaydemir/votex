//! Suite güncelleyici — manifest.json tabanlı (USB / klasör kanalı).
//!
//! Paket yapısı:
//!   UpdatePackage/
//!     manifest.json
//!     Votex.exe
//!     VotexProb.exe   (opsiyonel)

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::app_settings::{load_settings, save_settings};

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    #[serde(default = "default_product")]
    pub product: String,
    /// Suite sürümü (VOTEX ile hizalı)
    pub version: String,
    #[serde(default)]
    pub votex_version: String,
    #[serde(default)]
    pub vpe_version: String,
    #[serde(default)]
    pub released_at: String,
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default)]
    pub files: UpdateFiles,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFiles {
    #[serde(default = "default_votex_file")]
    pub votex: String,
    #[serde(default = "default_vpe_file")]
    pub vpe: String,
}

fn default_schema() -> u32 {
    1
}
fn default_product() -> String {
    "votex-suite".into()
}
fn default_votex_file() -> String {
    "Votex.exe".into()
}
fn default_vpe_file() -> String {
    "VotexProb.exe".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub package_path: Option<String>,
    pub available_version: Option<String>,
    pub vpe_version: Option<String>,
    pub notes: Vec<String>,
    pub update_available: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyUpdateResult {
    pub ok: bool,
    pub message: String,
    pub restart_required: bool,
}

fn parse_ver(v: &str) -> Vec<u32> {
    v.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect()
}

/// Semver-ish: 0.1.17 > 0.1.16 ; 0.1.0-D sayısal kısımla karşılaştırılır.
pub fn version_newer(candidate: &str, current: &str) -> bool {
    let a = parse_ver(candidate);
    let b = parse_ver(current);
    let n = a.len().max(b.len());
    for i in 0..n {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

pub fn read_manifest(dir: &Path) -> Result<UpdateManifest, String> {
    let path = dir.join("manifest.json");
    if !path.is_file() {
        return Err("manifest.json yok".into());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut m: UpdateManifest = serde_json::from_str(&raw).map_err(|e| format!("manifest: {e}"))?;
    if m.votex_version.is_empty() {
        m.votex_version = m.version.clone();
    }
    if m.files.votex.is_empty() {
        m.files.votex = default_votex_file();
    }
    if m.files.vpe.is_empty() {
        m.files.vpe = default_vpe_file();
    }
    Ok(m)
}

fn candidate_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let s = load_settings();
    let custom = s.update_package_path.trim();
    if !custom.is_empty() {
        out.push(PathBuf::from(custom));
    }
    // Exe yanı / Programs
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("UpdatePackage"));
            out.push(dir.join("update"));
            if let Some(parent) = dir.parent() {
                out.push(parent.join("UpdatePackage"));
                out.push(parent.join("VOTEX_Update"));
            }
        }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        out.push(
            local
                .join("Programs")
                .join("VOTEX")
                .join("UpdatePackage"),
        );
        out.push(local.join("Programs").join("VOTEX").join("pending_update"));
    }
    // Geliştirme dist
    out.push(PathBuf::from(r"C:\votex\modules\dft_packager\dist\UpdatePackage"));
    out
}

pub fn find_package_dir() -> Option<PathBuf> {
    for d in candidate_dirs() {
        if d.join("manifest.json").is_file() {
            return Some(d);
        }
    }
    None
}

pub fn probe_status() -> UpdateStatus {
    let current = CURRENT_VERSION.to_string();
    let Some(dir) = find_package_dir() else {
        return UpdateStatus {
            current_version: current,
            package_path: None,
            available_version: None,
            vpe_version: None,
            notes: vec![],
            update_available: false,
            message: "Güncelleme paketi yok — USB’den paket seçin".into(),
        };
    };
    match read_manifest(&dir) {
        Ok(m) => {
            let avail = version_newer(&m.version, &current);
            UpdateStatus {
                current_version: current,
                package_path: Some(dir.to_string_lossy().into_owned()),
                available_version: Some(m.version.clone()),
                vpe_version: if m.vpe_version.is_empty() {
                    None
                } else {
                    Some(m.vpe_version)
                },
                notes: m.notes,
                update_available: avail,
                message: if avail {
                    format!("Güncelleme hazır · {} → {}", CURRENT_VERSION, m.version)
                } else {
                    format!("Güncel ({})", CURRENT_VERSION)
                },
            }
        }
        Err(e) => UpdateStatus {
            current_version: current,
            package_path: Some(dir.to_string_lossy().into_owned()),
            available_version: None,
            vpe_version: None,
            notes: vec![],
            update_available: false,
            message: format!("Paket okunamadı: {e}"),
        },
    }
}

pub fn set_package_path(path: &str) -> Result<UpdateStatus, String> {
    let p = PathBuf::from(path.trim());
    if !p.join("manifest.json").is_file() {
        return Err("Seçilen klasörde manifest.json yok".into());
    }
    let _ = read_manifest(&p)?;
    let mut s = load_settings();
    s.update_package_path = p.to_string_lossy().into_owned();
    save_settings(&s)?;
    Ok(probe_status())
}

pub fn pick_package_folder() -> Result<UpdateStatus, String> {
    let picked = rfd::FileDialog::new()
        .set_title("VOTEX güncelleme paketi klasörü (manifest.json)")
        .pick_folder();
    let Some(dir) = picked else {
        return Ok(probe_status());
    };
    set_package_path(&dir.to_string_lossy())
}

fn install_targets() -> (PathBuf, PathBuf) {
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let votex = local.join("Programs").join("VOTEX").join("Votex.exe");
    let vpe = local
        .join("Programs")
        .join("VotexProb")
        .join("VotexProb.exe");
    // Çalışan exe farklı yerdeyse onu da hedefle
    let votex = std::env::current_exe().unwrap_or(votex.clone()).canonicalize().unwrap_or(votex);
    (votex, vpe)
}

fn staging_dir() -> PathBuf {
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    local.join("Programs").join("VOTEX").join("update_staging")
}

/// Paketi stage’e kopyala, apply bat’ı başlat; çağıran UI uygulamayı kapatmalı.
pub fn apply_update(package_dir: Option<&str>) -> Result<ApplyUpdateResult, String> {
    let dir = if let Some(p) = package_dir.filter(|s| !s.trim().is_empty()) {
        PathBuf::from(p)
    } else {
        find_package_dir().ok_or_else(|| "Güncelleme paketi bulunamadı".to_string())?
    };
    let m = read_manifest(&dir)?;
    if !version_newer(&m.version, CURRENT_VERSION) {
        return Ok(ApplyUpdateResult {
            ok: false,
            message: format!("Zaten güncel ({CURRENT_VERSION})"),
            restart_required: false,
        });
    }

    let votex_src = {
        let p = dir.join(&m.files.votex);
        if p.is_file() {
            p
        } else {
            let alt = dir.join("votex.exe");
            if alt.is_file() {
                alt
            } else {
                return Err(format!("{} bulunamadı", m.files.votex));
            }
        }
    };
    let vpe_src = {
        let p = dir.join(&m.files.vpe);
        if p.is_file() {
            Some(p)
        } else {
            let alt = dir.join("VotexProb.exe");
            if alt.is_file() {
                Some(alt)
            } else {
                None
            }
        }
    };

    let stage = staging_dir();
    fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let stage_votex = stage.join("Votex.exe");
    fs::copy(&votex_src, &stage_votex).map_err(|e| format!("VOTEX kopya: {e}"))?;
    let stage_vpe = stage.join("VotexProb.exe");
    if let Some(ref src) = vpe_src {
        fs::copy(src, &stage_vpe).map_err(|e| format!("VPE kopya: {e}"))?;
    }

    let (dest_votex, dest_vpe) = install_targets();
    if let Some(parent) = dest_votex.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if let Some(parent) = dest_vpe.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Ayrıca NSIS yolu varsa
    let nsis = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|b| b.join("Votex").join("votex.exe"));

    let bat = stage.join("apply_update.bat");
    let bat_body = format!(
        r#"@echo off
setlocal EnableExtensions
echo VOTEX guncelleme uygulanıyor...
timeout /t 2 /nobreak >nul
taskkill /IM Votex.exe /F >nul 2>&1
taskkill /IM votex.exe /F >nul 2>&1
taskkill /IM VotexProb.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul
copy /y "{stage_v}" "{dest_v}" >nul
if exist "{stage_p}" (
  copy /y "{stage_p}" "{dest_p}" >nul
)
{nsis_copy}
echo [OK] Surum {ver}
start "" "{dest_v}"
if exist "{dest_p}" start "" "{dest_p}"
endlocal
"#,
        stage_v = stage_votex.display(),
        dest_v = dest_votex.display(),
        stage_p = stage_vpe.display(),
        dest_p = dest_vpe.display(),
        ver = m.version,
        nsis_copy = nsis
            .as_ref()
            .map(|p| {
                if p.parent().map(|d| d.is_dir()).unwrap_or(false) {
                    format!(
                        "if exist \"{0}\" copy /y \"{1}\" \"{0}\" >nul\nif exist \"{2}\" copy /y \"{1}\" \"{2}\" >nul",
                        p.display(),
                        stage_votex.display(),
                        p.with_file_name("Votex.exe").display()
                    )
                } else {
                    String::new()
                }
            })
            .unwrap_or_default()
    );
    fs::write(&bat, bat_body).map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        Command::new("cmd")
            .args(["/C", &bat.to_string_lossy()])
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn()
            .map_err(|e| format!("Güncelleyici başlatılamadı: {e}"))?;
    }
    #[cfg(not(windows))]
    {
        Command::new("sh")
            .arg("-c")
            .arg(format!("sleep 2; cp '{}' '{}'", stage_votex.display(), dest_votex.display()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    // Ayarlara paket yolunu yaz
    let mut s = load_settings();
    s.update_package_path = dir.to_string_lossy().into_owned();
    let _ = save_settings(&s);

    Ok(ApplyUpdateResult {
        ok: true,
        message: format!(
            "Güncelleme başlatıldı · {} → {} — VOTEX kapanacak",
            CURRENT_VERSION, m.version
        ),
        restart_required: true,
    })
}
