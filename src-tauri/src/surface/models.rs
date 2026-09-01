//! Surface / structure DTOs shared with the frontend.

use crate::preprocess::{CropInfo, WallCue};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Surface3D {
    pub grid_w: u32,
    pub grid_h: u32,
    pub heights: Vec<f32>,
    pub colors: Vec<u8>,
    pub z_min: f32,
    pub z_max: f32,
    pub source_w: u32,
    pub source_h: u32,
    pub file_name: Option<String>,
    pub cleaned_preview_base64: Option<String>,
    pub crop: Option<CropInfo>,
    /// X ekseni (nx) d?nya geni?li?i (m) ? genelde 24
    pub map_size_m: f32,
    /// X ekseni metre (mapToWorld mapW); `map_size_m` ile ayn?
    #[serde(default)]
    pub map_width_m: f32,
    /// Dik/yan: Z plan ayakizi (m) ? g?r?nt? en-boyu. G?m? ayr?: depth_range_m.
    #[serde(default)]
    pub map_depth_m: f32,
    /// G?m? aral??? (m): yan ~3, dik ~10
    #[serde(default)]
    pub depth_range_m: f32,
    pub view_mode: String,
    pub structures: UndergroundStructures,
    /// Beyaz duvar ipu?lar? (normalize 0?1, k?rp?lm?? harita)
    #[serde(default)]
    pub wall_cues: Vec<WallCue>,
    /// Toprak profili id (off|sand|loam|?)
    #[serde(default)]
    pub soil_profile: String,
    /// Uygulanan derinlik ?arpan? (1.0 = legacy)
    #[serde(default = "default_one")]
    pub soil_depth_scale: f32,
    /// Toprak d?zeltmesi bu analizde uyguland? m?
    #[serde(default)]
    pub soil_correction_applied: bool,
    /// T?rk?e etiket (INTEL)
    #[serde(default)]
    pub soil_label: String,
}

fn default_one() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UndergroundStructures {
    pub chambers: Vec<Chamber>,
    pub tunnels: Vec<Tunnel>,
    pub metals: Vec<MetalBody>,
    /// Sari bant -> olasi su (overlay; varsayilan bos)
    #[serde(default)]
    pub waters: Vec<WaterBody>,
    #[serde(default)]
    pub accepted_count: u32,
    #[serde(default)]
    pub rejected_count: u32,
    #[serde(default)]
    pub min_confidence: f32,
    #[serde(default)]
    pub geometry_report: SiteGeometryReport,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub snr: f32,
    pub path_support: f32,
    pub class_margin: f32,
    /// Mavi bo?luk ?evresi beyaz duvar ?izgisi deste?i (0?1)
    #[serde(default)]
    pub wall_support: f32,
    /// A??klanabilirlik: conf neden bu? (VPE reasons + yerel kan?tlar)
    #[serde(default)]
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GeometryAnalysis {
    pub symmetry_index: f32,
    pub symmetry_axis_deg: f32,
    pub rectangularity: f32,
    pub elongation: f32,
    pub mirror_residual: f32,
    pub method: String,
    pub label: String,
    /// Fit: ?l?? uyum skoru (0?1)
    #[serde(default)]
    pub size_score: f32,
    /// Fit: y?n/eksen uyum skoru (0?1)
    #[serde(default)]
    pub orient_score: f32,
    /// Fit ?l??y? veya y?n? g?ncelledi
    #[serde(default)]
    pub fit_adjusted: bool,
    /// Fit y?ntemi etiketi (?rn. fit_shaft, fit_tunnel)
    #[serde(default)]
    pub fit_method: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SiteGeometryReport {
    pub mean_symmetry: f32,
    pub mean_rectangularity: f32,
    pub analyzed_count: u32,
    pub high_symmetry_count: u32,
    /// Fit uygulanan yap? say?s?
    #[serde(default)]
    pub fit_adjusted_count: u32,
    /// Ortalama ?l?? skoru
    #[serde(default)]
    pub mean_size_score: f32,
    /// Ortalama y?n skoru
    #[serde(default)]
    pub mean_orient_score: f32,
    /// VotexProb ba?l? m? (Faz A)
    #[serde(default)]
    pub prob_engine_online: bool,
    /// VPE etiket / stub mesaj?
    #[serde(default)]
    pub prob_engine_label: String,
    /// true = yap? matemati?i legacy (Faz A her zaman true)
    #[serde(default = "default_true_legacy")]
    pub prob_used_legacy: bool,
}

fn default_true_legacy() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Chamber {
    pub kind: String,
    pub cx: f32,
    pub cy: f32,
    pub rx: f32,
    pub ry: f32,
    pub depth: f32,
    pub height: f32,
    pub intensity: f32,
    pub width_m: f32,
    pub length_m: f32,
    pub top_from_surface_m: f32,
    pub bottom_from_surface_m: f32,
    pub height_m: f32,
    /// Dik: pusula (?). Yan: kesit e?imi (?), 0=yatay.
    #[serde(default)]
    pub bearing_deg: f32,
    #[serde(default)]
    pub confidence: f32,
    /// Kademeli derinlik katman? (0 = normal/g??l? sinyal, >=1 = derin zay?f aday)
    #[serde(default)]
    pub tier: u8,
    /// Fizik (1/r^n) genlik?derinlik kestirimi (m); tier 0'da 0
    #[serde(default)]
    pub depth_estimate_m: f32,
    #[serde(default)]
    pub evidence: Evidence,
    #[serde(default)]
    pub geometry: GeometryAnalysis,
    /// Manyetik ayakizi (normalize 0–1). Boş = şablon kutu.
    #[serde(default)]
    pub outline: Vec<[f32; 2]>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tunnel {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    pub radius: f32,
    pub depth: f32,
    pub bearing_deg: f32,
    pub direction: String,
    pub heading: String,
    pub width_m: f32,
    pub floor_from_surface_m: f32,
    pub crown_from_surface_m: f32,
    pub height_m: f32,
    #[serde(default)]
    pub confidence: f32,
    /// Kademeli derinlik katman? (0 = normal, >=1 = derin zay?f aday)
    #[serde(default)]
    pub tier: u8,
    /// Fizik (1/r^n) genlik?derinlik kestirimi (m)
    #[serde(default)]
    pub depth_estimate_m: f32,
    #[serde(default)]
    pub evidence: Evidence,
    #[serde(default)]
    pub geometry: GeometryAnalysis,
    /// Manyetik ayakizi (normalize 0–1). Boş = D-kemer şablon.
    #[serde(default)]
    pub outline: Vec<[f32; 2]>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetalBody {
    pub cx: f32,
    pub cy: f32,
    pub rx: f32,
    pub ry: f32,
    pub depth: f32,
    pub intensity: f32,
    pub width_m: f32,
    pub length_m: f32,
    pub size_m: f32,
    pub depth_from_surface_m: f32,
    /// Yap? i?indeyse true (oda / mezar / ?aft / t?nel). Metal tek ba??na yap? de?ildir.
    #[serde(default)]
    pub inside_chamber: bool,
    /// "" | room | tomb | shaft | tunnel ? metalin konuk oldu?u yap? t?r?
    #[serde(default)]
    pub host_kind: String,
    /// Yay?l?m ana ekseni (m) ? alan ayakizi, cisim boyutu de?il
    #[serde(default)]
    pub spread_m: f32,
    /// Host bo?luk doluluk oran? (0?1); ba??ms?zda ~1
    #[serde(default)]
    pub spread_ratio: f32,
    /// Normalize alan g?c? (0?1)
    #[serde(default)]
    pub field_strength: f32,
    /// T?nel i?i hizalama (derece); di?erlerinde 0
    #[serde(default)]
    pub bearing_deg: f32,
    /// ?aft plume dikey boyutu (m)
    #[serde(default)]
    pub plume_height_m: f32,
    /// metal | oxidation | surface_exit | field
    #[serde(default)]
    pub cue_kind: String,
    /// "" | iron | au_ag_fe ? g??l? merkez metal varsay?m?
    #[serde(default)]
    pub metal_guess: String,
    #[serde(default)]
    pub confidence: f32,
    /// Kademeli derinlik katman? (0 = normal, >=1 = derin zay?f aday)
    #[serde(default)]
    pub tier: u8,
    /// Fizik (1/r^n) genlik?derinlik kestirimi (m)
    #[serde(default)]
    pub depth_estimate_m: f32,
    #[serde(default)]
    pub evidence: Evidence,
    #[serde(default)]
    pub geometry: GeometryAnalysis,
}

/// Mavi/lacivert/mor negatif bant + ?ekil (damar/da??n?k) ? olas? su (kesin hidrojeofizik de?il).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterBody {
    pub cx: f32,
    pub cy: f32,
    pub rx: f32,
    pub ry: f32,
    pub width_m: f32,
    pub length_m: f32,
    pub area_m2: f32,
    pub depth_from_surface_m: f32,
    /// Normalize derinlik (0-1) gorsellestirme icin
    #[serde(default)]
    pub depth: f32,
    /// Negatif bant yogunlugu (0-1)
    #[serde(default)]
    pub intensity: f32,
    #[serde(default)]
    pub confidence: f32,
    #[serde(default)]
    pub evidence: Evidence,
    #[serde(default)]
    pub geometry: GeometryAnalysis,
}
