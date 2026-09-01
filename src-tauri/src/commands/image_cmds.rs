//! Image upload / 3D surface Tauri commands.

use crate::capture::{self, CapturedFrame, Roi};
use crate::vision;
use tauri::{AppHandle, Emitter, State};

use super::dto::{
    decode_image_bytes, AnalyzeImageRequest, AnalyzeImageResponse, PickedImage,
    SensorFramePayload,
};
use super::{AnalyzeSession, AppState};

/// Yuklenen PNG/JPG/JPEG haritasini LUT + renk eslestirme ile analiz et.
#[tauri::command]
pub fn analyze_uploaded_image(
    app: AppHandle,
    req: AnalyzeImageRequest,
) -> Result<AnalyzeImageResponse, String> {
    let raw = decode_image_bytes(&req.image_base64)?;
    let (cleaned, _crop) = crate::preprocess::clean_elic_screenshot(&raw)?;
    let width = cleaned.width();
    let height = cleaned.height();
    let original_base64_png = capture::png_data_url(&cleaned)?;

    let analysis = vision::analyze_colormap_image(
        &cleaned,
        req.lut_strip_px.unwrap_or(24),
        req.min_area.unwrap_or(80),
        0.35,
    )?;

    let response = AnalyzeImageResponse {
        file_name: req.file_name,
        width,
        height,
        original_base64_png,
        analysis,
    };

    let payload = SensorFramePayload {
        frame: CapturedFrame {
            base64_png: response.original_base64_png.clone(),
            width,
            height,
            roi: Roi {
                x: 0,
                y: 0,
                width,
                height,
            },
        },
        analysis: Some(response.analysis.clone()),
    };
    let _ = app.emit("sensor-frame", &payload);

    Ok(response)
}

/// Yuklenen colormap → 3D yüzey (heightmap + renkler).
#[tauri::command]
pub fn build_surface_3d(
    state: State<'_, AppState>,
    req: AnalyzeImageRequest,
) -> Result<crate::surface::Surface3D, String> {
    crate::license::check_and_record_upload()?;
    let map_id = crate::hint_store::map_fingerprint(&req.image_base64)?;
    let img = decode_image_bytes(&req.image_base64)?;
    let view_mode = req.view_mode.as_deref().unwrap_or("side").to_string();
    let min_confidence = req.min_confidence.unwrap_or(0.45);
    let target_kind = req.target_kind.as_deref().unwrap_or("auto").to_string();
    let lut = req.lut_strip_px.unwrap_or(24);

    // İstek ipuçları varsa state'e yaz; yoksa bu haritanın kayıtlı ipuçları
    let explicit_hints = req.dta_hints.is_some();
    let hints = if let Some(h) = req.dta_hints {
        let mut guard = state.dta_hints.lock().map_err(|e| e.to_string())?;
        *guard = h;
        guard.clone()
    } else {
        crate::hint_store::activate_map_hints(&state, &map_id)?
    };
    if explicit_hints {
        let _ = crate::hint_store::save_hints_for_map(
            &map_id,
            req.file_name.as_deref(),
            &hints,
        );
        if let Ok(mut mid) = state.dta_hints_map_id.lock() {
            *mid = Some(map_id.clone());
        }
    }

    let settings = crate::app_settings::load_settings();
    let soil_id = req
        .soil_profile
        .as_deref()
        .unwrap_or(settings.soil_profile.as_str());
    let soil = crate::soil_profile::resolve_params(soil_id, settings.soil_correction_enabled);

    let surface = crate::surface::colormap_to_surface(
        &img,
        lut,
        192,
        req.file_name.clone(),
        &view_mode,
        min_confidence,
        &target_kind,
        &hints,
        &soil,
        false,
        false,
    )?;

    {
        let mut session = state.last_session.lock().map_err(|e| e.to_string())?;
        *session = Some(AnalyzeSession {
            image_base64: req.image_base64.clone(),
            file_name: req.file_name.clone(),
            lut_strip_px: lut,
            view_mode: view_mode.clone(),
            min_confidence,
            target_kind: target_kind.clone(),
            soil_profile: soil.id.clone(),
        });
    }

    let _ = crate::session_persist::save_work(
        state
            .last_session
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .as_ref(),
        &hints,
        Some(&surface),
    );

    // Otomatik arşiv — hata analizi bozmaz
    {
        let session = AnalyzeSession {
            image_base64: req.image_base64.clone(),
            file_name: req.file_name.clone(),
            lut_strip_px: lut,
            view_mode: view_mode.clone(),
            min_confidence,
            target_kind: target_kind.clone(),
            soil_profile: soil.id.clone(),
        };
        match crate::archive::save_entry(&session, &surface, &hints) {
            Ok(entry) => eprintln!(
                "[votex] arşiv kaydedildi · {} · {}",
                entry.id, entry.file_name
            ),
            Err(e) => eprintln!("[votex] arşiv kayıt hatası: {e}"),
        }
    }

    Ok(surface)
}

/// Windows native dosya diyalogu — HTML input Tauri'de açılmayabilir.
#[tauri::command]
pub fn pick_image_file() -> Result<Option<PickedImage>, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};

    let path = rfd::FileDialog::new()
        .set_title("Votex — Anomali Haritası Seç")
        .add_filter("Görüntü (JPG, PNG)", &["jpg", "jpeg", "png"])
        .pick_file();

    let Some(path) = path else {
        return Ok(None);
    };

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png") {
        return Err("Sadece JPG, JPEG veya PNG seçin".into());
    }

    let bytes = std::fs::read(&path).map_err(|e| format!("Dosya okunamadı: {e}"))?;
    if bytes.is_empty() {
        return Err("Dosya boş".into());
    }

    let mime = if ext == "png" {
        "image/png"
    } else {
        "image/jpeg"
    };
    let b64 = B64.encode(&bytes);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(if ext == "png" { "map.png" } else { "map.jpg" })
        .to_string();

    Ok(Some(PickedImage {
        file_name,
        image_base64: format!("data:{mime};base64,{b64}"),
        size_bytes: bytes.len() as u64,
    }))
}
