use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDikMeta {
    pub device_code: String,
    pub date: Option<String>,
    pub x_meters: f32,
    pub y_meters: f32,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyShape {
    /// anomaly | room | tunnel | metal
    pub kind: String,
    pub label: String,
    /// Plan merkezi (m) — saha orijini sol-alt; UI ortalar
    pub cx: f32,
    pub cy: f32,
    pub rx: f32,
    pub ry: f32,
    /// +1 metal/güçlü |B|, -1 zayıf/void benzeri
    pub polarity: f32,
    pub strength: f32,
    pub confidence: f32,
    pub depth_top_m: f32,
    pub depth_bottom_m: f32,
    /// UI mesh: box | cylinder | elongated
    #[serde(default = "default_mesh_kind")]
    pub mesh_kind: String,
    /// Tepe residual (σ biriminde)
    #[serde(default)]
    pub peak_sigma: f32,
    /// Kısa derinlik özeti (TR)
    #[serde(default)]
    pub depth_label: String,
    /// Derinlik tahmin yöntemi: dipole | peters | heuristic.
    #[serde(default)]
    pub depth_method: String,
    /// Normalize edilmiş model uyum hatası (RMS / tepe); 0 daha iyi, 1 zayıf.
    #[serde(default = "default_depth_fit_error")]
    pub depth_fit_error: f32,
    /// Tahmini merkez derinlik çevresindeki belirsizlik yarıçapı (m).
    #[serde(default)]
    pub depth_uncertainty_m: f32,
    /// Belirsizlik aralığı [alt, üst] (m); eski arşivlerde 0 olabilir.
    #[serde(default)]
    pub depth_interval_low_m: f32,
    #[serde(default)]
    pub depth_interval_high_m: f32,
    /// Dipol uyumunda kullanılan ölçüm hücresi sayısı.
    #[serde(default)]
    pub depth_fit_samples: u32,
    /// Normalize 0–1 köşe listesi (ayak izi konturu)
    #[serde(default)]
    pub polygon: Vec<[f32; 2]>,
    /// Dairesel, eliptik, kare, dikdörtgen, kapsül, çokgen veya düzensiz.
    #[serde(default = "default_shape_type")]
    pub shape_type: String,
    /// Geometrinin kaynağı: grid-contour veya inferred.
    #[serde(default)]
    pub shape_source: String,
    /// Ana eksenin saha düzlemindeki yönü (derece).
    #[serde(default)]
    pub orientation_deg: f32,
    /// Şekil ayak izinin fiziksel genişliği ve uzunluğu (m).
    #[serde(default)]
    pub width_m: f32,
    #[serde(default)]
    pub length_m: f32,
    /// 4πA/P²; 1 daireye, düşük değer düzensiz sınıra yakındır.
    #[serde(default)]
    pub roundness: f32,
    #[serde(default)]
    pub aspect_ratio: f32,
    /// Şekil modelinin normalize uyum hatası (0 iyi, 1 zayıf).
    #[serde(default = "default_shape_fit_error")]
    pub shape_fit_error: f32,
    /// Şekil modeline güven skoru (0–1).
    #[serde(default)]
    pub shape_confidence: f32,
    /// Dış konturun içindeki güçlü çekirdek sınırı (%50 tepe konturu).
    #[serde(default)]
    pub core_polygon: Vec<[f32; 2]>,
    /// En güçlü hücrenin gerçek saha koordinatı (m).
    #[serde(default)]
    pub peak_x_m: f32,
    #[serde(default)]
    pub peak_y_m: f32,
    /// Ölçülmüş dış konturun fiziksel alanı ve çevresi.
    #[serde(default)]
    pub footprint_area_m2: f32,
    #[serde(default)]
    pub footprint_perimeter_m: f32,
    /// Dış konturun üretildiği tepe eşik katsayısı.
    #[serde(default)]
    pub contour_threshold_sigma: f32,
    /// Şablon eşleştirme: room | tunnel | shaft | metal | anomaly ("" eski arşiv).
    #[serde(default)]
    pub template_kind: String,
    /// En iyi şablonun korelasyon + öncül bileşik skoru (0–1).
    #[serde(default)]
    pub template_score: f32,
    /// Tüm şablonların bileşik skorları [(anahtar, skor)].
    #[serde(default)]
    pub template_scores: Vec<(String, f32)>,
}

fn default_mesh_kind() -> String {
    "box".into()
}

fn default_depth_fit_error() -> f32 {
    1.0
}

fn default_shape_type() -> String {
    "irregular".into()
}

fn default_shape_fit_error() -> f32 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyScanStep {
    /// 1 tabanlı kullanıcı adımı.
    pub index: u32,
    /// Ham scan.data satır aralığı [başlangıç, bitiş).
    pub start: usize,
    pub end: usize,
    /// Adımın gerçek yatay saha konumu ve kapladığı aralık (m).
    pub x_start_m: f32,
    pub x_end_m: f32,
    pub x_center_m: f32,
    pub y_start_m: f32,
    pub y_end_m: f32,
    pub y_center_m: f32,
    pub width_m: f32,
    pub length_m: f32,
    pub point_count: usize,
    /// Önceki adım merkezine yatay uzaklık (m); ilk adımda 0.
    pub spacing_from_previous_m: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDikResult {
    pub ok: bool,
    pub message: String,
    pub view_mode: String,
    pub meta: LegacyDikMeta,
    pub point_count: usize,
    pub grid_w: u32,
    pub grid_h: u32,
    pub map_size_m: f32,
    pub map_depth_m: f32,
    pub mag_median: f32,
    pub mag_sigma: f32,
    pub anomalies: Vec<LegacyShape>,
    pub candidates: Vec<LegacyShape>,
    /// Güçlü pozitif tepe — metal adayları (UI’da tam plume)
    #[serde(default)]
    pub metals: Vec<LegacyShape>,
    /// Tahmini tekrar geçiş sayısı (aynı hücre revisit)
    #[serde(default)]
    pub pass_estimate: u32,
    /// Analizde kullanılan tarama adımı/geçiş sayısı; 0 eski arşivlerde bilinmiyor.
    #[serde(default)]
    pub scan_step_count: u32,
    /// Adım sayısının oluşturduğu leveling segment sayısı.
    #[serde(default)]
    pub scan_segment_count: u32,
    /// Her tarama adımının gerçek yatay saha konumu ve açıklığı.
    #[serde(default)]
    pub scan_steps: Vec<LegacyScanStep>,
    /// Kullanıcının girdiği yatay adım açıklığı (m); 0 otomatik/JSON segmentleri.
    #[serde(default)]
    pub scan_step_input_m: f32,
    /// Ardışık adım merkezleri arasındaki ortalama yatay açıklık (m).
    #[serde(default)]
    pub scan_step_spacing_m: f32,
    /// Birleştirme sonrası eşsiz konum sayısı
    #[serde(default)]
    pub unique_points: usize,
    /// Ham örnek sayısı (birleştirmeden önce)
    #[serde(default)]
    pub raw_point_count: usize,
    /// Dosya/analiz ayırıcı: nokta + merkez + σ (aynı objeyi ayırt etmek için)
    #[serde(default)]
    pub fingerprint: String,
    /// UI'nin isteğe bağlı ısı haritası için (ham bulut değil)
    #[serde(default)]
    pub residual_preview: Vec<f32>,
    /// Ölçüm grid'indeki median-düzeltilmiş manyetik residual değerleri.
    /// Ölçülmemiş hücreler `grid_coverage` ile ayırt edilir ve sıfır kabul edilmez.
    #[serde(default)]
    pub grid_values: Vec<f32>,
    /// Hücre başına ölçüm sayısı; 0 olan hücreler bilinmeyendir.
    #[serde(default)]
    pub grid_coverage: Vec<u32>,
    /// Grid'in gerçek saha koordinatlarındaki sol-alt orijini (m).
    #[serde(default)]
    pub grid_origin_x_m: f32,
    #[serde(default)]
    pub grid_origin_y_m: f32,
    /// Grid'in kapsadığı gerçek saha genişliği (m).
    #[serde(default)]
    pub grid_width_m: f32,
    #[serde(default)]
    pub grid_depth_m: f32,
    /// Kompakt dipol invert proxy’leri (CAD değil; ölçülen kontürü değiştirmez).
    #[serde(default)]
    pub invert_proxies: Vec<LegacyInvertProxy>,
}

/// Kompakt manyetik invert sonucu — uydurma ayak izi (gerçek şekil değil).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyInvertProxy {
    /// Örn. compact-dipole
    pub method: String,
    pub disclaimer: String,
    pub cx: f32,
    pub cy: f32,
    /// Raporlanan gömü (manyetik z + cihaz–yüzey ofseti), m
    pub depth_m: f32,
    /// Saf manyetik uydurma derinliği (ofsetsiz), m
    #[serde(default)]
    pub depth_magnetic_m: f32,
    pub rx_m: f32,
    pub ry_m: f32,
    /// Normalize misfit (RMS / |tepe|), düşük daha iyi
    pub misfit_rms: f32,
    pub fit_samples: u32,
    /// Normalize 0–1 elips kontürü
    #[serde(default)]
    pub polygon: Vec<[f32; 2]>,
    #[serde(default)]
    pub sensor_height_m: f32,
    /// UI tespit id (örn. legacy-dik-shape-1); JS cx/cy ile yedek eşler
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detection_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentMedian {
    pub start: usize,
    pub end: usize,
    pub median_x: f64,
    pub median_y: f64,
    pub point_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelStats {
    pub reference_median_x: f64,
    pub reference_median_y: f64,
    pub segment_count: usize,
    pub segment_medians: Vec<SegmentMedian>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyLevelResult {
    pub ok: bool,
    pub message: String,
    pub columns: Vec<String>,
    /// Leveled rows: typically `[time, x, y, z, x_coords, y_coords]`
    pub data: Vec<Vec<f64>>,
    pub stats: LevelStats,
    /// Full document JSON with leveled `scan` (stringified pandas-split) preserved.
    pub leveled_json: String,
}

/// Legacy derinlik kalibrasyon defteri notu (Parametre çekmecesi).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDepthCalibNote {
    pub label_depth_m: f32,
    #[serde(default)]
    pub file_name: String,
    pub sensor_height_m: f32,
    pub bipolar_sep_factor: f32,
    pub dipole_blend: f32,
    #[serde(default)]
    pub saved_at: String,
}

/// Saha inceleme oturumu — JSON fingerprint anahtarıyla kalıcı hedef kaydı.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyTargetCheck {
    pub status: String,
    #[serde(default)]
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyFieldSession {
    /// JSON fingerprint (yoksa dosya adı)
    pub key: String,
    #[serde(default)]
    pub reviewed_targets: Vec<String>,
    #[serde(default)]
    pub report_targets: Vec<String>,
    #[serde(default)]
    pub last_target_id: Option<String>,
    #[serde(default)]
    pub last_step_index: Option<u32>,
    #[serde(default)]
    pub target_checks: std::collections::HashMap<String, LegacyTargetCheck>,
    #[serde(default)]
    pub updated_at: String,
}

/// Legacy metal derinlik proxy çarpanları (Parametre çekmecesi).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyDepthParams {
    /// Cihaz–yüzey mesafesi normalde 0,10 m; mutlak üst sınır 0,20 m'dir.
    #[serde(default = "default_sensor_height_m")]
    pub sensor_height_m: f32,
    /// Bipolar tepe–çukur çarpanı (z ≈ factor · Δ).
    #[serde(default = "default_bipolar_sep_factor")]
    pub bipolar_sep_factor: f32,
    /// Dipol ağırlığı 0..1; bipolar payı = 1 − blend.
    #[serde(default = "default_dipole_blend")]
    pub dipole_blend: f32,
}

fn default_sensor_height_m() -> f32 {
    0.10
}
fn default_bipolar_sep_factor() -> f32 {
    1.85
}
fn default_dipole_blend() -> f32 {
    0.30
}

impl Default for LegacyDepthParams {
    fn default() -> Self {
        Self {
            sensor_height_m: default_sensor_height_m(),
            bipolar_sep_factor: default_bipolar_sep_factor(),
            dipole_blend: default_dipole_blend(),
        }
    }
}

impl LegacyDepthParams {
    pub fn clamped(self) -> Self {
        Self {
            sensor_height_m: self.sensor_height_m.clamp(0.0, 0.20),
            bipolar_sep_factor: self.bipolar_sep_factor.clamp(0.5, 4.0),
            dipole_blend: self.dipole_blend.clamp(0.0, 1.0),
        }
    }
}
