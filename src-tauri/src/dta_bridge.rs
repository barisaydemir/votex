//! DTA → VOTEX localhost köprüsü (127.0.0.1:18765).
//! POST /guide ile yapı ipuçları enjekte edilir; son harita yeniden hesaplanır.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::Ordering;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{decode_image_bytes, AppState};
use crate::structures::StructureHint;

pub const DTA_BRIDGE_ADDR: &str = "127.0.0.1:18765";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuideRequest {
    #[serde(default)]
    hints: Vec<StructureHint>,
    #[serde(default)]
    clear: bool,
    #[serde(default = "default_true")]
    rebuild: bool,
    /// true: mevcut ipuçlara ekle; false: değiştir
    #[serde(default)]
    append: bool,
    /// true: diske kaydet (varsayılan)
    #[serde(default = "default_true")]
    persist: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuideResponse {
    ok: bool,
    message: String,
    hint_count: usize,
    rebuilt: bool,
    saved: bool,
}

pub fn start_bridge(app: AppHandle) {
    thread::spawn(move || {
        let listener = match TcpListener::bind(DTA_BRIDGE_ADDR) {
            Ok(l) => {
                {
                    let state = app.state::<AppState>();
                    state.bridge_listening.store(true, Ordering::Relaxed);
                }
                eprintln!("[votex] DTA bridge listening on http://{DTA_BRIDGE_ADDR}");
                let _ = app.emit(
                    "dta-bridge",
                    serde_json::json!({
                        "ok": true,
                        "listening": true,
                        "addr": DTA_BRIDGE_ADDR,
                        "message": "DTA köprüsü açık",
                    }),
                );
                l
            }
            Err(e) => {
                eprintln!("[votex] DTA bridge bind failed ({DTA_BRIDGE_ADDR}): {e}");
                let _ = app.emit(
                    "dta-bridge",
                    serde_json::json!({
                        "ok": false,
                        "listening": false,
                        "message": format!("DTA köprü açılamadı: {e}"),
                    }),
                );
                return;
            }
        };
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let app = app.clone();
                    let _ = thread::spawn(move || {
                        if let Err(e) = handle_connection(s, &app) {
                            eprintln!("[votex] DTA bridge request error: {e}");
                        }
                    });
                }
                Err(e) => eprintln!("[votex] DTA bridge accept: {e}"),
            }
        }
    });
}

fn handle_connection(mut stream: std::net::TcpStream, app: &AppHandle) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let mut buf = vec![0u8; 65536];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    if n == 0 {
        return Ok(());
    }
    let raw = String::from_utf8_lossy(&buf[..n]);
    let (method, path, body) = parse_http(&raw)?;

    {
        let state = app.state::<AppState>();
        state.touch_dta_contact();
    }

    let (status, payload) = match (method.as_str(), path.as_str()) {
        ("GET", "/health") | ("GET", "/") => (
            200,
            serde_json::json!({
                "ok": true,
                "service": "votex-dta-bridge",
                "addr": DTA_BRIDGE_ADDR,
            })
            .to_string(),
        ),
        ("GET", "/status") => {
            let state = app.state::<AppState>();
            let hints = state.dta_hints.lock().map_err(|e| e.to_string())?;
            let session = state.last_session.lock().map_err(|e| e.to_string())?;
            (
                200,
                serde_json::json!({
                    "ok": true,
                    "hintCount": hints.len(),
                    "hasSession": session.is_some(),
                    "viewMode": session.as_ref().map(|s| s.view_mode.clone()),
                })
                .to_string(),
            )
        }
        ("POST", "/guide") | ("POST", "/dta/guide") => {
            let req: GuideRequest = serde_json::from_str(body)
                .map_err(|e| format!("guide JSON: {e}"))?;
            match apply_guide(app, req) {
                Ok(resp) => (200, serde_json::to_string(&resp).unwrap_or_else(|_| "{}".into())),
                Err(e) => (
                    400,
                    serde_json::json!({"ok": false, "message": e}).to_string(),
                ),
            }
        }
        ("OPTIONS", _) => (204, String::new()),
        _ => (
            404,
            serde_json::json!({"ok": false, "message": "not found"}).to_string(),
        ),
    };

    write_response(&mut stream, status, &payload)
}

fn apply_guide(app: &AppHandle, req: GuideRequest) -> Result<GuideResponse, String> {
    let state = app.state::<AppState>();
    {
        let mut hints = state.dta_hints.lock().map_err(|e| e.to_string())?;
        if req.clear {
            hints.clear();
        } else if req.append {
            hints.extend(req.hints);
        } else {
            *hints = req.hints;
        }
    }

    let hint_count = state
        .dta_hints
        .lock()
        .map(|h| h.len())
        .unwrap_or(0);
    state
        .dta_last_hint_count
        .store(hint_count as u64, Ordering::Relaxed);
    state.touch_dta_contact();

    // İpuçları yalnızca aktif haritaya yaz
    if req.persist {
        if let Ok(session) = state.last_session.lock() {
            if let Some(ref s) = *session {
                if let Ok(map_id) = crate::hint_store::map_fingerprint(&s.image_base64) {
                    let hints_snap = state
                        .dta_hints
                        .lock()
                        .map(|h| h.clone())
                        .unwrap_or_default();
                    let _ = crate::hint_store::save_hints_for_map(
                        &map_id,
                        s.file_name.as_deref(),
                        &hints_snap,
                    );
                    if let Ok(mut mid) = state.dta_hints_map_id.lock() {
                        *mid = Some(map_id);
                    }
                }
            }
        }
    }

    if !req.rebuild {
        let saved = if req.persist {
            let session = state.last_session.lock().ok().and_then(|g| g.clone());
            let hints_snap: Vec<StructureHint> = state
                .dta_hints
                .lock()
                .map(|h| h.clone())
                .unwrap_or_default();
            crate::session_persist::save_work(session.as_ref(), &hints_snap, None).is_ok()
        } else {
            false
        };
        let _ = app.emit(
            "dta-guide",
            serde_json::json!({
                "ok": true,
                "hintCount": hint_count,
                "surface": null,
                "saved": saved,
                "message": "İpuçları kaydedildi; yeniden hesaplama yok",
            }),
        );
        return Ok(GuideResponse {
            ok: true,
            message: "hints stored".into(),
            hint_count,
            rebuilt: false,
            saved,
        });
    }

    let session = {
        let guard = state.last_session.lock().map_err(|e| e.to_string())?;
        guard.clone().ok_or_else(|| {
            "VOTEX'te henüz analiz yok — önce harita yükleyip 3D oluşturun".to_string()
        })?
    };

    let hints_snap: Vec<StructureHint> = state
        .dta_hints
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let img = decode_image_bytes(&session.image_base64)?;
    let settings = crate::app_settings::load_settings();
    let soil_params = crate::soil_profile::resolve_params(
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
        &hints_snap,
        &soil_params,
        false,
        false,
    )?;

    let saved = if req.persist {
        crate::session_persist::save_work(Some(&session), &hints_snap, Some(&surface)).is_ok()
    } else {
        false
    };

    let _ = app.emit(
        "dta-guide",
        serde_json::json!({
            "ok": true,
            "hintCount": hint_count,
            "message": format!("DTA yönlendirdi · {hint_count} ipucu · kayıt={}", if saved { "evet" } else { "hayır" }),
            "surface": surface,
            "saved": saved,
        }),
    );

    Ok(GuideResponse {
        ok: true,
        message: format!("rebuilt with {hint_count} hints"),
        hint_count,
        rebuilt: true,
        saved,
    })
}

fn parse_http(raw: &str) -> Result<(String, String, &str), String> {
    let (head, body) = raw
        .split_once("\r\n\r\n")
        .or_else(|| raw.split_once("\n\n"))
        .ok_or_else(|| "invalid HTTP".to_string())?;
    let first = head.lines().next().unwrap_or("");
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_string();
    let path = parts
        .next()
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    Ok((method, path, body))
}

fn write_response(stream: &mut std::net::TcpStream, status: u16, body: &str) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(header.as_bytes())
        .and_then(|_| stream.write_all(body.as_bytes()))
        .map_err(|e| e.to_string())?;
    Ok(())
}
