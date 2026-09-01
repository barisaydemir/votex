//! DTA ipuçları — harita (görüntü içeriği) bazında kalıcı saklama.

use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::commands::AppState;
use crate::structures::StructureHint;
use std::sync::atomic::Ordering;

const STORE_FILE: &str = "map_hints.json";
const MAX_ENTRIES: usize = 40;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapHintEntry {
    map_id: String,
    #[serde(default)]
    file_name: Option<String>,
    hints: Vec<StructureHint>,
    updated_at: String,
    /// Bu harita için DTA ipuçları analizde kullanılsın mı
    #[serde(default = "default_true")]
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct HintStoreFile {
    #[serde(default)]
    entries: Vec<MapHintEntry>,
}

/// UI paneli — kayıtlı ipuçları + açık/kapalı.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapHintsPanel {
    pub map_id: Option<String>,
    pub file_name: Option<String>,
    pub enabled: bool,
    pub stored_count: usize,
    pub active_count: usize,
    pub hints: Vec<StructureHint>,
    pub has_session: bool,
}

fn store_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Votex").join(STORE_FILE)
}

fn decode_payload(image_base64: &str) -> Result<Vec<u8>, String> {
    let raw = image_base64
        .split(',')
        .last()
        .unwrap_or(image_base64)
        .trim();
    B64.decode(raw).map_err(|e| format!("Harita base64: {e}"))
}

/// Görüntü ham baytlarından sabit kimlik (aynı dosya = aynı id).
pub fn map_fingerprint(image_base64: &str) -> Result<String, String> {
    let bytes = decode_payload(image_base64)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let dig = hasher.finalize();
    Ok(dig.iter().map(|b| format!("{:02x}", b)).collect::<String>())
}

fn read_store() -> HintStoreFile {
    let path = store_path();
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return HintStoreFile::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_store(store: &HintStoreFile) -> Result<(), String> {
    let path = store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn now_tag() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn find_entry<'a>(store: &'a HintStoreFile, map_id: &str) -> Option<&'a MapHintEntry> {
    store.entries.iter().find(|e| e.map_id == map_id)
}

pub fn hints_for_map(map_id: &str) -> Vec<StructureHint> {
    read_store()
        .entries
        .into_iter()
        .find(|e| e.map_id == map_id)
        .map(|e| e.hints)
        .unwrap_or_default()
}

pub fn map_hints_enabled(map_id: &str) -> bool {
    find_entry(&read_store(), map_id)
        .map(|e| e.enabled)
        .unwrap_or(true)
}

/// Analizde kullanılacak ipuçları (kapalıysa boş).
pub fn active_hints_for_map(map_id: &str) -> Vec<StructureHint> {
    let store = read_store();
    match find_entry(&store, map_id) {
        Some(e) if e.enabled => e.hints.clone(),
        _ => Vec::new(),
    }
}

pub fn save_hints_for_map(
    map_id: &str,
    file_name: Option<&str>,
    hints: &[StructureHint],
) -> Result<(), String> {
    let mut store = read_store();
    let prev_enabled = find_entry(&store, map_id)
        .map(|e| e.enabled)
        .unwrap_or(true);
    let prev_name = find_entry(&store, map_id)
        .and_then(|e| e.file_name.clone());
    store.entries.retain(|e| e.map_id != map_id);
    if !hints.is_empty() {
        store.entries.insert(
            0,
            MapHintEntry {
                map_id: map_id.into(),
                file_name: file_name.map(String::from).or(prev_name),
                hints: hints.to_vec(),
                updated_at: now_tag(),
                enabled: prev_enabled,
            },
        );
    }
    while store.entries.len() > MAX_ENTRIES {
        store.entries.pop();
    }
    write_store(&store)
}

pub fn set_map_hints_enabled(map_id: &str, enabled: bool) -> Result<(), String> {
    let mut store = read_store();
    if let Some(e) = store.entries.iter_mut().find(|e| e.map_id == map_id) {
        e.enabled = enabled;
        e.updated_at = now_tag();
        return write_store(&store);
    }
    // Kayıt yoksa kapalı bayrağı için boş giriş (ipucu gelince korunur)
    if !enabled {
        store.entries.insert(
            0,
            MapHintEntry {
                map_id: map_id.into(),
                file_name: None,
                hints: Vec::new(),
                updated_at: now_tag(),
                enabled: false,
            },
        );
        while store.entries.len() > MAX_ENTRIES {
            store.entries.pop();
        }
        write_store(&store)?;
    }
    Ok(())
}

fn resolve_active_map_id(state: &AppState) -> Option<(String, Option<String>)> {
    if let Ok(mid) = state.dta_hints_map_id.lock() {
        if let Some(id) = mid.clone() {
            let fn_ = state
                .last_session
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .and_then(|s| s.file_name);
            return Some((id, fn_));
        }
    }
    let session = state.last_session.lock().ok().and_then(|g| g.clone())?;
    let id = map_fingerprint(&session.image_base64).ok()?;
    Some((id, session.file_name))
}

pub fn panel_for_state(state: &AppState) -> MapHintsPanel {
    let has_session = state
        .last_session
        .lock()
        .map(|s| s.is_some())
        .unwrap_or(false);
    let Some((map_id, file_name)) = resolve_active_map_id(state) else {
        return MapHintsPanel {
            map_id: None,
            file_name: None,
            enabled: true,
            stored_count: 0,
            active_count: 0,
            hints: Vec::new(),
            has_session,
        };
    };
    let store = read_store();
    let entry = find_entry(&store, &map_id);
    let enabled = entry.map(|e| e.enabled).unwrap_or(true);
    let hints = entry.map(|e| e.hints.clone()).unwrap_or_default();
    let stored = hints.len();
    let active = if enabled { stored } else { 0 };
    let file_name = entry
        .and_then(|e| e.file_name.clone())
        .or(file_name);
    MapHintsPanel {
        map_id: Some(map_id),
        file_name,
        enabled,
        stored_count: stored,
        active_count: active,
        hints,
        has_session,
    }
}

/// Bu haritanın ipuçlarını belleğe yükle (kapalıysa boş); başka haritanın ipuçları kullanılmaz.
pub fn activate_map_hints(state: &AppState, map_id: &str) -> Result<Vec<StructureHint>, String> {
    let hints = active_hints_for_map(map_id);
    {
        let mut guard = state.dta_hints.lock().map_err(|e| e.to_string())?;
        *guard = hints.clone();
    }
    {
        let mut mid = state
            .dta_hints_map_id
            .lock()
            .map_err(|e| e.to_string())?;
        *mid = Some(map_id.to_string());
    }
    state
        .dta_last_hint_count
        .store(hints.len() as u64, Ordering::Relaxed);
    Ok(hints)
}

pub fn persist_state_hints(state: &AppState) -> Result<(), String> {
    let map_id = state
        .dta_hints_map_id
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let Some(map_id) = map_id else {
        return Ok(());
    };
    // Kapalıysa bellekteki boş liste kaydı silmesin
    if !map_hints_enabled(&map_id) {
        return Ok(());
    }
    let hints = state
        .dta_hints
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if hints.is_empty() {
        return Ok(());
    }
    let file_name = state
        .last_session
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .and_then(|s| s.file_name);
    save_hints_for_map(&map_id, file_name.as_deref(), &hints)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_payload_same_id() {
        let b64 = "data:image/png;base64,iVBORw0KGgo=";
        let a = map_fingerprint(b64).unwrap();
        let b = map_fingerprint(b64).unwrap();
        assert_eq!(a, b);
    }
}
