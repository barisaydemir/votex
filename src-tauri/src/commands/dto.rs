//! Request/response DTOs for Tauri commands.

use crate::capture::CapturedFrame;
use crate::magnetic::{AnomalyClass, AnomalyPoint, Rgba};
use crate::structures::StructureHint;
use crate::vision::MapAnalysisResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SensorFramePayload {
    pub frame: CapturedFrame,
    pub analysis: Option<MapAnalysisResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeRawRequest {
    pub samples: Vec<f32>,
    pub width: Option<usize>,
    pub height: Option<usize>,
    pub ground: Option<f32>,
    pub peak_positive: Option<f32>,
    pub peak_negative: Option<f32>,
    pub neutral_tolerance: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeRawResponse {
    pub points: Vec<AnomalyPointDto>,
    pub rgba_base64_png: Option<String>,
    pub summary: AnalysisSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyPointDto {
    pub raw: f32,
    pub delta: f32,
    pub intensity: f32,
    pub class: AnomalyClass,
    pub color: Rgba,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisSummary {
    pub neutral: usize,
    pub positive_metal: usize,
    pub negative_void: usize,
    pub ground_estimate: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemoResponse {
    pub samples: Vec<f32>,
    pub result: AnalyzeRawResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeImageRequest {
    /// Ham base64 veya data:image/...;base64,... URL
    pub image_base64: String,
    pub file_name: Option<String>,
    pub lut_strip_px: Option<u32>,
    pub min_area: Option<u32>,
    /// "top" = dik çekim, "side" = yan çekim
    #[serde(default)]
    pub view_mode: Option<String>,
    /// Minimum kabul güveni (0–1), varsayılan 0.45
    #[serde(default)]
    pub min_confidence: Option<f32>,
    /// Dik çekim hedefi: auto|well|room|tunnel|site
    #[serde(default)]
    pub target_kind: Option<String>,
    /// DTA yapı ipuçları (normalize 0–1 konum)
    #[serde(default)]
    pub dta_hints: Option<Vec<StructureHint>>,
    /// Toprak profili: off|sand|loam|wet_clay|laterite|organic
    #[serde(default)]
    pub soil_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeImageResponse {
    pub file_name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub original_base64_png: String,
    pub analysis: MapAnalysisResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedImage {
    pub file_name: String,
    pub image_base64: String,
    pub size_bytes: u64,
}

pub fn point_dto(p: AnomalyPoint) -> AnomalyPointDto {
    AnomalyPointDto {
        raw: p.raw,
        delta: p.delta,
        intensity: p.intensity,
        class: p.class,
        color: p.color,
    }
}

pub fn summarize(points: &[AnomalyPoint]) -> AnalysisSummary {
    let mut summary = AnalysisSummary {
        neutral: 0,
        positive_metal: 0,
        negative_void: 0,
        ground_estimate: 0.0,
    };
    let mut sum = 0.0f32;
    for p in points {
        sum += p.raw - p.delta;
        match p.class {
            AnomalyClass::Neutral => summary.neutral += 1,
            AnomalyClass::PositiveMetal => summary.positive_metal += 1,
            AnomalyClass::NegativeVoid => summary.negative_void += 1,
        }
    }
    if !points.is_empty() {
        summary.ground_estimate = sum / points.len() as f32;
    }
    summary
}

pub fn decode_image_bytes(image_base64: &str) -> Result<image::RgbaImage, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine};
    let raw = image_base64
        .split(',')
        .last()
        .unwrap_or(image_base64)
        .trim();
    let bytes = B64
        .decode(raw)
        .map_err(|e| format!("Base64 cozumleme hatasi: {e}"))?;
    let dyn_img = image::load_from_memory(&bytes)
        .map_err(|e| format!("Gorsel okunamadi (JPG/PNG): {e}"))?;
    Ok(dyn_img.to_rgba8())
}

/// CSV dosyasından okunan dosya bilgisi.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedCsvFile {
    pub file_name: String,
    pub content: String,
}
