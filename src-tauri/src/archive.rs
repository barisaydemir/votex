//! Analiz arşivi — %APPDATA%\Votex\archive\

use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::commands::AnalyzeSession;
use crate::structures::StructureHint;
use crate::legacy_mag_json::LegacyDikResult;
use crate::surface::Surface3D;

const MAX_ENTRIES: usize = 50;
const INDEX_FILE: &str = "index.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveIndexEntry {
    pub id: String,
    pub created_at: String,
    pub file_name: String,
    pub view_mode: String,
    pub target_kind: String,
    pub min_confidence: f32,
    pub accepted: u32,
    pub rejected: u32,
    pub rooms: u32,
    pub shafts: u32,
    pub tunnels: u32,
    pub metals: u32,
    /// index’e göre göreli yol (ör. `{id}/preview.png`)
    pub preview_rel: String,
    #[serde(default)]
    pub soil_profile: String,
    /// "image" veya "legacy_dik_json".
    #[serde(default = "default_source_kind")]
    pub source_kind: String,
}

fn default_source_kind() -> String {
    "image".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyArchiveMeta {
    pub id: String,
    pub created_at: String,
    pub file_name: String,
    pub source_kind: String,
    pub point_count: usize,
    pub unique_points: usize,
    pub grid_w: u32,
    pub grid_h: u32,
    pub metals: u32,
    pub anomalies: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyArchiveLoadResult {
    pub meta: LegacyArchiveMeta,
    pub content: String,
    pub result: LegacyDikResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveMeta {
    pub id: String,
    pub created_at: String,
    pub file_name: String,
    pub view_mode: String,
    pub target_kind: String,
    pub min_confidence: f32,
    pub lut_strip_px: u32,
    pub source_ext: String,
    pub accepted: u32,
    pub rejected: u32,
    pub rooms: u32,
    pub shafts: u32,
    pub tunnels: u32,
    pub metals: u32,
    #[serde(default)]
    pub soil_profile: String,
    #[serde(default)]
    pub soil_correction_applied: bool,
    #[serde(default = "default_source_kind")]
    pub source_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveLoadResult {
    pub meta: ArchiveMeta,
    pub surface: Surface3D,
    pub image_base64: String,
    pub file_name: Option<String>,
    pub hints: Vec<StructureHint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ArchiveIndex {
    #[serde(default)]
    entries: Vec<ArchiveIndexEntry>,
}

pub fn archive_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Votex").join("archive")
}

fn index_path() -> PathBuf {
    archive_dir().join(INDEX_FILE)
}

fn read_index() -> ArchiveIndex {
    let path = index_path();
    let Ok(raw) = fs::read_to_string(&path) else {
        return ArchiveIndex::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_index(idx: &ArchiveIndex) -> Result<(), String> {
    let dir = archive_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(idx).map_err(|e| e.to_string())?;
    fs::write(index_path(), raw).map_err(|e| e.to_string())
}

fn now_iso_ish() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // YYYY-MM-DD HH:MM:SS UTC yaklaşık (günlük sıralama için yeterli)
    let days = secs / 86400;
    let rem = secs % 86400;
    let h = rem / 3600;
    let m = (rem % 3600) / 60;
    let s = rem % 60;
    // 1970-01-01 + days — basit gösterim: unix timestamp string + okunabilir
    format!("{secs}|{h:02}:{m:02}:{s:02}UTC(+{days}d)")
}

fn make_id(file_name: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(d.as_nanos().to_le_bytes());
    hasher.update(file_name.as_bytes());
    let dig = hasher.finalize();
    let short = format!("{:x}{:x}{:x}", dig[0], dig[1], dig[2]);
    format!("{}-{}", d.as_secs(), &short[..6.min(short.len())])
}

fn source_ext_from_name(name: &str, bytes: &[u8]) -> String {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        return "jpg".into();
    }
    if lower.ends_with(".png") {
        return "png".into();
    }
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return "jpg".into();
    }
    if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        return "png".into();
    }
    "bin".into()
}

fn decode_b64_payload(image_base64: &str) -> Result<Vec<u8>, String> {
    let raw = image_base64
        .split(',')
        .last()
        .unwrap_or(image_base64)
        .trim();
    B64.decode(raw)
        .map_err(|e| format!("Arşiv kaynak base64: {e}"))
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        _ => "application/octet-stream",
    }
}

fn data_url(ext: &str, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", mime_for_ext(ext), B64.encode(bytes))
}

fn preview_png_from_surface(surface: &Surface3D) -> Option<Vec<u8>> {
    let url = surface.cleaned_preview_base64.as_deref()?;
    decode_b64_payload(url).ok()
}

fn summarize(surface: &Surface3D) -> (u32, u32, u32, u32, u32, u32) {
    let s = &surface.structures;
    let n_room = s
        .chambers
        .iter()
        .filter(|c| c.kind == "room" || c.kind == "tomb")
        .count() as u32;
    let n_shaft = s.chambers.iter().filter(|c| c.kind == "shaft").count() as u32;
    (
        s.accepted_count,
        s.rejected_count,
        n_room,
        n_shaft,
        s.tunnels.len() as u32,
        s.metals.len() as u32,
    )
}

fn remove_entry_dir(id: &str) {
    let dir = archive_dir().join(id);
    let _ = fs::remove_dir_all(dir);
}

fn enforce_cap(idx: &mut ArchiveIndex) {
    while idx.entries.len() > MAX_ENTRIES {
        // en eski sonda değil — liste yeni başa; sonda eski
        if let Some(old) = idx.entries.pop() {
            remove_entry_dir(&old.id);
        } else {
            break;
        }
    }
}

/// Başarılı analiz sonrası otomatik kayıt. Hata üst katmana iletilir (çağıran loglar).
pub fn save_entry(
    session: &AnalyzeSession,
    surface: &Surface3D,
    hints: &[StructureHint],
) -> Result<ArchiveIndexEntry, String> {
    let file_name = session
        .file_name
        .clone()
        .or_else(|| surface.file_name.clone())
        .unwrap_or_else(|| "harita".into());
    let id = make_id(&file_name);
    let created_at = now_iso_ish();
    let entry_dir = archive_dir().join(&id);
    fs::create_dir_all(&entry_dir).map_err(|e| e.to_string())?;

    let source_bytes = decode_b64_payload(&session.image_base64)?;
    let source_ext = source_ext_from_name(&file_name, &source_bytes);
    let source_name = format!("source.{source_ext}");
    fs::write(entry_dir.join(&source_name), &source_bytes).map_err(|e| e.to_string())?;

    if let Some(png) = preview_png_from_surface(surface) {
        fs::write(entry_dir.join("preview.png"), png).map_err(|e| e.to_string())?;
    }

    let mut surface_disk = surface.clone();
    surface_disk.cleaned_preview_base64 = None;
    let surface_raw = serde_json::to_string(&surface_disk).map_err(|e| e.to_string())?;
    fs::write(entry_dir.join("surface.json"), surface_raw).map_err(|e| e.to_string())?;

    if !hints.is_empty() {
        let hints_raw = serde_json::to_string(hints).map_err(|e| e.to_string())?;
        fs::write(entry_dir.join("hints.json"), hints_raw).map_err(|e| e.to_string())?;
    }

    let (accepted, rejected, rooms, shafts, tunnels, metals) = summarize(surface);
    let meta = ArchiveMeta {
        id: id.clone(),
        created_at: created_at.clone(),
        file_name: file_name.clone(),
        view_mode: session.view_mode.clone(),
        target_kind: session.target_kind.clone(),
        min_confidence: session.min_confidence,
        lut_strip_px: session.lut_strip_px,
        source_ext: source_ext.clone(),
        accepted,
        rejected,
        rooms,
        shafts,
        tunnels,
        metals,
        soil_profile: session.soil_profile.clone(),
        soil_correction_applied: surface.soil_correction_applied,
        source_kind: "image".into(),
    };
    let meta_raw = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(entry_dir.join("meta.json"), meta_raw).map_err(|e| e.to_string())?;

    let index_entry = ArchiveIndexEntry {
        id: id.clone(),
        created_at,
        file_name,
        view_mode: session.view_mode.clone(),
        target_kind: session.target_kind.clone(),
        min_confidence: session.min_confidence,
        accepted,
        rejected,
        rooms,
        shafts,
        tunnels,
        metals,
        preview_rel: format!("{id}/preview.png"),
        soil_profile: session.soil_profile.clone(),
        source_kind: "image".into(),
    };

    let mut idx = read_index();
    idx.entries.insert(0, index_entry.clone());
    enforce_cap(&mut idx);
    write_index(&idx)?;
    Ok(index_entry)
}

/// Legacy dik JSON analizini arşive kaydet.
pub fn save_legacy_entry(
    file_name: &str,
    content: &str,
    result: &LegacyDikResult,
) -> Result<ArchiveIndexEntry, String> {
    if content.trim().is_empty() {
        return Err("Legacy JSON içeriği boş".into());
    }
    let file_name = if file_name.trim().is_empty() {
        "legacy_dik.json"
    } else {
        file_name.trim()
    };
    let id = make_id(file_name);
    let created_at = now_iso_ish();
    let entry_dir = archive_dir().join(&id);
    fs::create_dir_all(&entry_dir).map_err(|e| e.to_string())?;
    fs::write(entry_dir.join("source.json"), content.as_bytes()).map_err(|e| e.to_string())?;
    let result_raw = serde_json::to_string(result).map_err(|e| e.to_string())?;
    fs::write(entry_dir.join("legacy_result.json"), result_raw).map_err(|e| e.to_string())?;
    let meta = LegacyArchiveMeta {
        id: id.clone(),
        created_at: created_at.clone(),
        file_name: file_name.into(),
        source_kind: "legacy_dik_json".into(),
        point_count: result.point_count,
        unique_points: result.unique_points,
        grid_w: result.grid_w,
        grid_h: result.grid_h,
        metals: result.metals.len() as u32,
        anomalies: result.anomalies.len() as u32,
    };
    let meta_raw = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(entry_dir.join("legacy_meta.json"), meta_raw).map_err(|e| e.to_string())?;

    let index_entry = ArchiveIndexEntry {
        id: id.clone(),
        created_at,
        file_name: file_name.into(),
        view_mode: "top".into(),
        target_kind: "legacy_dik".into(),
        min_confidence: 0.0,
        accepted: (result.anomalies.len() + result.candidates.len()) as u32,
        rejected: 0,
        rooms: 0,
        shafts: 0,
        tunnels: 0,
        metals: result.metals.len() as u32,
        preview_rel: format!("{id}/source.json"),
        soil_profile: "off".into(),
        source_kind: "legacy_dik_json".into(),
    };
    let mut idx = read_index();
    idx.entries.insert(0, index_entry.clone());
    enforce_cap(&mut idx);
    write_index(&idx)?;
    Ok(index_entry)
}

pub fn load_legacy_entry(id: &str) -> Result<LegacyArchiveLoadResult, String> {
    let id = sanitize_id(id)?;
    let entry_dir = archive_dir().join(&id);
    if !entry_dir.is_dir() {
        return Err("Legacy JSON arşiv kaydı bulunamadı".into());
    }
    let meta_raw = fs::read_to_string(entry_dir.join("legacy_meta.json")).map_err(|e| e.to_string())?;
    let meta: LegacyArchiveMeta = serde_json::from_str(&meta_raw).map_err(|e| e.to_string())?;
    let content = fs::read_to_string(entry_dir.join("source.json")).map_err(|e| e.to_string())?;
    let result_raw = fs::read_to_string(entry_dir.join("legacy_result.json")).map_err(|e| e.to_string())?;
    let result: LegacyDikResult = serde_json::from_str(&result_raw).map_err(|e| e.to_string())?;
    Ok(LegacyArchiveLoadResult { meta, content, result })
}

pub fn list_entries() -> Result<Vec<ArchiveIndexEntry>, String> {
    Ok(read_index().entries)
}

pub fn load_entry(id: &str) -> Result<ArchiveLoadResult, String> {
    let id = sanitize_id(id)?;
    let entry_dir = archive_dir().join(&id);
    if !entry_dir.is_dir() {
        return Err("Arşiv kaydı bulunamadı".into());
    }

    let meta: ArchiveMeta = {
        let raw = fs::read_to_string(entry_dir.join("meta.json")).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())?
    };

    let mut surface: Surface3D = {
        let raw = fs::read_to_string(entry_dir.join("surface.json")).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| e.to_string())?
    };

    let preview_path = entry_dir.join("preview.png");
    if preview_path.is_file() {
        if let Ok(bytes) = fs::read(&preview_path) {
            surface.cleaned_preview_base64 = Some(data_url("png", &bytes));
        }
    }

    let source_path = entry_dir.join(format!("source.{}", meta.source_ext));
    let source_path = if source_path.is_file() {
        source_path
    } else {
        // eski / fallback
        ["source.png", "source.jpg", "source.bin"]
            .iter()
            .map(|n| entry_dir.join(n))
            .find(|p| p.is_file())
            .ok_or_else(|| "Arşiv kaynak görseli yok".to_string())?
    };
    let source_bytes = fs::read(&source_path).map_err(|e| e.to_string())?;
    let ext = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or(meta.source_ext.as_str());
    let image_base64 = data_url(ext, &source_bytes);

    let hints = {
        let hp = entry_dir.join("hints.json");
        if hp.is_file() {
            let raw = fs::read_to_string(hp).map_err(|e| e.to_string())?;
            serde_json::from_str(&raw).unwrap_or_default()
        } else {
            Vec::new()
        }
    };

    let file_name = Some(meta.file_name.clone());
    Ok(ArchiveLoadResult {
        meta,
        surface,
        image_base64,
        file_name,
        hints,
    })
}

pub fn delete_entry(id: &str) -> Result<(), String> {
    let id = sanitize_id(id)?;
    remove_entry_dir(&id);
    let mut idx = read_index();
    idx.entries.retain(|e| e.id != id);
    write_index(&idx)?;
    Ok(())
}

fn sanitize_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    if id.is_empty()
        || id.contains("..")
        || id.contains('/')
        || id.contains('\\')
        || id.contains(':')
    {
        return Err("Geçersiz arşiv id".into());
    }
    Ok(id.to_string())
}
