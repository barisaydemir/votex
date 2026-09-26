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
    /// Yapı hassasiyeti (0.0–1.0) — eski kayıtlarda bulunmayabilir
    #[serde(default)]
    pub sensitivity: Option<f32>,
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
    #[serde(default)]
    pub source_fingerprint: String,
    #[serde(default)]
    pub analysis_fingerprint: String,
    #[serde(default)]
    pub content_hash: String,
    #[serde(default)]
    pub case_package_rel: String,
    #[serde(default)]
    pub source_sha256: String,
    #[serde(default)]
    pub analysis_sha256: String,
    #[serde(default)]
    pub case_package_sha256: String,
    #[serde(default)]
    pub field_report_rel: String,
    #[serde(default)]
    pub field_report_sha256: String,
    #[serde(default)]
    pub integrity_status: String,
}

fn default_source_kind() -> String {
    "image".into()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

fn verify_legacy_integrity(
    meta: &LegacyArchiveMeta,
    content: &[u8],
    result_raw: &[u8],
    package_raw: Option<&[u8]>,
    report_raw: Option<&[u8]>,
) -> LegacyArchiveIntegrity {
    let source_sha256 = sha256_hex(content);
    let analysis_sha256 = sha256_hex(result_raw);
    let case_package_sha256 = package_raw.map(sha256_hex).unwrap_or_default();
    let field_report_sha256 = report_raw.map(sha256_hex).unwrap_or_default();
    let has_package = !meta.case_package_rel.is_empty();
    let has_report = !meta.field_report_rel.is_empty();
    let expected_source = if !meta.source_sha256.is_empty() { &meta.source_sha256 } else { &meta.content_hash };
    let expected_analysis = &meta.analysis_sha256;
    let source_ok = !expected_source.is_empty() && expected_source == &source_sha256;
    let analysis_ok = !expected_analysis.is_empty() && expected_analysis == &analysis_sha256;
    let package_ok = !has_package || (!meta.case_package_sha256.is_empty() && meta.case_package_sha256 == case_package_sha256);
    let report_ok = !has_report || (!meta.field_report_sha256.is_empty() && meta.field_report_sha256 == field_report_sha256);
    let report_missing = has_report && report_raw.is_none();
    let has_hash_metadata = !meta.source_sha256.is_empty()
        && !meta.analysis_sha256.is_empty()
        && (!has_package || !meta.case_package_sha256.is_empty())
        && (!has_report || !meta.field_report_sha256.is_empty());
    let status = if !has_package {
        "legacy"
    } else if package_raw.is_none() || report_missing {
        "missing"
    } else if !has_hash_metadata {
        "unverified"
    } else if source_ok && analysis_ok && package_ok && report_ok {
        "verified"
    } else {
        "mismatch"
    };
    let reason = match status {
        "verified" if has_report => "source, analysis, package ve saha raporu hash'leri eşleşti",
        "verified" => "source, analysis ve package hash'leri eşleşti",
        "legacy" => "eski arşiv metadata'sı; hash doğrulaması yok",
        "missing" if report_missing => "metadata saha raporu gösteriyor ancak field_report.html bulunamadı",
        "missing" => "metadata package gösteriyor ancak case_package.json bulunamadı",
        "unverified" => "Case Package mevcut ancak hash metadata'sı yok",
        _ => "arşiv içeriği kaydedilmiş hash'lerle eşleşmiyor",
    };
    LegacyArchiveIntegrity {
        status: status.into(),
        verified: status == "verified",
        source_sha256,
        analysis_sha256,
        case_package_sha256,
        field_report_sha256,
        reason: reason.into(),
    }
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
    #[serde(default)]
    pub source_fingerprint: String,
    #[serde(default)]
    pub analysis_fingerprint: String,
    #[serde(default)]
    pub content_hash: String,
    #[serde(default)]
    pub case_package_rel: String,
    #[serde(default)]
    pub source_sha256: String,
    #[serde(default)]
    pub analysis_sha256: String,
    #[serde(default)]
    pub case_package_sha256: String,
    #[serde(default)]
    pub field_report_rel: String,
    #[serde(default)]
    pub field_report_sha256: String,
    #[serde(default)]
    pub integrity_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyArchiveLoadResult {
    pub meta: LegacyArchiveMeta,
    pub content: String,
    pub result: LegacyDikResult,
    #[serde(default)]
    pub case_package: Option<serde_json::Value>,
    /// Tek sayfalık saha raporu HTML'i (varsa).
    #[serde(default)]
    pub field_report: Option<String>,
    #[serde(default)]
    pub integrity: LegacyArchiveIntegrity,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LegacyArchiveIntegrity {
    pub status: String,
    pub verified: bool,
    #[serde(default)]
    pub source_sha256: String,
    #[serde(default)]
    pub analysis_sha256: String,
    #[serde(default)]
    pub case_package_sha256: String,
    #[serde(default)]
    pub field_report_sha256: String,
    #[serde(default)]
    pub reason: String,
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
    /// Yapı hassasiyeti (0.0–1.0) — eski kayıtlarda bulunmayabilir
    #[serde(default)]
    pub sensitivity: Option<f32>,
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
        sensitivity: session.sensitivity,
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
        sensitivity: session.sensitivity,
        accepted,
        rejected,
        rooms,
        shafts,
        tunnels,
        metals,
        preview_rel: format!("{id}/preview.png"),
        soil_profile: session.soil_profile.clone(),
        source_kind: "image".into(),
        source_fingerprint: String::new(),
        analysis_fingerprint: String::new(),
        content_hash: String::new(),
        case_package_rel: String::new(),
        source_sha256: String::new(),
        analysis_sha256: String::new(),
        case_package_sha256: String::new(),
        field_report_rel: String::new(),
        field_report_sha256: String::new(),
        integrity_status: String::new(),
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
    case_package: Option<&serde_json::Value>,
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
    fs::write(entry_dir.join("legacy_result.json"), result_raw.as_bytes()).map_err(|e| e.to_string())?;
    let source_sha256 = sha256_hex(content.as_bytes());
    let analysis_sha256 = sha256_hex(result_raw.as_bytes());
    let (source_fingerprint, analysis_fingerprint, content_hash, case_package_rel, case_package_sha256) = if let Some(package) = case_package {
        let obj = package.as_object().ok_or_else(|| "Case Package nesne olmalıdır".to_string())?;
        let raw = serde_json::to_string_pretty(package).map_err(|e| e.to_string())?;
        if raw.len() > 32 * 1024 * 1024 {
            return Err("Case Package arşivi çok büyük".into());
        }
        let package_sha256 = sha256_hex(raw.as_bytes());
        fs::write(entry_dir.join("case_package.json"), raw.as_bytes()).map_err(|e| e.to_string())?;
        (
            obj.get("source").and_then(|v| v.get("fingerprint")).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            obj.get("analysis").and_then(|v| v.get("fingerprint")).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            obj.get("source").and_then(|v| v.get("contentHash")).and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            format!("{id}/case_package.json"),
            package_sha256,
        )
    } else {
        (result.fingerprint.clone(), result.fingerprint.clone(), String::new(), String::new(), String::new())
    };
    let has_case_package = !case_package_rel.is_empty();
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
        source_fingerprint: source_fingerprint.clone(),
        analysis_fingerprint: analysis_fingerprint.clone(),
        content_hash: content_hash.clone(),
        case_package_rel: case_package_rel.clone(),
        source_sha256: source_sha256.clone(),
        analysis_sha256: analysis_sha256.clone(),
        case_package_sha256: case_package_sha256.clone(),
        field_report_rel: String::new(),
        field_report_sha256: String::new(),
        integrity_status: if has_case_package { "verified".into() } else { "legacy".into() },
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
        sensitivity: None,
        accepted: (result.anomalies.len() + result.candidates.len()) as u32,
        rejected: 0,
        rooms: 0,
        shafts: 0,
        tunnels: 0,
        metals: result.metals.len() as u32,
        preview_rel: format!("{id}/source.json"),
        soil_profile: "off".into(),
        source_kind: "legacy_dik_json".into(),
        source_fingerprint,
        analysis_fingerprint,
        content_hash,
        case_package_rel,
        source_sha256,
        analysis_sha256,
        case_package_sha256,
        field_report_rel: String::new(),
        field_report_sha256: String::new(),
        integrity_status: if has_case_package { "verified".into() } else { "legacy".into() },
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
    let package_raw = {
        let path = entry_dir.join("case_package.json");
        if path.is_file() {
            Some(fs::read(path).map_err(|e| e.to_string())?)
        } else {
            None
        }
    };
    let case_package = package_raw
        .as_deref()
        .and_then(|raw| serde_json::from_slice(raw).ok());
    let report_raw = {
        let path = entry_dir.join("field_report.html");
        if path.is_file() {
            Some(fs::read(path).map_err(|e| e.to_string())?)
        } else {
            None
        }
    };
    let field_report = report_raw
        .as_deref()
        .map(|raw| String::from_utf8_lossy(raw).into_owned());
    let integrity = verify_legacy_integrity(
        &meta,
        content.as_bytes(),
        result_raw.as_bytes(),
        package_raw.as_deref(),
        report_raw.as_deref(),
    );
    Ok(LegacyArchiveLoadResult { meta, content, result, case_package, field_report, integrity })
}

/// Arşiv kaydına tek sayfalık saha raporu iliştirir (field_report.html + hash
/// metadata). Mevcut raporun üzerine yazılır; bütünlük hash ile yeniden hesaplanır.
/// Yalnız Legacy (legacy_meta.json içeren) kayıtlar için geçerlidir.
pub fn attach_field_report(id: &str, html: &str) -> Result<ArchiveIndexEntry, String> {
    let id = sanitize_id(id)?;
    if html.trim().is_empty() {
        return Err("Saha raporu boş".into());
    }
    if html.len() > 2 * 1024 * 1024 {
        return Err("Saha raporu çok büyük".into());
    }
    let entry_dir = archive_dir().join(&id);
    if !entry_dir.is_dir() {
        return Err("Arşiv kaydı bulunamadı".into());
    }
    let report_sha256 = sha256_hex(html.as_bytes());
    fs::write(entry_dir.join("field_report.html"), html.as_bytes()).map_err(|e| e.to_string())?;

    let meta_raw = fs::read_to_string(entry_dir.join("legacy_meta.json")).map_err(|e| e.to_string())?;
    let mut meta: LegacyArchiveMeta = serde_json::from_str(&meta_raw).map_err(|e| e.to_string())?;
    meta.field_report_rel = format!("{id}/field_report.html");
    meta.field_report_sha256 = report_sha256.clone();
    let meta_raw = serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?;
    fs::write(entry_dir.join("legacy_meta.json"), meta_raw).map_err(|e| e.to_string())?;

    let mut idx = read_index();
    let mut updated = None;
    for entry in idx.entries.iter_mut() {
        if entry.id == id {
            entry.field_report_rel = meta.field_report_rel.clone();
            entry.field_report_sha256 = report_sha256.clone();
            updated = Some(entry.clone());
            break;
        }
    }
    let index_entry = updated.ok_or_else(|| "Arşiv dizini bulunamadı".to_string())?;
    write_index(&idx)?;
    Ok(index_entry)
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    static ARCHIVE_TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn test_result() -> LegacyDikResult {
        serde_json::from_value(json!({
            "ok": true,
            "message": "test",
            "viewMode": "top",
            "meta": {
                "deviceCode": "test-device",
                "date": null,
                "xMeters": 1.0,
                "yMeters": 1.0,
                "version": null
            },
            "pointCount": 1,
            "gridW": 1,
            "gridH": 1,
            "mapSizeM": 1.0,
            "mapDepthM": 1.0,
            "magMedian": 0.0,
            "magSigma": 1.0,
            "anomalies": [],
            "candidates": [],
            "metals": [],
            "passEstimate": 1,
            "scanStepCount": 1,
            "scanSegmentCount": 0,
            "scanSteps": [],
            "scanStepInputM": 0.0,
            "scanStepSpacingM": 0.0,
            "uniquePoints": 1,
            "rawPointCount": 1,
            "fingerprint": "analysis-fingerprint",
            "residualPreview": [],
            "gridValues": [],
            "gridCoverage": [],
            "gridOriginXM": 0.0,
            "gridOriginYM": 0.0,
            "gridWidthM": 1.0,
            "gridDepthM": 1.0,
            "invertProxies": []
        })).expect("test LegacyDikResult fixture")
    }

    #[test]
    fn analyze_session_keeps_sensitivity_for_reproducibility() {
        // Eski oturum kayıtları (sensitivity alanı yok) uyumlu kalmalı
        let mut session: AnalyzeSession = serde_json::from_value(json!({
            "imageBase64": "x",
            "fileName": "map.png",
            "lutStripPx": 24,
            "viewMode": "top",
            "minConfidence": 0.45,
            "targetKind": "auto"
        }))
        .expect("eski oturum şeması okunmalı");
        assert_eq!(session.sensitivity, None);

        session.sensitivity = Some(0.55);
        let raw = serde_json::to_string(&session).unwrap();
        let back: AnalyzeSession = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.sensitivity, Some(0.55));
    }

    #[test]
    fn verifies_legacy_archive_hashes_and_detects_tampering() {
        let _guard = ARCHIVE_TEST_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let old_appdata = std::env::var_os("APPDATA");
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("votex-archive-test-{}-{suffix}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::env::set_var("APPDATA", &root);

        let content = r#"{"scan":true}"#;
        let result = test_result();
        let package = json!({
            "schemaVersion": 1,
            "source": { "fingerprint": "source-fingerprint" },
            "analysis": { "fingerprint": "analysis-fingerprint" },
            "derived": { "fieldModel": { "detections": [] } }
        });
        let entry = save_legacy_entry("roundtrip.json", content, &result, Some(&package)).unwrap();
        let loaded = load_legacy_entry(&entry.id).unwrap();
        assert_eq!(loaded.integrity.status, "verified");
        assert!(loaded.integrity.verified);
        assert_eq!(loaded.case_package, Some(package.clone()));
        assert_eq!(loaded.integrity.source_sha256, sha256_hex(content.as_bytes()));

        std::fs::write(archive_dir().join(&entry.id).join("source.json"), "tampered").unwrap();
        let tampered = load_legacy_entry(&entry.id).unwrap();
        assert_eq!(tampered.integrity.status, "mismatch");
        assert!(!tampered.integrity.verified);
        assert!(tampered.case_package.is_some());

        let _ = std::fs::remove_dir_all(&root);
        match old_appdata {
            Some(value) => std::env::set_var("APPDATA", value),
            None => std::env::remove_var("APPDATA"),
        }
    }

    #[test]
    fn attaches_and_verifies_field_report() {
        let _guard = ARCHIVE_TEST_LOCK.get_or_init(|| Mutex::new(())).lock().unwrap();
        let old_appdata = std::env::var_os("APPDATA");
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("votex-archive-test-{}-{suffix}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::env::set_var("APPDATA", &root);

        let content = r#"{"scan":true}"#;
        let result = test_result();
        let package = json!({
            "schemaVersion": 1,
            "source": { "fingerprint": "source-fingerprint" },
            "analysis": { "fingerprint": "analysis-fingerprint" },
            "derived": { "fieldModel": { "detections": [] } }
        });
        let entry = save_legacy_entry("report.json", content, &result, Some(&package)).unwrap();
        assert!(entry.field_report_rel.is_empty());
        assert!(attach_field_report(&entry.id, "   ").is_err());

        let report = "<!doctype html><html><body>saha raporu</body></html>";
        let updated = attach_field_report(&entry.id, report).unwrap();
        assert_eq!(updated.field_report_rel, format!("{}/field_report.html", entry.id));
        assert_eq!(updated.field_report_sha256, sha256_hex(report.as_bytes()));

        let loaded = load_legacy_entry(&entry.id).unwrap();
        assert_eq!(loaded.field_report.as_deref(), Some(report));
        assert_eq!(loaded.integrity.status, "verified");
        assert!(loaded.integrity.verified);
        assert_eq!(loaded.integrity.field_report_sha256, sha256_hex(report.as_bytes()));

        // Rapor dosyası değiştirilirse bütünlük bozulur.
        std::fs::write(archive_dir().join(&entry.id).join("field_report.html"), "tampered").unwrap();
        let tampered = load_legacy_entry(&entry.id).unwrap();
        assert_eq!(tampered.integrity.status, "mismatch");
        assert!(!tampered.integrity.verified);

        // Rapor silinirse metadata eksik dosyayı açıkça bildirir.
        std::fs::remove_file(archive_dir().join(&entry.id).join("field_report.html")).unwrap();
        let missing = load_legacy_entry(&entry.id).unwrap();
        assert_eq!(missing.integrity.status, "missing");
        assert!(missing.field_report.is_none());

        let _ = std::fs::remove_dir_all(&root);
        match old_appdata {
            Some(value) => std::env::set_var("APPDATA", value),
            None => std::env::remove_var("APPDATA"),
        }
    }
}
