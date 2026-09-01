//! Son 3D oturumu + DTA ipuçları + yüzey özeti — %APPDATA%\Votex\last_work.json

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::commands::AnalyzeSession;
use crate::hint_store;
use crate::structures::StructureHint;
use crate::surface::Surface3D;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWork {
    pub saved_at: String,
    pub session: Option<AnalyzeSession>,
    #[serde(default)]
    pub hints: Vec<StructureHint>,
    /// hints ile eşleşen harita kimliği (içerik SHA256)
    #[serde(default)]
    pub hints_map_id: Option<String>,
    /// Son başarılı 3D (DTA yeniden çizim dahil)
    pub surface: Option<Surface3D>,
}

fn work_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Votex").join("last_work.json")
}

pub fn save_work(
    session: Option<&AnalyzeSession>,
    hints: &[StructureHint],
    surface: Option<&Surface3D>,
) -> Result<(), String> {
    let path = work_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let hints_map_id = session
        .and_then(|s| hint_store::map_fingerprint(&s.image_base64).ok());
    if let (Some(s), Some(ref id)) = (session, &hints_map_id) {
        let _ = hint_store::save_hints_for_map(id, s.file_name.as_deref(), hints);
    }
    let payload = PersistedWork {
        saved_at: chrono_now(),
        session: session.cloned(),
        hints: hints.to_vec(),
        hints_map_id,
        surface: surface.cloned(),
    };
    let raw = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_work() -> Option<PersistedWork> {
    let path = work_path();
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
