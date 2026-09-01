//! Tauri komutları — sensor-frame + manyetik analiz.

pub mod archive_cmds;
pub mod capture_cmds;
pub mod csv_cmds;
pub mod dta_cmds;
pub mod license_cmds;
mod dto;
pub mod image_cmds;
pub mod magnetic_cmds;
pub mod prob_cmds;
pub mod update_cmds;

use crate::magnetic::MagneticAnalyzer;
use crate::structures::StructureHint;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Son başarılı 3D analiz oturumu (DTA köprüsü yeniden hesaplar).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeSession {
    pub image_base64: String,
    pub file_name: Option<String>,
    pub lut_strip_px: u32,
    pub view_mode: String,
    pub min_confidence: f32,
    pub target_kind: String,
    #[serde(default = "default_soil_profile")]
    pub soil_profile: String,
}

fn default_soil_profile() -> String {
    "loam".into()
}

pub struct AppState {
    pub analyzer: Mutex<MagneticAnalyzer>,
    pub last_session: Mutex<Option<AnalyzeSession>>,
    pub dta_hints: Mutex<Vec<StructureHint>>,
    /// Aktif DTA ipuçlarının bağlı olduğu harita (SHA256)
    pub dta_hints_map_id: Mutex<Option<String>>,
    /// Localhost köprü bind oldu mu
    pub bridge_listening: AtomicBool,
    /// DTA'dan son HTTP teması (unix ms)
    pub dta_last_contact_ms: AtomicU64,
    /// Son yönlendirme ipucu sayısı
    pub dta_last_hint_count: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            analyzer: Mutex::new(MagneticAnalyzer::default()),
            last_session: Mutex::new(None),
            dta_hints: Mutex::new(Vec::new()),
            dta_hints_map_id: Mutex::new(None),
            bridge_listening: AtomicBool::new(false),
            dta_last_contact_ms: AtomicU64::new(0),
            dta_last_hint_count: AtomicU64::new(0),
        }
    }
}

impl AppState {
    pub fn touch_dta_contact(&self) {
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.dta_last_contact_ms.store(ms, Ordering::Relaxed);
    }
}

pub use dto::decode_image_bytes;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DtaLinkStatus {
    pub bridge_listening: bool,
    pub has_session: bool,
    pub hint_count: usize,
    pub dta_seen_secs_ago: Option<u64>,
    pub last_hint_count: u64,
    pub addr: String,
    pub label: String,
    pub state: String,
}

/// VOTEX UI — DTA entegrasyon durumu (ayrı süreç, aynı komuta merkezi).
#[tauri::command]
pub fn get_dta_link_status(state: tauri::State<'_, AppState>) -> Result<DtaLinkStatus, String> {
    let bridge = state.bridge_listening.load(Ordering::Relaxed);
    let has_session = state
        .last_session
        .lock()
        .map(|s| s.is_some())
        .unwrap_or(false);
    let hint_count = state.dta_hints.lock().map(|h| h.len()).unwrap_or(0);
    let last_hint = state.dta_last_hint_count.load(Ordering::Relaxed);
    let last_ms = state.dta_last_contact_ms.load(Ordering::Relaxed);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let seen = if last_ms > 0 && now_ms >= last_ms {
        Some((now_ms - last_ms) / 1000)
    } else {
        None
    };

    // "oturum" = VOTEX 3D analizi; DTA ayrı süreç — heartbeat ile sık temas
    // 3 dk tolerans (DTA 12 sn heartbeat); yavaş RTT "kötü bağlantı" sayılmaz
    let dta_online = seen.map(|s| s <= 180).unwrap_or(false);
    let (state_key, label): (&str, String) = if !bridge {
        ("down", "Köprü kapalı".into())
    } else if dta_online {
        let ago = seen.unwrap_or(0);
        (
            "linked",
            if last_hint > 0 {
                format!("DTA bağlı · {last_hint} ipucu")
            } else if ago <= 20 {
                "DTA bağlı · güçlü".into()
            } else {
                format!("DTA bağlı · {ago}s")
            },
        )
    } else if has_session {
        ("ready", "DTA bekleniyor · 3D hazır".into())
    } else {
        ("wait", "DTA bekleniyor · önce 3D".into())
    };

    Ok(DtaLinkStatus {
        bridge_listening: bridge,
        has_session,
        hint_count,
        dta_seen_secs_ago: seen,
        last_hint_count: last_hint,
        addr: crate::dta_bridge::DTA_BRIDGE_ADDR.into(),
        label,
        state: state_key.into(),
    })
}
