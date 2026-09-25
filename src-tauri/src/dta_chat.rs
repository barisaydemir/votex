//! DTA ↔ VOTEX sohbet halkası (localhost köprüsü üzerinden).
//!
//! Konuşma verisi bugüne kadar yalnızca DTA'nın kendi ekran log'unda kalıyordu;
//! bu modül, köprüye gelen konuşma turlarını kısa bir halka bellekte tutar ve
//! VOTEX paneli ile DTA poller'ı arasında paylaştırır.
//!
//! Uçlar (dta_bridge.rs tarafından serve edilir):
//! - POST /dta/chat          → DTA konuşma turu iter (kullanıcı + asistan yanıtı)
//! - GET  /dta/chat/pending  → DTA, VOTEX panelinden yazılan mesajları çeker
//! - GET  /dta/chat/since?cursor=N → VOTEX paneli yeni turları çeker
//!
//! Halka bellek: son 100 tur; kimlik doğrulama yok (localhost'a bind; mevcut
//! /guide ucuyla aynı güven modeli).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// Halka bellekte tutulan maksimum tur sayısı.
const MAX_TURNS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurn {
    pub id: u64,
    /// user | assistant | system
    pub role: String,
    #[serde(default)]
    pub text: String,
    /// unix ms — DTA gönderirse kullanılır, yoksa köprü alım anını yazar
    #[serde(default)]
    pub ts: u64,
    /// Diagnostik eki (kuyruk gecikmesi, arka plan notu vb.); kısa tutulur
    #[serde(default)]
    pub meta: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPostRequest {
    #[serde(default)]
    pub turns: Vec<ChatTurnIn>,
    /// VOTEX panelinden gelen mesajları "işlendi" olarak işaretle (cursor)
    #[serde(default)]
    pub ack_cursor: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnIn {
    pub role: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub ts: u64,
    #[serde(default)]
    pub meta: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPostResponse {
    pub ok: bool,
    pub accepted: usize,
    pub last_id: u64,
    /// DTA'nın henüz çekmediği panel mesajları (outbox)
    pub pending: Vec<ChatTurn>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSinceResponse {
    pub ok: bool,
    pub cursor: u64,
    pub turns: Vec<ChatTurn>,
    /// DTA canlı mı (son temas ≤ 180 sn)
    pub dta_online: bool,
}

#[derive(Default)]
pub struct ChatRing {
    inner: Mutex<ChatRingInner>,
}

#[derive(Default)]
struct ChatRingInner {
    turns: Vec<ChatTurn>,
    next_id: AtomicU64Alias,
    /// VOTEX panelinden DTA'ya giden mesajlar; DTA poller ack'leyene kadar durur
    outbox: Vec<ChatTurn>,
    /// DTA'nın son ack'lediği panel mesajı id'si
    last_ack: u64,
}

/// Default türetilemediği için AtomicU64'ü sarmalıyoruz.
#[derive(Default)]
struct AtomicU64Alias(AtomicU64);

impl ChatRing {
    fn push(&self, incoming: Vec<ChatTurnIn>) -> (usize, u64) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let mut accepted = 0usize;
        let mut last_id = g.next_id.0.load(Ordering::Relaxed);
        for turn in incoming {
            let text = turn.text.trim();
            if text.is_empty() && turn.meta.as_deref().unwrap_or("").trim().is_empty() {
                continue; // boş turu yut
            }
            let id = g.next_id.0.fetch_add(1, Ordering::Relaxed) + 1;
            last_id = id;
            let ts = if turn.ts > 0 {
                turn.ts
            } else {
                now_ms()
            };
            g.turns.push(ChatTurn {
                id,
                role: sanitize_role(&turn.role),
                text: text.chars().take(2000).collect(),
                ts,
                meta: turn
                    .meta
                    .map(|m| m.chars().take(200).collect::<String>()),
            });
            accepted += 1;
        }
        if g.turns.len() > MAX_TURNS {
            let drop = g.turns.len() - MAX_TURNS;
            g.turns.drain(0..drop);
        }
        (accepted, last_id)
    }

    fn ack(&self, cursor: u64) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let threshold = g.last_ack.max(cursor);
        g.outbox.retain(|t| t.id > threshold);
        g.last_ack = threshold;
    }

    pub fn pending(&self) -> Vec<ChatTurn> {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.outbox.clone()
    }

    /// VOTEX panelinden DTA'ya mesaj ekler; id döner.
    pub fn push_outbox(&self, text: &str) -> u64 {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let id = g.next_id.0.fetch_add(1, Ordering::Relaxed) + 1;
        g.outbox.push(ChatTurn {
            id,
            role: "user".into(),
            text: text.chars().take(2000).collect(),
            ts: now_ms(),
            meta: Some("panel".into()),
        });
        if g.outbox.len() > MAX_TURNS {
            let drop = g.outbox.len() - MAX_TURNS;
            g.outbox.drain(0..drop);
        }
        id
    }

    /// Pencere gizle/geri getir isteği; DTA poller'ı sistem mesajı olarak çeker.
    pub fn push_window_request(&self, action: &str) -> u64 {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let id = g.next_id.0.fetch_add(1, Ordering::Relaxed) + 1;
        g.outbox.push(ChatTurn {
            id,
            role: "system".into(),
            text: format!("__window_{action}__"),
            ts: now_ms(),
            meta: Some("window".into()),
        });
        if g.outbox.len() > MAX_TURNS {
            let drop = g.outbox.len() - MAX_TURNS;
            g.outbox.drain(0..drop);
        }
        id
    }

    fn since(&self, cursor: u64) -> Vec<ChatTurn> {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.turns.iter().filter(|t| t.id > cursor).cloned().collect()
    }

    fn latest_cursor(&self) -> u64 {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.turns
            .last()
            .map(|t| t.id)
            .unwrap_or_else(|| g.next_id.0.load(Ordering::Relaxed))
    }
}

fn sanitize_role(role: &str) -> String {
    match role.trim().to_ascii_lowercase().as_str() {
        "user" | "kullanici" | "kullanıcı" => "user".into(),
        "system" => "system".into(),
        _ => "assistant".into(),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn new_ring() -> ChatRing {
    ChatRing::default()
}

pub fn handle_chat_post(ring: &ChatRing, body: &str) -> Result<ChatPostResponse, String> {
    let req: ChatPostRequest =
        serde_json::from_str(body).map_err(|e| format!("chat JSON: {e}"))?;
    let (accepted, last_id) = ring.push(req.turns);
    if let Some(cursor) = req.ack_cursor {
        ring.ack(cursor);
    }
    Ok(ChatPostResponse {
        ok: true,
        accepted,
        last_id,
        pending: ring.pending(),
    })
}

pub fn handle_chat_since(ring: &ChatRing, cursor: u64, dta_online: bool) -> ChatSinceResponse {
    let turns = ring.since(cursor);
    let next_cursor = turns
        .last()
        .map(|t| t.id)
        .unwrap_or(cursor.max(ring.latest_cursor()));
    ChatSinceResponse {
        ok: true,
        cursor: next_cursor,
        turns,
        dta_online,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_roundtrip_push_and_since() {
        let ring = new_ring();
        let body = r#"{"turns":[{"role":"user","text":"Selam"},{"role":"assistant","text":"Merhaba, saha hazır."}]}"#;
        let resp = handle_chat_post(&ring, body).unwrap();
        assert_eq!(resp.accepted, 2);
        assert_eq!(resp.last_id, 2);

        let since = handle_chat_since(&ring, 0, true);
        assert_eq!(since.turns.len(), 2);
        assert_eq!(since.turns[0].role, "user");
        assert_eq!(since.turns[1].role, "assistant");
        assert!(since.dta_online);
        assert_eq!(since.cursor, 2);

        // cursor'dan sonra yeni tur gelir
        handle_chat_post(&ring, r#"{"turns":[{"role":"assistant","text":"ikinci tur"}]}"#).unwrap();
        let since2 = handle_chat_since(&ring, since.cursor, true);
        assert_eq!(since2.turns.len(), 1);
        assert_eq!(since2.turns[0].text, "ikinci tur");
    }

    #[test]
    fn chat_outbox_ack_flow() {
        let ring = new_ring();
        let id1 = ring.push_outbox("3D'deki ikinci hedef nedir?");
        assert!(id1 > 0);

        // DTA pending çeker + ack gönderir
        let body = format!(r#"{{"turns":[],"ackCursor":{id1}}}"#);
        let resp = handle_chat_post(&ring, &body).unwrap();
        assert!(resp.pending.is_empty());

        // tekrar pending boş
        let resp2 = handle_chat_post(&ring, r#"{"turns":[]}"#).unwrap();
        assert!(resp2.pending.is_empty());
    }

    #[test]
    fn chat_empty_turn_rejected_and_role_normalized() {
        let ring = new_ring();
        let body = r#"{"turns":[{"role":"KULLANICI","text":"  "},{"role":"assistant","text":"ok"}]}"#;
        let resp = handle_chat_post(&ring, body).unwrap();
        assert_eq!(resp.accepted, 1);
        let since = handle_chat_since(&ring, 0, false);
        assert_eq!(since.turns[0].role, "assistant");
        assert!(!since.dta_online);
    }

    #[test]
    fn chat_ring_caps_at_max_turns() {
        let ring = new_ring();
        for i in 0..(MAX_TURNS + 20) {
            let body = format!(r#"{{"turns":[{{"role":"assistant","text":"t{i}"}}]}}"#);
            handle_chat_post(&ring, &body).unwrap();
        }
        let since = handle_chat_since(&ring, 0, true);
        assert_eq!(since.turns.len(), MAX_TURNS);
    }
}
