//! CSV data import Tauri komutları.

use crate::csv_import;
use tauri::State;
use base64::{engine::general_purpose::STANDARD as B64, Engine};

use super::AppState;

/// CSV import isteği.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportRequest {
    /// CSV dosya içeriği (ham metin)
    pub csv_content: String,
    /// Dosya adı (opsiyonel)
    pub file_name: Option<String>,
    /// Çekim tipi: "top" veya "side"
    #[serde(default = "default_view_mode")]
    pub view_mode: String,
    /// Harita boyutu (metre), varsayılan 24
    #[serde(default = "default_map_size")]
    pub map_size_m: f32,
    /// Derinlik aralığı (metre), varsayılan 15
    #[serde(default = "default_depth_range")]
    pub depth_range_m: f32,
}

fn default_view_mode() -> String {
    "side".into()
}

fn default_map_size() -> f32 {
    24.0
}

fn default_depth_range() -> f32 {
    15.0
}

/// CSV verisini analiz et (önizleme için).
///
/// Sadece parse eder, 3D yüzey oluşturmaz.
#[tauri::command]
pub fn analyze_csv_data(req: CsvImportRequest) -> Result<csv_import::CsvImportResult, String> {
    if req.csv_content.trim().is_empty() {
        return Err("CSV içeriği boş".into());
    }

    let is_excel = req
        .file_name
        .as_deref()
        .map(|n| n.to_lowercase().ends_with(".xlsx") || n.to_lowercase().ends_with(".xls"))
        .unwrap_or(false)
        || req.csv_content.starts_with("data:application/")
        || req.csv_content.contains(";base64,");

    if is_excel {
        let raw = req
            .csv_content
            .split(',')
            .last()
            .unwrap_or(&req.csv_content)
            .trim();
        let bytes = B64
            .decode(raw)
            .map_err(|e| format!("Base64 çözülemedi: {e}"))?;
        csv_import::parse_excel(&bytes)
    } else {
        csv_import::parse_csv(&req.csv_content)
    }
}

/// CSV veya Excel verisinden 3D yüzey oluştur.
#[tauri::command]
pub fn build_surface_from_csv(
    _state: State<'_, AppState>,
    req: CsvImportRequest,
) -> Result<crate::surface::Surface3D, String> {
    if req.csv_content.trim().is_empty() {
        return Err("Veri içeriği boş".into());
    }

    let is_excel = req
        .file_name
        .as_deref()
        .map(|n| n.to_lowercase().ends_with(".xlsx") || n.to_lowercase().ends_with(".xls"))
        .unwrap_or(false)
        || req.csv_content.starts_with("data:application/")
        || req.csv_content.contains(";base64,");

    let csv = if is_excel {
        let raw = req
            .csv_content
            .split(',')
            .last()
            .unwrap_or(&req.csv_content)
            .trim();
        let bytes = B64
            .decode(raw)
            .map_err(|e| format!("Base64 çözülemedi: {e}"))?;
        csv_import::parse_excel(&bytes)?
    } else {
        csv_import::parse_csv(&req.csv_content)?
    };

    if csv.point_count < 4 {
        return Err(format!(
            "Yetersiz veri noktası: {} (en az 4 gerekli)",
            csv.point_count
        ));
    }

    let surface = csv_import::csv_to_surface(
        &csv,
        req.file_name,
        &req.view_mode,
        req.map_size_m,
        req.depth_range_m,
    )?;

    Ok(surface)
}

/// CSV dosyasını oku ve analiz et (native dosya diyalogu ile).
#[tauri::command]
pub fn pick_csv_file() -> Result<Option<super::dto::PickedCsvFile>, String> {
    let path = rfd::FileDialog::new()
        .set_title("Votex — Veri Dosyası Seç (CSV veya Excel)")
        .add_filter("Veri Dosyası", &["csv", "tsv", "txt", "xlsx", "xls"])
        .pick_file();

    let Some(path) = path else {
        return Ok(None);
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("data.csv")
        .to_string();

    if ext == "xlsx" || ext == "xls" {
        // Excel dosyası — binary oku ve base64 olarak döndür
        let bytes = std::fs::read(&path)
            .map_err(|e| format!("Dosya okunamadı: {e}"))?;
        if bytes.is_empty() {
            return Err("Dosya boş".into());
        }
        let b64 = B64.encode(&bytes);
        Ok(Some(super::dto::PickedCsvFile {
            file_name,
            content: format!("data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,{b64}"),
        }))
    } else {
        // CSV/TSV/TXT — metin olarak oku
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Dosya okunamadı: {e}"))?;
        if content.is_empty() {
            return Err("Dosya boş".into());
        }
        Ok(Some(super::dto::PickedCsvFile {
            file_name,
            content,
        }))
    }
}

/// Excel bytes'larını parse et (base64 decode edilmiş).
#[tauri::command]
pub fn parse_excel_data(base64_content: String) -> Result<csv_import::CsvImportResult, String> {
    let raw = base64_content
        .split(',')
        .last()
        .unwrap_or(&base64_content)
        .trim();
    let bytes = B64
        .decode(raw)
        .map_err(|e| format!("Base64 çözülemedi: {e}"))?;
    csv_import::parse_excel(&bytes)
}

/// Legacy3DMag dik çekim JSON — anomali + olası yapı şekilleri (CSV yolundan ayrı).
#[tauri::command]
pub fn analyze_legacy_dik_json(
    content: String,
    file_name: Option<String>,
    scan_step_count: Option<u32>,
    scan_step_spacing_m: Option<f32>,
    depth_params: Option<crate::legacy_mag_json::LegacyDepthParams>,
) -> Result<crate::legacy_mag_json::LegacyDikResult, String> {
    if content.trim().is_empty() {
        return Err("JSON içeriği boş".into());
    }
    if !crate::legacy_mag_json::looks_like_legacy_dik(content.as_str(), file_name.as_deref()) {
        return Err(format!(
            "Bu dosya Legacy3DMag dik çekim formatında değil{}",
            file_name
                .as_deref()
                .map(|n| format!(" ({n})"))
                .unwrap_or_default()
        ));
    }
    if scan_step_count.unwrap_or(0) > 10000 {
        return Err("Adım sayısı 10000 değerinden büyük olamaz".into());
    }
    if let Some(spacing) = scan_step_spacing_m {
        if !spacing.is_finite() || spacing <= 0.0 || spacing > 1000.0 {
            return Err("Yatay adım ölçüsü 0'dan büyük ve 1000 m'den küçük olmalıdır".into());
        }
    }
    let params = depth_params
        .unwrap_or_else(|| crate::app_settings::load_settings().legacy_depth_params)
        .clamped();
    crate::legacy_mag_json::analyze_legacy_dik_with_options(
        &content,
        scan_step_count,
        scan_step_spacing_m,
        params,
    )
}

/// Legacy dik JSON — Zero-Order Median Leveling (heading-error / zig-zag striping).
#[tauri::command]
pub fn level_legacy_mag_json(
    content: String,
) -> Result<crate::legacy_mag_json::LegacyLevelResult, String> {
    if content.trim().is_empty() {
        return Err("JSON içeriği boş".into());
    }
    crate::legacy_mag_json::level_legacy_mag_json(&content)
}

/// Legacy dik JSON dosyası seç.
#[tauri::command]
pub fn pick_legacy_dik_json() -> Result<Option<super::dto::PickedCsvFile>, String> {
    let path = rfd::FileDialog::new()
        .set_title("Votex — Dik çekim (Legacy3DMag JSON)")
        .add_filter("Legacy dik JSON", &["json"])
        .add_filter("Tüm dosyalar", &["*"])
        .pick_file();

    let Some(path) = path else {
        return Ok(None);
    };

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("legacy_dik.json")
        .to_string();

    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Dosya okunamadı: {e}"))?;
    if content.trim().is_empty() {
        return Err("Dosya boş".into());
    }
    if !crate::legacy_mag_json::looks_like_legacy_dik(&content, Some(&file_name)) {
        return Err(
            "Bu dosya Legacy3DMag dik çekim formatında görünmüyor (metadata + scan gerekli)"
                .into(),
        );
    }
    Ok(Some(super::dto::PickedCsvFile { file_name, content }))
}
