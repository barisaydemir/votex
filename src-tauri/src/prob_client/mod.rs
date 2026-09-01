//! VOTEX → VotexProb localhost istemcisi (127.0.0.1:18766).
//! Faz A: health / policy / decide stub; yapı matematiği legacy'de kalır.

mod launch;
mod schema;

pub use launch::{spawn_auto_launch_prob, try_launch_prob};
pub use schema::{
    BlobDto, DecisionBatch, EvidenceBatch, HealthResponse, PairPath, ProbEngineStatus, VoidDecision, SCHEMA_VERSION,
};
#[cfg(test)]
pub use schema::{DecisionReport, MetalDecision};

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

pub const PROB_BRIDGE_ADDR: &str = "127.0.0.1:18766";
const TIMEOUT: Duration = Duration::from_millis(2500);
/// Bağlantı kurma zaman aşımı: motor kapalıyken (SYN düşürülüyor) `connect` varsayılan
/// olarak ~2s bekleyebilir. Probe'un analiz/UI'ı kilitlememesi için kısa tutulur.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
/// Olumsuz probe sonucunun önbellekte kalma süresi. Motor kapalıyken her probe ağa
/// gider; kısa TTL ile analiz ve UI status'u ölü porta tekrar tekrar takılmaz.
const PROBE_NEG_TTL: Duration = Duration::from_millis(1200);

static PROBE_NEG_CACHE: OnceLock<Mutex<Option<(Instant, ProbEngineStatus)>>> = OnceLock::new();

/// Motor canlı mı?
pub fn health() -> Result<HealthResponse, String> {
    let raw = http_get("/health")?;
    serde_json::from_str(&raw).map_err(|e| format!("health parse: {e}"))
}

pub fn get_policy() -> Result<serde_json::Value, String> {
    let raw = http_get("/v1/policy")?;
    serde_json::from_str(&raw).map_err(|e| format!("policy parse: {e}"))
}

pub fn set_policy(policy_id: &str) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({ "policyId": policy_id });
    let raw = http_post("/v1/policy", &body.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("policy parse: {e}"))
}

/// Faz A: stub decide — cevap uygulanmaz; bağlantı/parite için.
pub fn decide(batch: &EvidenceBatch) -> Result<DecisionBatch, String> {
    let body = serde_json::to_string(batch).map_err(|e| e.to_string())?;
    let raw = http_post("/v1/decide", &body)?;
    let dec: DecisionBatch = serde_json::from_str(&raw).map_err(|e| format!("decide parse: {e}"))?;
    if dec.schema_version != SCHEMA_VERSION && !dec.schema_version.is_empty() {
        // şimdilik uyarı; yine de döndür
        eprintln!(
            "[votex] VPE schema {} ≠ {} — fallback tercih edilebilir",
            dec.schema_version, SCHEMA_VERSION
        );
    }
    Ok(dec)
}

pub fn probe_status() -> ProbEngineStatus {
    // Motor kapalıyken bağlantı girişimi CONNECT_TIMEOUT kadar sürebilir; olumsuz
    // sonucu PROBE_NEG_TTL süreyle önbellekle (OnceLock + Mutex, panik yok).
    if let Some(cache) = PROBE_NEG_CACHE.get() {
        if let Ok(guard) = cache.lock() {
            if let Some((at, st)) = guard.as_ref() {
                if !st.online && at.elapsed() < PROBE_NEG_TTL {
                    return st.clone();
                }
            }
        }
    }
    let st = match health() {
        Ok(h) => ProbEngineStatus {
            online: h.ok,
            version: h.version,
            policy_id: h.policy_id,
            phase: h.phase.clone(),
            addr: PROB_BRIDGE_ADDR.into(),
            label: if h.ok {
                format!("VPE bağlı · {}", h.phase)
            } else {
                "VPE yanıt geçersiz".into()
            },
            fallback: !h.ok,
        },
        Err(e) => ProbEngineStatus {
            online: false,
            version: String::new(),
            policy_id: String::new(),
            phase: String::new(),
            addr: PROB_BRIDGE_ADDR.into(),
            label: format!("Hesap motoru kapalı · yerel ({e})"),
            fallback: true,
        },
    };
    if !st.online {
        let cache = PROBE_NEG_CACHE.get_or_init(|| Mutex::new(None));
        if let Ok(mut guard) = cache.lock() {
            *guard = Some((Instant::now(), st.clone()));
        }
    }
    st
}

fn http_get(path: &str) -> Result<String, String> {
    http_exchange("GET", path, None)
}

fn http_post(path: &str, body: &str) -> Result<String, String> {
    http_exchange("POST", path, Some(body))
}

fn http_exchange(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    let addr: SocketAddr = PROB_BRIDGE_ADDR
        .parse()
        .map_err(|e| format!("bridge addr: {e}"))?;
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("bağlanamadı: {e}"))?;
    let _ = stream.set_read_timeout(Some(TIMEOUT));
    let _ = stream.set_write_timeout(Some(TIMEOUT));
    let body = body.unwrap_or("");
    let req = format!(
        "{method} {path} HTTP/1.1\r\nHost: {PROB_BRIDGE_ADDR}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("yazma: {e}"))?;
    let mut buf = Vec::new();
    stream
        .read_to_end(&mut buf)
        .map_err(|e| format!("okuma: {e}"))?;
    let raw = String::from_utf8_lossy(&buf);
    let Some(idx) = raw.find("\r\n\r\n") else {
        return Err("HTTP gövde yok".into());
    };
    let headers = &raw[..idx];
    let status_ok = headers.starts_with("HTTP/1.1 200") || headers.starts_with("HTTP/1.0 200");
    let body = raw[idx + 4..].trim().to_string();
    if !status_ok {
        return Err(format!("HTTP hata: {}", headers.lines().next().unwrap_or("?")));
    }
    Ok(body)
}
