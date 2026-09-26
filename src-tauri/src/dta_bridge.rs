//! DTA → VOTEX localhost köprüsü (127.0.0.1:18765).
//! POST /guide ile yapı ipuçları enjekte edilir; son harita yeniden hesaplanır.

use std::net::TcpListener;
use std::sync::atomic::Ordering;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::commands::{decode_image_bytes, AppState};
use crate::structures::StructureHint;
use crate::dta_chat;
use crate::dta_chat::ChatRing;
use votex_prob::http;

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
    let buf = http::read_request(&mut stream)?;
    if buf.is_empty() {
        return Ok(());
    }
    let raw = String::from_utf8_lossy(&buf);
    let (method, path, body) = parse_http(&raw)?;

    {
        let state = app.state::<AppState>();
        state.touch_dta_contact();
    }

    let ring = app.state::<ChatRing>();
    let (dta_online, window_hidden) = {
        let state = app.state::<AppState>();
        let last_ms = state.dta_last_contact_ms.load(Ordering::Relaxed);
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let online = last_ms > 0 && now_ms >= last_ms && (now_ms - last_ms) <= 180_000;
        (online, state.dta_window_hidden.load(Ordering::Relaxed))
    };
    if let Some((status, payload)) =
        dispatch_chat_routes(&method, &path, &body, &raw, &ring, dta_online, window_hidden)
    {
        return write_response(&mut stream, status, &payload);
    }

    let (status, payload) = match (method.as_str(), path.as_str()) {
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
        ("GET", "/dta/window") => {
            // DTA pencere durumu: DTA chat poller'ı GET /dta/chat/pending çektiğinde
            // pending boşsa da bu uca bakar; state buradan sorgulanır.
            let state = app.state::<AppState>();
            let hidden = state.dta_window_hidden.load(Ordering::Relaxed);
            let resp = serde_json::json!({
                "ok": true,
                "hidden": hidden,
            });
            (200, resp.to_string())
        }
        ("POST", "/dta/window/hide") | ("POST", "/dta/window/restore") => {
            // Panel → DTA pencere isteği: outbox'a sistem mesajı yazılır;
            // DTA chat poller'ı çekip ui callback'ini tetikler.
            let action = if path.ends_with("/hide") { "hide" } else { "restore" };
            let state = app.state::<AppState>();
            let ring = app.state::<ChatRing>();
            let id = ring.push_window_request(action);
            state
                .dta_window_hidden
                .store(action == "hide", Ordering::Relaxed);
            let pending = ring.pending();
            let resp = serde_json::json!({
                "ok": true,
                "action": action,
                "lastId": id,
                "pending": pending,
            });
            (200, resp.to_string())
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

/// POST /dta/chat gövdesini halka şekline çevirir: düz/panel şekli
/// {"text": "..."} → {"turns":[{role, text, meta:"panel"}]}. Aksi halde
/// handle_chat_post turns=0 ile sessiz ok döndürüyor ve mesaj halkaya
/// hiç düşmüyordu (assistant yanıtının gelmemesinin kök nedeni).
fn chat_body_to_effective(body: &str) -> String {
    let body_value: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let plain_text = body_value
        .as_ref()
        .and_then(|v| {
            v.get("text")
                .and_then(|t| t.as_str().map(String::from))
                .or_else(|| v.as_str().map(String::from))
        })
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    match plain_text {
        Some(text) => serde_json::json!({
            "turns": [{"role": "user", "text": text, "meta": "panel"}]
        })
        .to_string(),
        None => body.to_string(),
    }
}

/// Sohbet/yardımcı uçların saf (AppHandle'sız) yönlendirmesi; birim test
/// edilebilirlik için ayrıştırıldı. Sahip olmadığı uçlarda None döner
/// (/status, /guide, /dta/guide, /dta/window* — çağıran halleder).
fn dispatch_chat_routes(
    method: &str,
    path: &str,
    body: &str,
    raw: &str,
    ring: &ChatRing,
    dta_online: bool,
    window_hidden: bool,
) -> Option<(u16, String)> {
    let (status, payload) = match (method, path) {
        ("GET", "/health") | ("GET", "/") => (
            200,
            serde_json::json!({
                "ok": true,
                "service": "votex-dta-bridge",
                "addr": DTA_BRIDGE_ADDR,
            })
            .to_string(),
        ),
        ("POST", "/dta/chat/outbox") => {
            // Panel → DTA mesajı (send_dta_panel_message komutunun HTTP karşılığı;
            // gövde: {"text": "..."} veya düz metin)
            let text = serde_json::from_str::<serde_json::Value>(body)
                .ok()
                .and_then(|v| {
                    v.get("text")
                        .and_then(|t| t.as_str().map(String::from))
                        .or_else(|| v.as_str().map(String::from))
                })
                .unwrap_or_else(|| body.trim().to_string());
            let trimmed = text.trim();
            if trimmed.is_empty() {
                (400, serde_json::json!({"ok": false, "message": "text bos"}).to_string())
            } else {
                let id = ring.push_outbox(trimmed);
                let pending = ring.pending();
                let resp = serde_json::json!({
                    "ok": true,
                    "accepted": 1,
                    "lastId": id,
                    "pending": pending,
                });
                (200, resp.to_string())
            }
        }
        ("POST", "/dta/chat") | ("POST", "/chat") => {
            let effective_body = chat_body_to_effective(body);
            match dta_chat::handle_chat_post(ring, &effective_body) {
                Ok(resp) => (
                    200,
                    serde_json::to_string(&resp).unwrap_or_else(|_| "{}".into()),
                ),
                Err(e) => (
                    400,
                    serde_json::json!({"ok": false, "message": e}).to_string(),
                ),
            }
        }
        ("GET", "/dta/chat/since") => {
            let cursor = raw
                .split_once('?')
                .and_then(|(_, q)| {
                    q.split('&').find_map(|kv| {
                        let (k, v) = kv.split_once('=')?;
                        (k == "cursor")
                            .then(|| v.parse::<u64>().ok())
                            .flatten()
                    })
                })
                .unwrap_or(0);
            let resp = dta_chat::handle_chat_since(ring, cursor, dta_online, window_hidden);
            (200, serde_json::to_string(&resp).unwrap_or_else(|_| "{}".into()))
        }
        ("GET", "/dta/chat/pending") => {
            let pending = ring.pending();
            let resp = serde_json::json!({
                "ok": true,
                "pending": pending,
            });
            (200, resp.to_string())
        }
        ("OPTIONS", _) => (204, String::new()),
        _ => return None,
    };
    Some((status, payload))
}

fn parse_http(raw: &str) -> Result<(String, String, &str), String> {
    http::parse_http(raw)
}

fn write_response(stream: &mut std::net::TcpStream, status: u16, body: &str) -> Result<(), String> {
    http::write_response(stream, status, body)
}

#[cfg(test)]
mod bridge_tests {
    use super::*;
    use std::net::{Shutdown, TcpListener, TcpStream};
    use std::sync::Arc;
    use std::time::Duration;

    fn req_bytes(method: &str, path: &str, body: &str) -> Vec<u8> {
        format!(
            "{} {} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
            method,
            path,
            body.as_bytes().len(),
            body
        )
        .into_bytes()
    }

    fn socket_pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = TcpStream::connect(addr).unwrap();
        let (server, _) = listener.accept().unwrap();
        (client, server)
    }

    fn parse_req(buf: &[u8]) -> (String, String, String) {
        let raw = String::from_utf8_lossy(buf).into_owned();
        let (method, path, body) = parse_http(&raw).unwrap();
        (method, path, body.to_string())
    }

    // ── read_request ────────────────────────────────────────────────────

    #[test]
    fn read_request_full_request_in_one_segment() {
        let (mut client, mut server) = socket_pair();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let payload = req_bytes("GET", "/health", "");
        client.write_all(&payload).unwrap();
        let buf = http::read_request(&mut server).unwrap();
        assert!(!buf.is_empty());
        let (method, path, body) = parse_req(&buf);
        assert_eq!(method, "GET");
        assert_eq!(path, "/health");
        assert_eq!(body, "");
    }

    #[test]
    fn read_request_completes_body_across_split_segments() {
        let (mut client, mut server) = socket_pair();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let body = r#"{"text":"iki parça gövde"}"#;
        let payload = req_bytes("POST", "/dta/chat", body);
        let split = payload.len() - body.len() / 2; // başlık+gövdenin yarısı / kalanı
        client.write_all(&payload[..split]).unwrap();
        client.flush().unwrap();
        std::thread::sleep(Duration::from_millis(50));
        client.write_all(&payload[split..]).unwrap();
        client.flush().unwrap();
        let buf = http::read_request(&mut server).unwrap();
        let (method, path, got) = parse_req(&buf);
        assert_eq!(method, "POST");
        assert_eq!(path, "/dta/chat");
        assert_eq!(got, body);
    }

    #[test]
    fn read_request_early_client_close_returns_partial() {
        let (mut client, mut server) = socket_pair();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        client
            .write_all(b"POST /dta/chat HTTP/1.1\r\nContent-Length: 100\r\n\r\n{\"text\":")
            .unwrap();
        client.flush().unwrap();
        client.shutdown(Shutdown::Both).unwrap(); // erken kopma — gövde eksik
        let buf = http::read_request(&mut server).unwrap(); // asılmadan eldekiyle dönmeli
        let raw = String::from_utf8_lossy(&buf);
        assert!(raw.contains("Content-Length: 100"));
        assert!(raw.contains("{\"text\":"));
    }

    #[test]
    fn read_request_immediate_close_returns_empty() {
        let (client, mut server) = socket_pair();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        client.shutdown(Shutdown::Both).unwrap();
        let buf = http::read_request(&mut server).unwrap();
        assert!(buf.is_empty());
    }

    #[test]
    fn read_request_get_without_body() {
        let (mut client, mut server) = socket_pair();
        server.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        client
            .write_all(b"GET /dta/chat/pending HTTP/1.1\r\nHost: x\r\n\r\n")
            .unwrap();
        let buf = http::read_request(&mut server).unwrap();
        let (method, path, _) = parse_req(&buf);
        assert_eq!(method, "GET");
        assert_eq!(path, "/dta/chat/pending");
    }

    // ── chat_body_to_effective ──────────────────────────────────────────

    #[test]
    fn text_shape_becomes_panel_turn() {
        let eff = chat_body_to_effective(r#"{"text":"merhaba dünya"}"#);
        let v: serde_json::Value = serde_json::from_str(&eff).unwrap();
        let turns = v["turns"].as_array().unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0]["role"], "user");
        assert_eq!(turns[0]["text"], "merhaba dünya");
        assert_eq!(turns[0]["meta"], "panel");
    }

    #[test]
    fn turns_shape_passes_through() {
        let body = r#"{"turns":[{"role":"assistant","text":"yanıt"}],"ackCursor":7}"#;
        assert_eq!(chat_body_to_effective(body), body);
    }

    #[test]
    fn non_json_body_passes_through() {
        assert_eq!(chat_body_to_effective("düz metin"), "düz metin");
    }

    #[test]
    fn empty_text_is_not_converted() {
        let body = r#"{"text":"   "}"#;
        assert_eq!(chat_body_to_effective(body), body);
    }

    // ── dispatch_chat_routes ────────────────────────────────────────────

    #[test]
    fn options_preflight_returns_204_for_any_path() {
        let ring = dta_chat::new_ring();
        for path in ["/dta/chat", "/dta/window/hide", "/herhangi/yol"] {
            let (status, body) =
                dispatch_chat_routes("OPTIONS", path, "", "", &ring, true, false).unwrap();
            assert_eq!(status, 204);
            assert!(body.is_empty());
        }
    }

    #[test]
    fn unknown_route_reports_none_for_404_fallback() {
        let ring = dta_chat::new_ring();
        assert!(dispatch_chat_routes("GET", "/yok", "", "", &ring, true, false).is_none());
        assert!(dispatch_chat_routes("DELETE", "/dta/chat", "", "", &ring, true, false).is_none());
    }

    #[test]
    fn health_reports_service_and_addr() {
        let ring = dta_chat::new_ring();
        let (status, body) =
            dispatch_chat_routes("GET", "/health", "", "", &ring, true, false).unwrap();
        assert_eq!(status, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["service"], "votex-dta-bridge");
        assert_eq!(v["addr"], DTA_BRIDGE_ADDR);
    }

    #[test]
    fn chat_text_shape_lands_in_ring() {
        let ring = dta_chat::new_ring();
        let (status, body) = dispatch_chat_routes(
            "POST",
            "/dta/chat",
            r#"{"text":"panel mesajı — üğüışçö"}"#,
            "",
            &ring,
            true,
            false,
        )
        .unwrap();
        assert_eq!(status, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["accepted"], 1);

        let (_, since) = dispatch_chat_routes(
            "GET",
            "/dta/chat/since",
            "",
            "/dta/chat/since?cursor=0",
            &ring,
            true,
            false,
        )
        .unwrap();
        let s: serde_json::Value = serde_json::from_str(&since).unwrap();
        let turns = s["turns"].as_array().unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0]["role"], "user");
        assert_eq!(turns[0]["text"], "panel mesajı — üğüışçö");
        assert_eq!(turns[0]["meta"], "panel");
    }

    #[test]
    fn outbox_pending_and_single_ack() {
        let ring = dta_chat::new_ring();
        let (status, body) = dispatch_chat_routes(
            "POST",
            "/dta/chat/outbox",
            r#"{"text":"kuyruk mesajı"}"#,
            "",
            &ring,
            true,
            false,
        )
        .unwrap();
        assert_eq!(status, 200);
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        let last_id = v["lastId"].as_u64().unwrap();
        assert_eq!(v["accepted"], 1);
        assert_eq!(v["pending"].as_array().unwrap().len(), 1);

        let (_, pend) =
            dispatch_chat_routes("GET", "/dta/chat/pending", "", "", &ring, true, false).unwrap();
        let p: serde_json::Value = serde_json::from_str(&pend).unwrap();
        assert_eq!(p["pending"].as_array().unwrap().len(), 1);

        let (status, ack) = dispatch_chat_routes(
            "POST",
            "/dta/chat",
            &format!(r#"{{"turns":[],"ackCursor":{last_id}}}"#),
            "",
            &ring,
            true,
            false,
        )
        .unwrap();
        assert_eq!(status, 200);
        let a: serde_json::Value = serde_json::from_str(&ack).unwrap();
        assert_eq!(a["accepted"], 0);
        assert_eq!(a["pending"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn since_echoes_online_and_hidden_flags() {
        let ring = dta_chat::new_ring();
        let (_, body) = dispatch_chat_routes(
            "GET",
            "/dta/chat/since",
            "",
            "/dta/chat/since?cursor=0",
            &ring,
            true,
            true,
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["dtaOnline"], true);
        assert_eq!(v["windowHidden"], true);
    }

    #[test]
    fn concurrent_chat_posts_share_ring_safely() {
        let ring = Arc::new(dta_chat::new_ring());
        let mut handles = Vec::new();
        for i in 0..8 {
            let ring = Arc::clone(&ring);
            handles.push(std::thread::spawn(move || {
                let body = format!(r#"{{"text":"eşzamanlı {i}"}}"#);
                dispatch_chat_routes("POST", "/dta/chat", &body, "", &ring, true, false).unwrap()
            }));
        }
        let mut accepted_total = 0;
        for h in handles {
            let (status, body) = h.join().unwrap();
            assert_eq!(status, 200);
            let v: serde_json::Value = serde_json::from_str(&body).unwrap();
            accepted_total += v["accepted"].as_u64().unwrap();
        }
        assert_eq!(accepted_total, 8);

        let (_, since) = dispatch_chat_routes(
            "GET",
            "/dta/chat/since",
            "",
            "/dta/chat/since?cursor=0",
            &ring,
            true,
            false,
        )
        .unwrap();
        let s: serde_json::Value = serde_json::from_str(&since).unwrap();
        assert_eq!(s["turns"].as_array().unwrap().len(), 8);
    }

    // ── response_header / parse_http ────────────────────────────────────

    #[test]
    fn content_length_counts_bytes_not_chars() {
        let body = "şı — Türkçe çok baytlı gövde"; // karakter sayısı < bayt sayısı
        let header = http::response_header(200, body);
        let expected = format!("Content-Length: {}", body.as_bytes().len());
        assert!(header.contains(&expected), "header: {header}");
        let char_count = body.chars().count();
        assert_ne!(
            body.as_bytes().len(),
            char_count,
            "test gövdesi çok baytlı olmalı"
        );
        let wrong = format!("Content-Length: {char_count}");
        assert!(!header.contains(&wrong), "header: {header}");
    }

    #[test]
    fn parse_http_supports_bare_lf_fallback() {
        let (method, path, body) = parse_http("GET /x HTTP/1.1\nHost: y\n\nselam").unwrap();
        assert_eq!(method, "GET");
        assert_eq!(path, "/x");
        assert_eq!(body, "selam");
    }
}
