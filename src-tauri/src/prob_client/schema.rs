//! Prob engine DTO (VOTEX tarafı — Faz B).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SCHEMA_VERSION: &str = "1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub version: String,
    pub policy_id: String,
    #[serde(default)]
    pub legacy_compatible: bool,
    #[serde(default)]
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbEngineStatus {
    pub online: bool,
    pub version: String,
    pub policy_id: String,
    pub phase: String,
    pub addr: String,
    pub label: String,
    pub fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceBatch {
    #[serde(default = "schema_v")]
    pub schema_version: String,
    #[serde(default = "side_v")]
    pub view_mode: String,
    #[serde(default = "auto_v")]
    pub target: String,
    #[serde(default)]
    pub policy_id: Option<String>,
    #[serde(default = "depth_v")]
    pub depth_range_m: f32,
    #[serde(default = "map_w")]
    pub map_width_m: f32,
    #[serde(default = "map_d")]
    pub map_depth_m: f32,
    #[serde(default = "min_c")]
    pub min_confidence: f32,
    /// Kırmızı anomali yapıyı engellemesin (through_red) — VOTEX ayarından gelir.
    #[serde(default)]
    pub through_red: bool,
    /// Derin mod: SNR kapısı 1.35 → 1.05 (zayıf sinyaller kabul edilir).
    #[serde(default)]
    pub deep: bool,
    #[serde(default)]
    pub void_blobs: Vec<BlobDto>,
    #[serde(default)]
    pub metal_blobs: Vec<BlobDto>,
    #[serde(default)]
    pub pair_paths: Vec<PairPath>,
}

fn schema_v() -> String {
    SCHEMA_VERSION.into()
}
fn side_v() -> String {
    "side".into()
}
fn auto_v() -> String {
    "auto".into()
}
fn depth_v() -> f32 {
    10.0
}
fn map_w() -> f32 {
    24.0
}
fn map_d() -> f32 {
    10.0
}
fn min_c() -> f32 {
    0.35
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BlobDto {
    pub id: String,
    #[serde(default)]
    pub cx: f32,
    #[serde(default)]
    pub cy: f32,
    #[serde(default)]
    pub rx: f32,
    #[serde(default)]
    pub ry: f32,
    #[serde(default)]
    pub intensity: f32,
    #[serde(default)]
    pub fill_ratio: f32,
    #[serde(default)]
    pub aspect: f32,
    #[serde(default)]
    pub path_s: f32,
    #[serde(default)]
    pub wall_s: f32,
    #[serde(default)]
    pub line_s: f32,
    #[serde(default)]
    pub near_red: bool,
    #[serde(default)]
    pub snr: f32,
    /// PCA ana eksen aspect'i (legacy `Blob.axis_aspect`) — derinlik/geometri için.
    #[serde(default)]
    pub axis_aspect: f32,
    /// PCA ana eksen yarı uzunluğu (legacy `Blob.half_len`).
    #[serde(default)]
    pub half_len: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PairPath {
    pub a_id: String,
    pub b_id: String,
    pub path_s: f32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionBatch {
    #[serde(default)]
    pub schema_version: String,
    #[serde(default)]
    pub engine_version: String,
    #[serde(default)]
    pub policy_id: String,
    #[serde(default)]
    pub stub: bool,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub voids: Vec<VoidDecision>,
    #[serde(default)]
    pub depths: Vec<DepthDecision>,
    #[serde(default)]
    pub links: Vec<LinkDecision>,
    #[serde(default)]
    pub metals: Vec<MetalDecision>,
    #[serde(default)]
    pub report: DecisionReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VoidDecision {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub class: String,
    #[serde(default)]
    pub conf: f32,
    /// engine score_void çıktısı (forcing/zarf boost öncesi ham skor) — paylaşılan
    /// gövdedeki through_red rescue kapısı legacy ile aynı tabanı bununla görür.
    #[serde(default)]
    pub raw_conf: f32,
    #[serde(default)]
    pub margin: f32,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DepthDecision {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub cover_m: f32,
    #[serde(default)]
    pub floor_m: f32,
    #[serde(default)]
    pub height_m: f32,
    #[serde(default)]
    pub emergence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LinkDecision {
    #[serde(default)]
    pub a_id: String,
    #[serde(default)]
    pub b_id: String,
    #[serde(default)]
    pub conf: f32,
    #[serde(default)]
    pub method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MetalDecision {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub action: String,
    #[serde(default)]
    pub host_kind: Option<String>,
    #[serde(default)]
    pub host_id: Option<String>,
    #[serde(default)]
    pub conf: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DecisionReport {
    #[serde(default)]
    pub accepted: u32,
    #[serde(default)]
    pub rejected: u32,
    #[serde(default)]
    pub void_blob_count: u32,
    #[serde(default)]
    pub metal_blob_count: u32,
    #[serde(default)]
    pub by_class: HashMap<String, u32>,
}
