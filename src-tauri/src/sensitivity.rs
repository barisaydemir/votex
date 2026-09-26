//! Yapı tespit hassasiyeti (0.0 – 1.0) → teknik eşik eşlemesi.
//!
//! Katsayıların **tek kaynağı** `shared/sensitivity.json` dosyasıdır; JS tarafı
//! (`ui/hybrid/sensitivity.js`) aynı dosyayı import eder. `golden` vektörleri
//! iki taraftaki birim testlerle ortak doğrulanır — formül/katsayı sapması her
//! iki dilde de test hatasına düşer. Yuvarlama, JS'teki `toFixed` yuvarlamasıyla
//! aynı sonucu verir (0.5'ten yukarı).

use std::sync::OnceLock;

#[derive(Debug, serde::Deserialize)]
struct MatchThresholdCoeff {
    min: f32,
    range: f32,
}

#[derive(Debug, serde::Deserialize)]
struct CutCoeff {
    max: f32,
    range: f32,
}

#[derive(Debug, serde::Deserialize)]
struct ConfirmedSpec {
    z: f32,
    confidence: f32,
}

#[derive(Debug, serde::Deserialize)]
struct GoldenCase {
    percent: u32,
    match_threshold: f32,
    min_area: u32,
    min_confidence: f32,
    seed_z: f32,
}

#[derive(Debug, serde::Deserialize)]
struct Spec {
    match_threshold: MatchThresholdCoeff,
    min_area: CutCoeff,
    min_confidence: CutCoeff,
    seed_z: CutCoeff,
    confirmed: ConfirmedSpec,
    golden: Vec<GoldenCase>,
}

fn spec() -> &'static Spec {
    static SPEC: OnceLock<Spec> = OnceLock::new();
    SPEC.get_or_init(|| {
        serde_json::from_str(include_str!("../../shared/sensitivity.json"))
            .expect("shared/sensitivity.json çözümlenemeli")
    })
}

/// Renk/sinyal toleransı: 0.15 (katı) ↔ 0.60 (ince detay).
pub fn match_threshold(sensitivity: f32) -> f32 {
    let s = sensitivity.clamp(0.0, 1.0);
    let c = &spec().match_threshold;
    round3(c.min + s * c.range)
}

/// Min yapı piksel alanı: 250 px (kütlesel) ↔ 15 px (ince detay).
pub fn min_area(sensitivity: f32) -> u32 {
    let s = sensitivity.clamp(0.0, 1.0);
    let c = &spec().min_area;
    (c.max - s * c.range).round() as u32
}

/// Min güven skoru (ADAY eşiği): 0.80 (katı) ↔ 0.15 (hassas sinyaller).
/// ONAYLI kademe bu eşiğen muaftır (`is_confirmed`).
pub fn min_confidence(sensitivity: f32) -> f32 {
    let s = sensitivity.clamp(0.0, 1.0);
    let c = &spec().min_confidence;
    round2(c.max - s * c.range)
}

/// Keşif tohumu (σ): 2.5 (yalnız güçlü sinyal) ↔ 1.0 (zayıf ama tutarlı anomaliler).
/// Yüksek hassasiyet yeni anomalileri KEŞFEDER — sadece budamaz.
pub fn seed_z(sensitivity: f32) -> f32 {
    let s = sensitivity.clamp(0.0, 1.0);
    let c = &spec().seed_z;
    round3(c.max - s * c.range)
}

/// ONAYLI kademe z-skor eşiği (σ) — yüksek oranlı tespitler.
pub fn confirmed_z() -> f32 {
    spec().confirmed.z
}

/// ONAYLI kademe güven eşiği.
pub fn confirmed_confidence() -> f32 {
    spec().confirmed.confidence
}

/// ONAYLI (yüksek oranlı) yapı güveni: hassasiyet eşiğinden muaftır (hysteresis) —
/// çubuk kısalsa da silinmezler. Amaç: yüksek oranlı yapı ve anomalileri açığa çıkarmak.
pub fn is_confirmed(conf: f32) -> bool {
    conf >= confirmed_confidence()
}

fn round2(v: f32) -> f32 {
    (v * 100.0).round() / 100.0
}

fn round3(v: f32) -> f32 {
    (v * 1000.0).round() / 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32) {
        assert!((a - b).abs() < 1e-6, "{a} ≉ {b}");
    }

    #[test]
    fn maps_zero_to_strict_thresholds() {
        approx(match_threshold(0.0), 0.15);
        assert_eq!(min_area(0.0), 250);
        approx(min_confidence(0.0), 0.80);
    }

    #[test]
    fn maps_midpoint_to_balanced_thresholds() {
        approx(match_threshold(0.5), 0.375);
        assert_eq!(min_area(0.5), 133);
        approx(min_confidence(0.5), 0.48);
    }

    #[test]
    fn maps_full_sensitivity_to_detail_thresholds() {
        approx(match_threshold(1.0), 0.60);
        assert_eq!(min_area(1.0), 15);
        approx(min_confidence(1.0), 0.15);
    }

    #[test]
    fn clamps_out_of_range_input() {
        approx(match_threshold(-1.0), 0.15);
        approx(match_threshold(2.0), 0.60);
        assert_eq!(min_area(-1.0), 250);
        assert_eq!(min_area(2.0), 15);
        approx(min_confidence(-1.0), 0.80);
        approx(min_confidence(2.0), 0.15);
    }

    #[test]
    fn seed_z_maps_discovery_thresholds() {
        approx(seed_z(0.0), 2.5);
        approx(seed_z(0.5), 1.75);
        approx(seed_z(1.0), 1.0);
        approx(seed_z(-1.0), 2.5);
        approx(seed_z(2.0), 1.0);
    }

    #[test]
    fn confirmed_tier_is_exempt_from_sensitivity_gate() {
        approx(confirmed_z(), 2.0);
        approx(confirmed_confidence(), 0.75);
        assert!(is_confirmed(0.92));
        assert!(is_confirmed(0.75));
        assert!(!is_confirmed(0.5));
        assert!(!is_confirmed(0.0));
    }

    #[test]
    fn golden_vectors_match_shared_spec() {
        for g in &spec().golden {
            let s = g.percent as f32 / 100.0;
            let mt = match_threshold(s);
            let ma = min_area(s);
            let mc = min_confidence(s);
            let sz = seed_z(s);
            assert!(
                (mt - g.match_threshold).abs() <= 0.001,
                "%{}: match_threshold {mt} ≠ {}",
                g.percent,
                g.match_threshold
            );
            assert_eq!(ma, g.min_area, "%{}: min_area", g.percent);
            assert!(
                (mc - g.min_confidence).abs() <= 0.01,
                "%{}: min_confidence {mc} ≠ {}",
                g.percent,
                g.min_confidence
            );
            assert!(
                (sz - g.seed_z).abs() <= 0.001,
                "%{}: seed_z {sz} ≠ {}",
                g.percent,
                g.seed_z
            );
        }
    }
}
