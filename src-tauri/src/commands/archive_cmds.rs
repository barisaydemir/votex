//! Analiz arşivi Tauri komutları.

use tauri::State;

use crate::archive::{self, ArchiveIndexEntry, ArchiveLoadResult};
use crate::commands::{AnalyzeSession, AppState};

#[tauri::command]
pub fn list_archive() -> Result<Vec<ArchiveIndexEntry>, String> {
    archive::list_entries()
}

#[tauri::command]
pub fn load_archive(
    state: State<'_, AppState>,
    id: String,
) -> Result<ArchiveLoadResult, String> {
    let loaded = archive::load_entry(&id)?;
    {
        let mut session = state.last_session.lock().map_err(|e| e.to_string())?;
        *session = Some(AnalyzeSession {
            image_base64: loaded.image_base64.clone(),
            file_name: loaded
                .file_name
                .clone()
                .or_else(|| Some(loaded.meta.file_name.clone())),
            lut_strip_px: loaded.meta.lut_strip_px,
            view_mode: loaded.meta.view_mode.clone(),
            min_confidence: loaded.meta.min_confidence,
            target_kind: loaded.meta.target_kind.clone(),
            soil_profile: if !loaded.meta.soil_profile.is_empty() {
                loaded.meta.soil_profile.clone()
            } else if !loaded.surface.soil_profile.is_empty() {
                loaded.surface.soil_profile.clone()
            } else {
                "off".into()
            },
        });
    }
    {
        let map_id = crate::hint_store::map_fingerprint(&loaded.image_base64)?;
        crate::hint_store::save_hints_for_map(
            &map_id,
            loaded
                .file_name
                .as_deref()
                .or(Some(loaded.meta.file_name.as_str())),
            &loaded.hints,
        )?;
        let mut hints = state.dta_hints.lock().map_err(|e| e.to_string())?;
        *hints = loaded.hints.clone();
        if let Ok(mut mid) = state.dta_hints_map_id.lock() {
            *mid = Some(map_id);
        }
        state
            .dta_last_hint_count
            .store(hints.len() as u64, std::sync::atomic::Ordering::Relaxed);
    }
    let _ = crate::session_persist::save_work(
        state
            .last_session
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .as_ref(),
        &loaded.hints,
        Some(&loaded.surface),
    );
    Ok(loaded)
}

#[tauri::command]
pub fn delete_archive(id: String) -> Result<(), String> {
    archive::delete_entry(&id)
}
