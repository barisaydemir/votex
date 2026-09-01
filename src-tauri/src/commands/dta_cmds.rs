//! DTA başlat / ayar komutları.

use crate::app_settings::{self, AppSettings, AutoLaunchOutcome};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub ok: bool,
    pub message: String,
    pub path: String,
    #[serde(default)]
    pub skipped: bool,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterpretResult {
    pub ok: bool,
    pub message: String,
    pub via: String,
}

#[tauri::command]
pub fn get_app_settings() -> AppSettings {
    app_settings::load_settings()
}

#[tauri::command]
pub fn set_dta_launch_path(path: String) -> Result<AppSettings, String> {
    let resolved = app_settings::resolve_launch_path(&path)?;
    let mut s = app_settings::load_settings();
    s.dta_launch_path = resolved.to_string_lossy().into_owned();
    if let Some(stripped) = s.dta_launch_path.strip_prefix(r"\\?\") {
        s.dta_launch_path = stripped.to_string();
    }
    app_settings::save_settings(&s)?;
    Ok(s)
}

#[tauri::command]
pub fn set_auto_launch_dta(enabled: bool) -> Result<AppSettings, String> {
    let mut s = app_settings::load_settings();
    s.auto_launch_dta = enabled;
    app_settings::save_settings(&s)?;
    Ok(s)
}

#[tauri::command]
pub fn set_soil_profile(profile: String) -> Result<AppSettings, String> {
    let id = crate::soil_profile::profile_id_str(crate::soil_profile::normalize_profile(&profile));
    let mut s = app_settings::load_settings();
    s.soil_profile = id.into();
    app_settings::save_settings(&s)?;
    Ok(s)
}

#[tauri::command]
pub fn set_soil_correction_enabled(enabled: bool) -> Result<AppSettings, String> {
    let mut s = app_settings::load_settings();
    s.soil_correction_enabled = enabled;
    app_settings::save_settings(&s)?;
    Ok(s)
}

/// 3D ipucu topları görünürlüğünü kaydet (uygulama yeniden başlasa da hatırlanır).
#[tauri::command]
pub fn set_hints_3d_visible(enabled: bool) -> Result<AppSettings, String> {
    let mut s = app_settings::load_settings();
    s.hints_3d_visible = enabled;
    app_settings::save_settings(&s)?;
    Ok(s)
}

/// CSV filtre tercihlerini toplu olarak kaydet (yeniden başlasa da hatırlanır).
#[tauri::command]
pub fn set_csv_filter_prefs(
    pool_size: Option<u32>,
    sigma: Option<f64>,
    fit: Option<u32>,
    auto_box: Option<bool>,
    point_size: Option<f64>,
    slice_count: Option<u32>,
    threshold: Option<f64>,
    min_strength: Option<f64>,
    grid_res: Option<u32>,
    underground_only: Option<bool>,
) -> Result<AppSettings, String> {
    let mut s = app_settings::load_settings();
    if let Some(v) = pool_size      { s.csv_pool_size = v; }
    if let Some(v) = sigma          { s.csv_sigma = v.clamp(1.0, 4.0); }
    if let Some(v) = fit            { s.csv_fit = v.clamp(50, 100); }
    if let Some(v) = auto_box       { s.csv_auto_box = v; }
    if let Some(v) = point_size     { s.csv_point_size = v.clamp(0.05, 1.0); }
    if let Some(v) = slice_count    { s.csv_slice_count = v.clamp(1, 16); }
    if let Some(v) = threshold      { s.csv_threshold = v.clamp(0.3, 2.0); }
    if let Some(v) = min_strength   { s.csv_min_strength = v.clamp(0.05, 1.0); }
    if let Some(v) = grid_res       { s.csv_grid_res = v.clamp(8, 64); }
    if let Some(v) = underground_only { s.csv_underground_only = v; }
    app_settings::save_settings(&s)?;
    Ok(s)
}

#[tauri::command]
pub fn set_structures_through_red(
    state: tauri::State<'_, crate::commands::AppState>,
    enabled: bool,
) -> Result<SetStructuresThroughRedResult, String> {
    let mut s = app_settings::load_settings();
    s.structures_through_red = enabled;
    app_settings::save_settings(&s)?;

    let session = state
        .last_session
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let (rebuilt, surface, message) = if let Some(session) = session {
        let hints = state
            .dta_hints
            .lock()
            .map(|h| h.clone())
            .unwrap_or_default();
        let img = crate::commands::decode_image_bytes(&session.image_base64)?;
        let soil = crate::soil_profile::resolve_params(
            session.soil_profile.as_str(),
            s.soil_correction_enabled,
        );
        let surface = crate::surface::colormap_to_surface(
            &img,
            session.lut_strip_px,
            192,
            session.file_name.clone(),
            &session.view_mode,
            session.min_confidence,
            &session.target_kind,
            &hints,
            &soil,
            false,
            false,
        )?;
        let _ = crate::session_persist::save_work(Some(&session), &hints, Some(&surface));
        let msg = if enabled {
            "Kırmızı yapıya engel değil · analiz yenilendi".into()
        } else {
            "Legacy path · kırmızı kesici · analiz yenilendi".into()
        };
        (true, Some(surface), msg)
    } else {
        let msg = if enabled {
            "Kırmızı yapıya engel değil (yeniden Analizi Başlat)".into()
        } else {
            "Legacy: kırmızı path kesebilir (yeniden Analizi Başlat)".into()
        };
        (false, None, msg)
    };

    Ok(SetStructuresThroughRedResult {
        settings: s,
        rebuilt,
        surface,
        message,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetStructuresThroughRedResult {
    pub settings: AppSettings,
    pub rebuilt: bool,
    pub surface: Option<crate::surface::Surface3D>,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepScanResult {
    pub ok: bool,
    pub surface: Option<crate::surface::Surface3D>,
    pub message: String,
}

/// Derin yapı analizi: son oturumu daha gevşek eşiklerle yeniden tarar,
/// ilk geçişte silinen/kaçan yapıları da çizer. Sonuç geri alınabilir
/// (arayüz temel yüzeyi saklar; "Geri Al" onu geri yükler).
#[tauri::command]
pub fn deep_structure_scan(
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<DeepScanResult, String> {
    let session = state
        .last_session
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let Some(session) = session else {
        return Ok(DeepScanResult {
            ok: false,
            surface: None,
            message: "Önce bir harita analiz edin (aktif oturum yok)".into(),
        });
    };

    let settings = app_settings::load_settings();
    let hints = state
        .dta_hints
        .lock()
        .map(|h| h.clone())
        .unwrap_or_default();
    let img = crate::commands::decode_image_bytes(&session.image_base64)?;
    let soil = crate::soil_profile::resolve_params(
        session.soil_profile.as_str(),
        settings.soil_correction_enabled,
    );
    let surface = crate::surface::colormap_to_surface(
        &img,
        session.lut_strip_px,
        192,
        session.file_name.clone(),
        &session.view_mode,
        session.min_confidence,
        &session.target_kind,
        &hints,
        &soil,
        true,
        false,
    )?;
    let s = surface.structures.clone();
    let found = s.chambers.len() + s.tunnels.len() + s.metals.len();
    Ok(DeepScanResult {
        ok: true,
        surface: Some(surface),
        message: format!("Derin analiz · {found} yapı çizildi (geri alınabilir)"),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedScanResult {
    pub ok: bool,
    pub surface: Option<crate::surface::Surface3D>,
    pub message: String,
    pub tier1: u32,
    pub tier2: u32,
}

/// Kademeli Derinlik: son oturumu `staged=true` ile yeniden tarar. Tier-0
/// (güçlü sinyal) çıktısı aynı kalır; zayıf/derin artık sinyaller fizik temelli
/// (1/r^n) daha derin katmanlara (tier>=1) yerleştirilir. Geri alınabilir
/// (arayüz temel yüzeyi saklar; "Geri Al" onu geri yükler).
#[tauri::command]
pub fn staged_depth_scan(
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<StagedScanResult, String> {
    let session = state
        .last_session
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let Some(session) = session else {
        return Ok(StagedScanResult {
            ok: false,
            surface: None,
            message: "Önce bir harita analiz edin (aktif oturum yok)".into(),
            tier1: 0,
            tier2: 0,
        });
    };

    let settings = app_settings::load_settings();
    let hints = state
        .dta_hints
        .lock()
        .map(|h| h.clone())
        .unwrap_or_default();
    let img = crate::commands::decode_image_bytes(&session.image_base64)?;
    let soil = crate::soil_profile::resolve_params(
        session.soil_profile.as_str(),
        settings.soil_correction_enabled,
    );
    let surface = crate::surface::colormap_to_surface(
        &img,
        session.lut_strip_px,
        192,
        session.file_name.clone(),
        &session.view_mode,
        session.min_confidence,
        &session.target_kind,
        &hints,
        &soil,
        false,
        true,
    )?;
    let s = &surface.structures;
    let tier1 = s.chambers.iter().filter(|c| c.tier == 1).count()
        + s.tunnels.iter().filter(|t| t.tier == 1).count();
    let tier2 = s.chambers.iter().filter(|c| c.tier >= 2).count()
        + s.tunnels.iter().filter(|t| t.tier >= 2).count();
    let total_deep = tier1 + tier2;
    let message = if total_deep == 0 {
        "Kademeli derinlik · derin aday bulunamadı".into()
    } else {
        format!("Kademeli derinlik · T1 {tier1}, T2 {tier2} olası derin yapı (geri alınabilir)")
    };
    Ok(StagedScanResult {
        ok: true,
        surface: Some(surface),
        message,
        tier1: tier1 as u32,
        tier2: tier2 as u32,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterScanResult {
    pub ok: bool,
    pub surface: Option<crate::surface::Surface3D>,
    pub message: String,
    pub water_count: u32,
}

/// Su overlay (alias). Tier-0 oda/tunel/metal ayni kalir; yalniz `waters`.
#[tauri::command]
pub fn water_yellow_scan(
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<WaterScanResult, String> {
    water_blue_scan(state)
}

/// Mavi/lacivert/mor negatif + şekil (damar/dağınık) → olası su.
/// Kompakt kutu yapı boşluğu sayılır (red). Kırmızı/sarı komşu = mineral halo.
/// Signed-field / metal pipeline değişmez. Geri alınabilir.
#[tauri::command]
pub fn water_blue_scan(
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<WaterScanResult, String> {
    let session = state
        .last_session
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let Some(session) = session else {
        return Ok(WaterScanResult {
            ok: false,
            surface: None,
            message: "Önce bir harita analiz edin (aktif oturum yok)".into(),
            water_count: 0,
        });
    };

    let settings = app_settings::load_settings();
    let hints = state
        .dta_hints
        .lock()
        .map(|h| h.clone())
        .unwrap_or_default();
    let img = crate::commands::decode_image_bytes(&session.image_base64)?;
    let soil = crate::soil_profile::resolve_params(
        session.soil_profile.as_str(),
        settings.soil_correction_enabled,
    );
    let mut surface = crate::surface::colormap_to_surface(
        &img,
        session.lut_strip_px,
        192,
        session.file_name.clone(),
        &session.view_mode,
        session.min_confidence,
        &session.target_kind,
        &hints,
        &soil,
        false,
        false,
    )?;
    let waters = crate::structures::extract_blue_waters(
        &surface.colors,
        surface.grid_w,
        surface.grid_h,
        surface.map_width_m,
        surface.map_depth_m,
        surface.depth_range_m,
        &surface.structures.chambers,
        &surface.structures.tunnels,
        &surface.structures.metals,
    );
    let n = waters.len() as u32;
    surface.structures.waters = waters;
    let message = if n == 0 {
        "Su tespiti · damar/dağınık mavi-mor adayı yok (şekil filtresi)".into()
    } else {
        format!("Su tespiti · {n} olası su (mavi/mor · şekil · geri alınabilir)")
    };
    Ok(WaterScanResult {
        ok: true,
        surface: Some(surface),
        message,
        water_count: n,
    })
}

#[tauri::command]
pub fn pick_dta_launch_path() -> Result<Option<AppSettings>, String> {
    let path = rfd::FileDialog::new()
        .set_title("DTA başlatıcı seç (launcher.py)")
        .add_filter("DTA launcher", &["py", "bat", "cmd", "vbs", "exe"])
        .add_filter("Tüm dosyalar", &["*"])
        .set_directory(r"C:\surface-z\Surface-z")
        .pick_file();

    let Some(path) = path else {
        return Ok(None);
    };
    let resolved = app_settings::resolve_launch_path(&path.to_string_lossy())?;
    let mut s = app_settings::load_settings();
    s.dta_launch_path = resolved.to_string_lossy().into_owned();
    if let Some(stripped) = s.dta_launch_path.strip_prefix(r"\\?\") {
        s.dta_launch_path = stripped.to_string();
    }
    app_settings::save_settings(&s)?;
    Ok(Some(s))
}

#[tauri::command]
pub fn launch_dta() -> Result<LaunchResult, String> {
    // Manuel: force — ayar kapalı olsa da aç; zaten açıksa atla
    let out = app_settings::try_launch_dta(true)?;
    let s = app_settings::load_settings();
    Ok(LaunchResult {
        ok: out.ok,
        message: out.message,
        path: s.dta_launch_path,
        skipped: out.skipped,
        reason: out.reason,
    })
}

/// DTA Live açıksa kuyruğa yazar; ayrıca DTA Python ile yorum dener.
#[tauri::command]
pub fn interpret_votex_screen() -> Result<InterpretResult, String> {
    let (ok, via, message) = app_settings::request_votex_interpret()?;
    Ok(InterpretResult { ok, via, message })
}

/// Aktif haritanın kayıtlı DTA ipuçları (gösterim + açık/kapalı).
#[tauri::command]
pub fn get_map_dta_hints(
    state: tauri::State<'_, crate::commands::AppState>,
) -> Result<crate::hint_store::MapHintsPanel, String> {
    Ok(crate::hint_store::panel_for_state(&state))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMapHintsEnabledResult {
    pub panel: crate::hint_store::MapHintsPanel,
    pub rebuilt: bool,
    pub surface: Option<crate::surface::Surface3D>,
    pub message: String,
}

/// Bu harita için DTA ipuçlarını aç/kapa; oturum varsa analizi yeniden kurar.
#[tauri::command]
pub fn set_map_dta_hints_enabled(
    state: tauri::State<'_, crate::commands::AppState>,
    enabled: bool,
) -> Result<SetMapHintsEnabledResult, String> {
    let map_id = {
        let panel = crate::hint_store::panel_for_state(&state);
        panel.map_id.ok_or_else(|| {
            "Önce harita yükleyip analiz edin (aktif harita yok)".to_string()
        })?
    };
    crate::hint_store::set_map_hints_enabled(&map_id, enabled)?;
    let hints = crate::hint_store::activate_map_hints(&state, &map_id)?;

    let session = state
        .last_session
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let (rebuilt, surface, message) = if let Some(session) = session {
        let img = crate::commands::decode_image_bytes(&session.image_base64)?;
        let settings = app_settings::load_settings();
        let soil = crate::soil_profile::resolve_params(
            session.soil_profile.as_str(),
            settings.soil_correction_enabled,
        );
        let surface = crate::surface::colormap_to_surface(
            &img,
            session.lut_strip_px,
            192,
            session.file_name.clone(),
            &session.view_mode,
            session.min_confidence,
            &session.target_kind,
            &hints,
            &soil,
            false,
            false,
        )?;
        let _ = crate::session_persist::save_work(Some(&session), &hints, Some(&surface));
        let msg = if enabled {
            format!("DTA ipuçları açık · {} ipucu uygulandı", hints.len())
        } else {
            "DTA ipuçları kapalı · analiz ipuçsuz yenilendi".into()
        };
        (true, Some(surface), msg)
    } else {
        let msg = if enabled {
            "DTA ipuçları açık (yeniden analiz için Analizi Başlat)".into()
        } else {
            "DTA ipuçları kapalı".into()
        };
        (false, None, msg)
    };

    Ok(SetMapHintsEnabledResult {
        panel: crate::hint_store::panel_for_state(&state),
        rebuilt,
        surface,
        message,
    })
}

/// VOTEX setup: arka planda otomatik DTA başlat + UI event.
pub fn spawn_auto_launch_dta(app: AppHandle) {
    std::thread::spawn(move || {
        let payload = match app_settings::try_launch_dta(false) {
            Ok(out) => serde_json::json!({
                "ok": out.ok,
                "skipped": out.skipped,
                "reason": out.reason,
                "message": out.message,
            }),
            Err(e) => serde_json::json!({
                "ok": false,
                "skipped": false,
                "reason": "error",
                "message": e,
            }),
        };
        eprintln!("[votex] dta-auto-launch: {payload}");
        let _ = app.emit("dta-auto-launch", &payload);
    });
}

#[allow(dead_code)]
pub type AutoLaunch = AutoLaunchOutcome;

/// Serbest çizim kontak sonuçlarını StructureHint formatına çevirip dta_hints'e ekle.
/// JS tarafı freeDrawItems'taki contact bantlarını StructureHint'e dönüştürür ve
/// bu komuta gönderir; backend hints listesine ekler.
#[tauri::command]
pub fn add_contact_hints(
    state: tauri::State<'_, crate::commands::AppState>,
    hints: Vec<crate::structures::StructureHint>,
) -> Result<usize, String> {
    if hints.is_empty() {
        return Ok(0);
    }
    let mut guard = state.dta_hints.lock().map_err(|e| e.to_string())?;
    let before = guard.len();
    guard.extend(hints);
    let added = guard.len() - before;
    Ok(added)
}

/// Mevcut yapısal analiz sonuçları için kural tabanlı rapor üret.
/// Frontend her oda/tünel tespiti için bu komutu çağırarak insancıl rapor alır.
#[tauri::command]
pub fn generate_analysis_reports(
    chambers: Vec<crate::surface::Chamber>,
    tunnels: Vec<crate::surface::Tunnel>,
    metals: Vec<crate::surface::MetalBody>,
    vpe_decisions: Option<crate::prob_client::DecisionBatch>,
) -> Result<crate::structures::analysis_report::FullReport, String> {
    use crate::structures::analysis_report::generate_full_report;
    Ok(generate_full_report(&chambers, &tunnels, &metals, vpe_decisions.as_ref()))
}

/// Yerel dosya kaydetme diyalogu — Tauri WebView'da programatik indirme
/// çalışmadığı için native save dialog kullanılır.
///
/// `content` metin (HTML) veya base64 data URL (data:image/png;base64,...) olabilir.
/// data URL ise otomatik olarak decode edilip binary olarak yazılır.
#[tauri::command]
pub fn save_file_dialog(
    content: String,
    suggested_name: String,
    filter_name: String,
    filter_exts: Vec<String>,
) -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new()
        .set_title(&format!("Votex — {} kaydet", filter_name))
        .add_filter(&filter_name, &filter_exts.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .set_file_name(&suggested_name)
        .save_file();

    match path {
        Some(p) => {
            // Base64 data URL kontrolü: data:image/png;base64,iVBOR...
            if content.starts_with("data:") && content.contains(",") {
                // data URL'den base64 kısmını çıkar
                let b64_part = content
                    .split(',')
                    .nth(1)
                    .unwrap_or("");
                use base64::Engine;
                let decoded = base64::engine::general_purpose::STANDARD
                    .decode(b64_part)
                    .map_err(|e| format!("Base64 decode hatası: {e}"))?;
                std::fs::write(&p, &decoded)
                    .map_err(|e| format!("Dosya yazma hatası: {e}"))?;
            } else {
                std::fs::write(&p, content.as_bytes())
                    .map_err(|e| format!("Dosya yazma hatası: {e}"))?;
            }
            Ok(Some(p.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}
