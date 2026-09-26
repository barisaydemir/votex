//! Zemin kalibrasyonu — nötr referans noktası.

use super::types::CalibrationMode;

/// Diziden veya sabit değerden nötr zemin (sıfır noktası) üretir.
pub fn resolve_ground(samples: &[f32], mode: CalibrationMode) -> f32 {
    match mode {
        CalibrationMode::Fixed(v) => v,
        CalibrationMode::Mean => {
            if samples.is_empty() {
                return 0.0;
            }
            samples.iter().sum::<f32>() / samples.len() as f32
        }
        CalibrationMode::Median => median(samples),
    }
}

/// Robust medyan (outlier'lı manyetik gürültüye uygun).
pub fn median(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len();
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) * 0.5
    }
}

/// Asimetrik uçlar: referansın üstündeki max ve altındaki min sapma.
/// Proton ELIC'te +470 / −1160 gibi dengesiz skalayı doğru normalize eder.
#[derive(Debug, Clone, Copy)]
pub struct AsymmetricRange {
    pub ground: f32,
    /// ground üzerindeki en büyük pozitif sapma (≥ ε).
    pub peak_positive: f32,
    /// ground altındaki en büyük negatif sapmanın mutlak değeri (≥ ε).
    pub peak_negative: f32,
}

impl AsymmetricRange {
    const EPS: f32 = 1e-3;

    pub fn from_samples(samples: &[f32], ground: f32) -> Self {
        let mut peak_pos = Self::EPS;
        let mut peak_neg = Self::EPS;
        for &v in samples {
            let d = v - ground;
            if d > peak_pos {
                peak_pos = d;
            }
            if -d > peak_neg {
                peak_neg = -d;
            }
        }
        Self {
            ground,
            peak_positive: peak_pos,
            peak_negative: peak_neg,
        }
    }

    /// Manuel / önceki tarama uçları (canlı akışta sabit skala için).
    pub fn with_peaks(ground: f32, peak_positive: f32, peak_negative: f32) -> Self {
        Self {
            ground,
            peak_positive: peak_positive.max(Self::EPS),
            peak_negative: peak_negative.max(Self::EPS),
        }
    }

    /// Sapmayı kutup içinde 0..1'e map eder. İşaret korunur: +pozitif, −negatif.
    pub fn signed_norm(&self, value: f32) -> f32 {
        let d = value - self.ground;
        if d >= 0.0 {
            (d / self.peak_positive).clamp(0.0, 1.0)
        } else {
            -((-d / self.peak_negative).clamp(0.0, 1.0))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_odd_even() {
        assert!((median(&[3.0, 1.0, 2.0]) - 2.0).abs() < 1e-5);
        assert!((median(&[4.0, 1.0, 2.0, 3.0]) - 2.5).abs() < 1e-5);
    }

    #[test]
    fn asymmetric_elic_like_range() {
        // Ekran: ~+470 … −1160, ground ~0
        let samples = [0.0, 470.0, -1160.0, 50.0, -200.0];
        let range = AsymmetricRange::from_samples(&samples, 0.0);
        assert!((range.peak_positive - 470.0).abs() < 1e-3);
        assert!((range.peak_negative - 1160.0).abs() < 1e-3);
        assert!((range.signed_norm(470.0) - 1.0).abs() < 1e-5);
        assert!((range.signed_norm(-1160.0) + 1.0).abs() < 1e-5);
        assert!((range.signed_norm(0.0)).abs() < 1e-5);
    }
}
