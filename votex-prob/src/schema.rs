//! Shared JSON schema (API v1) — Faz B.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const SCHEMA_VERSION: &str = "1";
pub const ENGINE_VERSION: &str = "0.1.0-D";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub version: String,
    pub policy_id: String,
    pub legacy_compatible: bool,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyResponse {
    pub ok: bool,
    pub policy_id: String,
    pub profiles: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct EvidenceBatch {
    #[serde(default = "default_schema")]
    pub schema_version: String,
    #[serde(default = "default_view")]
    pub view_mode: String,
    #[serde(default = "default_target")]
    pub target: String,
    #[serde(default)]
    pub policy_id: Option<String>,
    #[serde(default = "default_depth")]
    pub depth_range_m: f32,
    #[serde(default = "default_map_w")]
    pub map_width_m: f32,
    #[serde(default = "default_map_d")]
    pub map_depth_m: f32,
    #[serde(default = "default_min_conf")]
    pub min_confidence: f32,
    /// Kırmızı anomali yapıyı engellemesin (through_red) — VOTEX ayarından gelir.
    #[serde(default)]
    pub through_red: bool,
    /// Derin mod: SNR kapısı 1.35 → 1.05 (zayıf sinyaller kabul edilir).
    #[serde(default)]
    pub deep: bool,
    #[serde(default)]
    pub calib: Option<CalibDto>,
    #[serde(default)]
    pub void_blobs: Vec<BlobDto>,
    #[serde(default)]
    pub metal_blobs: Vec<BlobDto>,
    /// Oda çifti path skorları (VOTEX path_corridor_support)
    #[serde(default)]
    pub pair_paths: Vec<PairPath>,
}

fn default_schema() -> String {
    SCHEMA_VERSION.into()
}
fn default_view() -> String {
    "side".into()
}
fn default_target() -> String {
    "auto".into()
}
fn default_depth() -> f32 {
    10.0
}
fn default_map_w() -> f32 {
    24.0
}
fn default_map_d() -> f32 {
    10.0
}
fn default_min_conf() -> f32 {
    0.35
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalibDto {
    pub void_thr: f32,
    pub metal_thr: f32,
    pub noise_std: f32,
    pub min_area: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
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

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PairPath {
    pub a_id: String,
    pub b_id: String,
    pub path_s: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionBatch {
    pub schema_version: String,
    pub engine_version: String,
    pub policy_id: String,
    pub stub: bool,
    pub message: String,
    pub voids: Vec<VoidDecision>,
    pub depths: Vec<DepthDecision>,
    pub links: Vec<LinkDecision>,
    pub metals: Vec<MetalDecision>,
    pub report: DecisionReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoidDecision {
    pub id: String,
    pub class: String,
    pub conf: f32,
    /// score_void çıktısı (apply_target_and_policy forcing / zarf boost ÖNCESİ ham skor).
    /// Paylaşılan gövdedeki through_red rescue kapısı bunu kullanır — legacy'nin ham
    /// classify conf'u ile aynı taban (engine forcing max'leri de-boost edilemez).
    #[serde(default)]
    pub raw_conf: f32,
    pub margin: f32,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rewrite_to: Option<String>,
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthDecision {
    pub id: String,
    pub cover_m: f32,
    pub floor_m: f32,
    pub height_m: f32,
    pub emergence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkDecision {
    pub a_id: String,
    pub b_id: String,
    pub conf: f32,
    pub method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetalDecision {
    pub id: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_id: Option<String>,
    #[serde(default)]
    pub conf: f32,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DecisionReport {
    pub accepted: u32,
    pub rejected: u32,
    pub void_blob_count: u32,
    pub metal_blob_count: u32,
    pub by_class: HashMap<String, u32>,
}
