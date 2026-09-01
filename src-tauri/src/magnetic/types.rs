//! Ortak tipler ve yapılandırma.

use serde::{Deserialize, Serialize};

/// RGBA renk (0–255). Tauri / canvas / OpenCV'ye kolay aktarılır.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Self::new(r, g, b, 255)
    }

    pub fn to_array(self) -> [u8; 4] {
        [self.r, self.g, self.b, self.a]
    }
}

/// Anomali sınıfı — PDF / Proton ELIC polarite mantığı.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnomalyClass {
    /// Referans zemin (±tolerans).
    Neutral,
    /// Ferromanyetik / metal (pozitif pik).
    PositiveMetal,
    /// Diyamanyetik / boşluk-sarnıç (negatif dip).
    NegativeVoid,
}

/// Nötr zemin (sıfır noktası) nasıl seçilir.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalibrationMode {
    /// Dizinin medyanı (robust, outlier'a dayanıklı).
    Median,
    /// Dizinin ortalaması.
    Mean,
    /// Operatörün girdiği sabit kalibrasyon (nT / cihaz birimi).
    Fixed(f32),
}

/// Analiz parametreleri — Proton ELIC ekran skalasına yakın varsayılanlar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MagneticConfig {
    pub calibration: CalibrationMode,
    /// Nötr band genişliği (referans ± bu değer → yeşil).
    pub neutral_tolerance: f32,
    /// Bu eşiğin altındaki |sapma| gürültü sayılır (histerezis).
    pub hysteresis_deadband: f32,
    /// Hareketli ortalama penceresi (1 = kapalı).
    pub moving_average_window: usize,
    /// Renk paleti (Proton ELIC uyumlu).
    pub palette: ColorPalette,
}

/// Bipolar colormap durakları.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColorPalette {
    pub neutral: Rgba,
    /// Pozitif: yeşil → sarı → turuncu → kırmızı
    pub positive_stops: [Rgba; 4],
    /// Negatif: yeşil → açık mavi → koyu mavi
    pub negative_stops: [Rgba; 3],
}

impl Default for ColorPalette {
    fn default() -> Self {
        Self {
            neutral: Rgba::rgb(34, 180, 70),
            positive_stops: [
                Rgba::rgb(34, 180, 70),
                Rgba::rgb(255, 230, 40),
                Rgba::rgb(255, 140, 20),
                Rgba::rgb(220, 20, 20),
            ],
            negative_stops: [
                Rgba::rgb(34, 180, 70),
                Rgba::rgb(80, 200, 230),
                Rgba::rgb(20, 40, 180),
            ],
        }
    }
}

impl Default for MagneticConfig {
    fn default() -> Self {
        Self {
            calibration: CalibrationMode::Median,
            neutral_tolerance: 25.0,
            hysteresis_deadband: 12.0,
            moving_average_window: 5,
            palette: ColorPalette::default(),
        }
    }
}

/// Tek bir örnek / piksel için analiz çıktısı.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AnomalyPoint {
    /// Filtrelenmiş ham değer.
    pub raw: f32,
    /// Referansa göre sapma (raw − ground).
    pub delta: f32,
    /// 0..1 — kutup içi şiddet (nötrde ~0).
    pub intensity: f32,
    pub class: AnomalyClass,
    pub color: Rgba,
}
