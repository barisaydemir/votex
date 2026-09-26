//! HTTP route dispatch.

use std::sync::RwLock;

use serde_json::json;

use crate::decide;
use crate::policy::{normalize_policy, PolicyState};
use crate::schema::{
    DecisionBatch, EvidenceBatch, HealthResponse, PolicyResponse, ENGINE_VERSION, SCHEMA_VERSION,
};

pub fn dispatch(raw: &str, policy: &RwLock<PolicyState>) -> (String, String) {
    let (method, path, body) = parse_request(raw);
    if method == "OPTIONS" {
        return ("204 No Content".into(), String::new());
    }
    match (method.as_str(), path.as_str()) {
        ("GET", "/") | ("GET", "/health") => {
            let p = policy
                .read()
                .ok()
                .map(|g| g.policy_id.clone())
                .unwrap_or_else(|| "standard".into());
            let resp = HealthResponse {
                ok: true,
                version: ENGINE_VERSION.into(),
                policy_id: p,
                legacy_compatible: true,
                phase: "D-explain".into(),
            };
            json_ok(&resp)
        }
        ("GET", "/v1/policy") => {
            let p = policy
                .read()
                .ok()
                .map(|g| g.policy_id.clone())
                .unwrap_or_else(|| "standard".into());
            let resp = PolicyResponse {
                ok: true,
                policy_id: p,
                profiles: vec!["standard".into(), "corridor".into()],
            };
            json_ok(&resp)
        }
        ("POST", "/v1/policy") => {
            let req: serde_json::Value = serde_json::from_str(body).unwrap_or(json!({}));
            let id = req
                .get("policyId")
                .and_then(|v| v.as_str())
                .unwrap_or("standard");
            let id = normalize_policy(id);
            if let Ok(mut g) = policy.write() {
                g.policy_id = id.clone();
            }
            let resp = PolicyResponse {
                ok: true,
                policy_id: id,
                profiles: vec!["standard".into(), "corridor".into()],
            };
            json_ok(&resp)
        }
        ("POST", "/v1/decide") => {
            let batch: EvidenceBatch = if body.trim().is_empty() {
                EvidenceBatch {
                    schema_version: SCHEMA_VERSION.into(),
                    view_mode: "side".into(),
                    target: "auto".into(),
                    policy_id: None,
                    depth_range_m: 10.0,
                    map_width_m: 24.0,
                    map_depth_m: 10.0,
                    min_confidence: 0.35,
                    through_red: false,
                    deep: false,
                    calib: None,
                    void_blobs: vec![],
                    metal_blobs: vec![],
                    pair_paths: vec![],
                }
            } else {
                match serde_json::from_str(body) {
                    Ok(b) => b,
                    Err(e) => return json_err(400, &format!("EvidenceBatch parse: {e}")),
                }
            };
            let pid = policy
                .read()
                .ok()
                .map(|g| g.policy_id.clone())
                .unwrap_or_else(|| "standard".into());
            let decision: DecisionBatch = decide::decide(&batch, &pid);
            json_ok(&decision)
        }
        _ => json_err(404, "not found"),
    }
}

fn parse_request(raw: &str) -> (String, String, &str) {
    let mut lines = raw.split("\r\n");
    let start = lines.next().unwrap_or("GET / HTTP/1.1");
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_uppercase();
    let path = parts.next().unwrap_or("/").to_string();
    let path = path.split('?').next().unwrap_or("/").to_string();
    let body = if let Some(idx) = raw.find("\r\n\r\n") {
        &raw[idx + 4..]
    } else {
        ""
    };
    (method, path, body)
}

fn json_ok<T: serde::Serialize>(v: &T) -> (String, String) {
    (
        "200 OK".into(),
        serde_json::to_string(v).unwrap_or_else(|_| "{}".into()),
    )
}

fn json_err(code: u16, msg: &str) -> (String, String) {
    let status = match code {
        400 => "400 Bad Request",
        404 => "404 Not Found",
        _ => "500 Internal Server Error",
    };
    (
        status.into(),
        json!({ "ok": false, "message": msg }).to_string(),
    )
}
