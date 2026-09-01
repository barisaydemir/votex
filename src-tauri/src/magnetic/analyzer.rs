//! Ana API — batch ve akışlı (streaming) manyetik anomali analizi.

use super::calibration::{resolve_ground, AsymmetricRange};
use super::colormap::{legend_color, value_to_color};
use super::filter::NoiseFilterChain;
use super::types::{AnomalyPoint, MagneticConfig, Rgba};

/// Modüler analiz motoru.
///
/// Batch kullanım: `MagneticAnalyzer::new(config).analyze_batch(&samples)`
#[derive(Debug, Clone)]
pub struct MagneticAnalyzer {
    pub config: MagneticConfig,
    filter: NoiseFilterChain,
    range: Option<AsymmetricRange>,
}

impl MagneticAnalyzer {
    pub fn new(config: MagneticConfig) -> Self {
        let filter = NoiseFilterChain::new(
            config.moving_average_window,
            config.hysteresis_deadband,
        );
        Self {
            config,
            filter,
            range: None,
        }
    }

    pub fn reset_filters(&mut self) {
        self.filter.reset();
    }

    /// Canlı akışta sabit skala kilitle (ör. peak+ = 470, peak− = 1160).
    pub fn lock_scale(&mut self, ground: f32, peak_positive: f32, peak_negative: f32) {
        self.range = Some(AsymmetricRange::with_peaks(
            ground,
            peak_positive,
            peak_negative,
        ));
    }

    pub fn clear_scale_lock(&mut self) {
        self.range = None;
    }

    /// Tek örnek (streaming). Önceden `lock_scale` veya en az bir batch gerekir.
    pub fn push_sample(&mut self, raw: f32) -> Option<AnomalyPoint> {
        let filtered = self.filter.push(raw);
        let range = self.range?;
        Some(self.map_value(filtered, &range))
    }

    /// Dizi / matris satırı — kalibrasyon + opsiyonel otomatik skala + renk.
    pub fn analyze_batch(&mut self, samples: &[f32]) -> Vec<AnomalyPoint> {
        if samples.is_empty() {
            return Vec::new();
        }

        let filtered = NoiseFilterChain::apply_series(
            self.config.moving_average_window,
            self.config.hysteresis_deadband,
            samples,
        );

        let ground = resolve_ground(&filtered, self.config.calibration);
        let range = match self.range {
            Some(r) => AsymmetricRange::with_peaks(ground, r.peak_positive, r.peak_negative),
            None => AsymmetricRange::from_samples(&filtered, ground),
        };
        // Streaming için son skalayı sakla
        self.range = Some(range);

        filtered
            .iter()
            .map(|&v| self.map_value(v, &range))
            .collect()
    }

    /// 2D ızgara (row-major): `width * height == data.len()`.
    /// Dönüş: RGBA buffer (len = n * 4) + sınıf haritası.
    pub fn analyze_grid(
        &mut self,
        data: &[f32],
        width: usize,
        height: usize,
    ) -> Result<(Vec<u8>, Vec<AnomalyPoint>), String> {
        if width == 0 || height == 0 || data.len() != width * height {
            return Err(format!(
                "grid boyutu uyuşmuyor: {}x{} != {}",
                width,
                height,
                data.len()
            ));
        }
        let points = self.analyze_batch(data);
        let mut rgba = Vec::with_capacity(points.len() * 4);
        for p in &points {
            rgba.extend_from_slice(&p.color.to_array());
        }
        Ok((rgba, points))
    }

    /// Sol dikey cetvel (LUT) — PDF'deki renk şeridi üretimi / UI legend.
    pub fn build_legend(&self, height: usize) -> Vec<Rgba> {
        let h = height.max(1);
        (0..h)
            .map(|i| {
                // Üst = pozitif (kırmızı), alt = negatif (mavi) — ELIC ekranı
                let t = 1.0 - (i as f32 / (h - 1).max(1) as f32);
                legend_color(t, &self.config.palette)
            })
            .collect()
    }

    fn map_value(&self, value: f32, range: &AsymmetricRange) -> AnomalyPoint {
        let (color, class, intensity, delta) = value_to_color(
            value,
            range.ground,
            range.peak_positive,
            range.peak_negative,
            self.config.neutral_tolerance,
            &self.config.palette,
        );
        AnomalyPoint {
            raw: value,
            delta,
            intensity,
            class,
            color,
        }
    }
}

impl Default for MagneticAnalyzer {
    fn default() -> Self {
        Self::new(MagneticConfig::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::magnetic::types::{AnomalyClass, CalibrationMode};

    #[test]
    fn elic_like_batch_classifies_poles() {
        // Proton ELIC ekranına benzer asimetrik set
        let raw = vec![
            -1160.0, -800.0, -100.0, 0.0, 20.0, 200.0, 470.0,
        ];
        let mut cfg = MagneticConfig::default();
        cfg.calibration = CalibrationMode::Fixed(0.0);
        cfg.moving_average_window = 1;
        cfg.hysteresis_deadband = 0.0;
        cfg.neutral_tolerance = 30.0;

        let mut a = MagneticAnalyzer::new(cfg);
        let out = a.analyze_batch(&raw);

        assert_eq!(out[0].class, AnomalyClass::NegativeVoid);
        assert_eq!(out[out.len() - 1].class, AnomalyClass::PositiveMetal);
        assert_eq!(out[3].class, AnomalyClass::Neutral);

        // peak+ kırmızımsı, peak- mavimsi
        assert!(out[0].color.b > out[0].color.r);
        assert!(out[out.len() - 1].color.r > out[out.len() - 1].color.b);
    }

    #[test]
    fn grid_rgba_length() {
        let data = vec![0.0_f32; 4];
        let mut a = MagneticAnalyzer::default();
        let (rgba, pts) = a.analyze_grid(&data, 2, 2).unwrap();
        assert_eq!(rgba.len(), 16);
        assert_eq!(pts.len(), 4);
    }
}
