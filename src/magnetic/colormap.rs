//! Bipolar jeofiziksel colormap — Proton ELIC polarite paleti.

use super::types::{AnomalyClass, ColorPalette, Rgba};

#[inline]
fn lerp_u8(a: u8, b: u8, t: f32) -> u8 {
    let t = t.clamp(0.0, 1.0);
    (a as f32 + (b as f32 - a as f32) * t).round() as u8
}

#[inline]
fn lerp_rgba(a: Rgba, b: Rgba, t: f32) -> Rgba {
    Rgba::new(
        lerp_u8(a.r, b.r, t),
        lerp_u8(a.g, b.g, t),
        lerp_u8(a.b, b.b, t),
        lerp_u8(a.a, b.a, t),
    )
}

/// Eşit aralıklı renk durakları arasında lineer interpolasyon.
fn lerp_stops(stops: &[Rgba], t: f32) -> Rgba {
    let t = t.clamp(0.0, 1.0);
    if stops.is_empty() {
        return Rgba::rgb(0, 0, 0);
    }
    if stops.len() == 1 || t <= 0.0 {
        return stops[0];
    }
    if t >= 1.0 {
        return *stops.last().unwrap();
    }
    let segments = (stops.len() - 1) as f32;
    let x = t * segments;
    let i = (x.floor() as usize).min(stops.len() - 2);
    let local = x - i as f32;
    lerp_rgba(stops[i], stops[i + 1], local)
}

/// İşaretli normalize değer (−1..+1) → RGBA.
///
/// * `|signed_norm|` küçük / nötr tolerans → yeşil
/// * `> 0` → Yeşil → Sarı → Turuncu → Kırmızı
/// * `< 0` → Yeşil → Açık Mavi → Koyu Mavi
pub fn map_signed_norm(
    signed_norm: f32,
    absolute_delta: f32,
    neutral_tolerance: f32,
    palette: &ColorPalette,
) -> (Rgba, AnomalyClass, f32) {
    let intensity = signed_norm.abs().clamp(0.0, 1.0);

    if absolute_delta.abs() <= neutral_tolerance {
        return (palette.neutral, AnomalyClass::Neutral, 0.0);
    }

    if signed_norm >= 0.0 {
        let color = lerp_stops(&palette.positive_stops, intensity);
        (color, AnomalyClass::PositiveMetal, intensity)
    } else {
        let color = lerp_stops(&palette.negative_stops, intensity);
        (color, AnomalyClass::NegativeVoid, intensity)
    }
}

/// Tek bir ham değeri asimetrik ölçek + palet ile renklendir.
pub fn value_to_color(
    value: f32,
    ground: f32,
    peak_positive: f32,
    peak_negative: f32,
    neutral_tolerance: f32,
    palette: &ColorPalette,
) -> (Rgba, AnomalyClass, f32, f32) {
    use super::calibration::AsymmetricRange;
    let range = AsymmetricRange::with_peaks(ground, peak_positive, peak_negative);
    let delta = value - ground;
    let signed = range.signed_norm(value);
    let (color, class, intensity) =
        map_signed_norm(signed, delta, neutral_tolerance, palette);
    (color, class, intensity, delta)
}

/// 0..1 dikey cetvel (üst = peak+, alt = peak−) — UI LUT / legend için.
/// `t = 0` → peak negative (koyu mavi), `t = 1` → peak positive (kırmızı).
pub fn legend_color(t: f32, palette: &ColorPalette) -> Rgba {
    let t = t.clamp(0.0, 1.0);
    // 0..0.5 negatif, 0.5 nötr, 0.5..1 pozitif
    if (t - 0.5).abs() < 0.02 {
        return palette.neutral;
    }
    if t > 0.5 {
        let local = (t - 0.5) * 2.0;
        lerp_stops(&palette.positive_stops, local)
    } else {
        let local = (0.5 - t) * 2.0;
        lerp_stops(&palette.negative_stops, local)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positive_peak_is_reddish() {
        let p = ColorPalette::default();
        let (c, class, _) = map_signed_norm(1.0, 500.0, 25.0, &p);
        assert_eq!(class, AnomalyClass::PositiveMetal);
        assert!(c.r > 180);
        assert!(c.g < 80);
    }

    #[test]
    fn negative_peak_is_blueish() {
        let p = ColorPalette::default();
        let (c, class, _) = map_signed_norm(-1.0, -1200.0, 25.0, &p);
        assert_eq!(class, AnomalyClass::NegativeVoid);
        assert!(c.b > 120);
        assert!(c.r < 80);
    }

    #[test]
    fn neutral_is_green() {
        let p = ColorPalette::default();
        let (c, class, _) = map_signed_norm(0.05, 10.0, 25.0, &p);
        assert_eq!(class, AnomalyClass::Neutral);
        assert!(c.g > c.r && c.g > c.b);
    }
}
