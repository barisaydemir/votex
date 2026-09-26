//! Şablon eşleştirme katmanı — anomali şekillerini oda / tünel / şaft / metal
//! şablon maskeleriyle korelasyon eşleştirmesiyle sınıflandırır.
//!
//! Yöntem:
//! 1. Ölçüm kontürü (marching-squares poligonu) bbox-normalize G×G ikili
//!    maskeye rasterleştirilir (nokta-içinde-poligon taraması).
//! 2. Dört şablon maskesi de aynı bbox-uzayında üretilir: oda = dolu
//!    dikdörtgen, tünel = kapsül/stadyum, şaft = iç teğet elips, metal =
//!    kompakt daire.
//! 3. Her şablonla Dice katsayısı (2|A∩B| / (|A|+|B|)) hesaplanır; geometri
//!    ağırlığı 0.62, fiziksel öncüller (yönelim, güç, kutup, ölçü) 0.38'dir.
//! 4. En yüksek skor < 0.40 ise sonuç "anomali" — hiçbir şablona güvenilir
//!    biçimde oturmuyor demektir.

/// Şablon anahtarları (skorlama sırası).
pub const TEMPLATE_KEYS: [&str; 4] = ["room", "tunnel", "shaft", "metal"];

/// Bu skorun altındaki en iyi eşleşme "anomali" (şablon yok) sayılır.
const BEST_FLOOR: f32 = 0.40;

/// Maske çözünürlüğü (G×G hücre).
const G: usize = 24;

/// Şablon eşleştirme sonucu.
#[derive(Clone, Debug)]
pub struct TemplateMatch {
    /// room | tunnel | shaft | metal | anomaly
    pub best: &'static str,
    /// En iyi şablonun bileşik skoru (0–1).
    pub score: f32,
    /// Tüm şablonların bileşik skorları (TEMPLATE_KEYS sırasıyla).
    pub scores: Vec<(&'static str, f32)>,
}

/// Poligonu bbox-normalize ikili maskeye rasterle.
/// Döner: (maske, maske hücre sayısı). Poligon geçersizse None.
fn rasterize_polygon(polygon: &[[f32; 2]]) -> Option<([bool; G * G], u32)> {
    if polygon.len() < 3 {
        return None;
    }
    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for &[x, y] in polygon {
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
    }
    let w = (max_x - min_x).max(1e-6);
    let h = (max_y - min_y).max(1e-6);

    // Ray-casting nokta-içinde-poligon.
    let inside = |px: f32, py: f32| -> bool {
        let mut inside = false;
        let mut j = polygon.len() - 1;
        for i in 0..polygon.len() {
            let [xi, yi] = polygon[i];
            let [xj, yj] = polygon[j];
            if (yi > py) != (yj > py)
                && px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi
            {
                inside = !inside;
            }
            j = i;
        }
        inside
    };

    let mut mask = [false; G * G];
    let mut count = 0u32;
    for gy in 0..G {
        for gx in 0..G {
            // Hücre merkezi → poligon uzayı
            let u = (gx as f32 + 0.5) / G as f32;
            let v = (gy as f32 + 0.5) / G as f32;
            if inside(min_x + u * w, min_y + v * h) {
                mask[gy * G + gx] = true;
                count += 1;
            }
        }
    }
    if count == 0 {
        return None;
    }
    Some((mask, count))
}

/// [-1,1]² hücre merkez koordinatı.
fn cell_uv(idx: usize) -> (f32, f32) {
    let gx = idx % G;
    let gy = idx / G;
    (
        ((gx as f32 + 0.5) / G as f32) * 2.0 - 1.0,
        ((gy as f32 + 0.5) / G as f32) * 2.0 - 1.0,
    )
}

/// Oda: dolu dikdörtgen (küçük %5 iç pay — duvar kalınlığı toleransı).
fn mask_room() -> [bool; G * G] {
    let mut mask = [false; G * G];
    for (i, cell) in mask.iter_mut().enumerate() {
        let (u, v) = cell_uv(i);
        *cell = u.abs() <= 0.95 && v.abs() <= 0.95;
    }
    mask
}

/// Tünel: kapsül / stadyum (yuvarlatılmış dikdörtgen SDF).
fn mask_tunnel() -> [bool; G * G] {
    let mut mask = [false; G * G];
    for (i, cell) in mask.iter_mut().enumerate() {
        let (u, v) = cell_uv(i);
        // Yuvarlatılmış dikdörtgen: iç dikdörtgen ±0.5, köşe yarıçapı 0.5
        let (bx, by) = (0.5, 0.5);
        let (dx, dy) = ((u.abs() - bx).max(0.0), (v.abs() - by).max(0.0));
        *cell = (dx * dx + dy * dy).sqrt() <= 0.5 || (u.abs() <= bx && v.abs() <= by);
    }
    mask
}

/// Şaft: bbox'a iç teğet elips.
fn mask_shaft() -> [bool; G * G] {
    let mut mask = [false; G * G];
    for (i, cell) in mask.iter_mut().enumerate() {
        let (u, v) = cell_uv(i);
        *cell = u * u + v * v <= 1.0;
    }
    mask
}

/// Metal: kompakt daire (yarıçap 0.85·kısa eksen — kutup merkezi dolu).
fn mask_metal() -> [bool; G * G] {
    let mut mask = [false; G * G];
    for (i, cell) in mask.iter_mut().enumerate() {
        let (u, v) = cell_uv(i);
        // Bbox'ın kısa eksenine göre daire: |uv| ≤ 0.85 olan iç daire yalnız
        // kompakt adayları ödüllendirir; uzgun adayda dolduramadığı için
        // Dice düşer.
        *cell = u * u + v * v <= 0.72; // r = 0.85
    }
    mask
}

/// İkili maske çifti için Dice katsayısı.
fn dice(a: &[bool; G * G], b: &[bool; G * G]) -> f32 {
    let mut inter = 0u32;
    let mut sum = 0u32;
    for i in 0..G * G {
        let (x, y) = (a[i] as u32, b[i] as u32);
        inter += x.min(y);
        sum += x + y;
    }
    if sum == 0 {
        return 0.0;
    }
    (2.0 * inter as f32) / (sum as f32)
}

/// Anomali şeklini şablonlarla eşleştir.
///
/// * `polygon` — normalize [0,1] ölçüm kontürü (MS poligonu)
/// * `rx`, `ry` — yarı ölçüler (m)
/// * `strength` — tepe gücü (σ)
/// * `polarity` — +1 metal/beton, −1 boşluk benzeri
pub fn match_templates(
    polygon: &[[f32; 2]],
    rx: f32,
    ry: f32,
    strength: f32,
    polarity: f32,
) -> TemplateMatch {
    let empty = TemplateMatch {
        best: "anomaly",
        score: 0.0,
        scores: TEMPLATE_KEYS.iter().map(|&k| (k, 0.0)).collect(),
    };
    let Some((mask, _count)) = rasterize_polygon(polygon) else {
        return empty;
    };

    let aspect = (rx.max(ry) / rx.min(ry).max(0.05)).max(1.0);
    let elongation = ((aspect - 1.0) / 2.5).clamp(0.0, 1.0);
    let compactness = 1.0 - elongation;
    let pos_pol = if polarity > 0.0 { 1.0 } else { 0.0 };
    let strength_norm = ((strength - 1.0) / 2.5).clamp(0.0, 1.0);
    let small_size = (1.0 - ((rx.min(ry) - 0.4) / 1.4).clamp(0.0, 1.0)).max(0.0);

    // Fiziksel öncüller (0–1): geometri maskelerinin ayırt edemediği
    // saha bilgisi — güç, kutup ve ölçü.
    let prior_room = 0.40 * compactness
        + 0.30 * (1.0 - pos_pol)
        + 0.30 * (1.0 - ((aspect - 1.6) / 1.4).clamp(0.0, 1.0));
    let prior_tunnel = 0.60 * elongation + 0.25 * (1.0 - pos_pol) + 0.15 * (1.0 - compactness);
    let prior_shaft =
        0.45 * compactness + 0.25 * (1.0 - pos_pol) + 0.20 * small_size + 0.10 * (1.0 - strength_norm);
    let prior_metal =
        0.30 * compactness + 0.35 * strength_norm + 0.25 * pos_pol + 0.10 * small_size;

    let priors = [prior_room, prior_tunnel, prior_shaft, prior_metal];
    let geometries = [mask_room(), mask_tunnel(), mask_shaft(), mask_metal()];

    let mut scores: Vec<(&'static str, f32)> = TEMPLATE_KEYS
        .iter()
        .zip(priors.iter())
        .zip(geometries.iter())
        .map(|((&key, &prior), geo)| (key, (0.62 * dice(&mask, geo) + 0.38 * prior).clamp(0.0, 1.0)))
        .collect();

    scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let (best_key, best_score) = scores[0];
    if best_score < BEST_FLOOR {
        return TemplateMatch {
            best: "anomaly",
            score: best_score,
            scores,
        };
    }
    TemplateMatch {
        best: best_key,
        score: best_score,
        scores,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    fn circle_polygon(cx: f32, cy: f32, r: f32, n: usize) -> Vec<[f32; 2]> {
        (0..n)
            .map(|i| {
                let a = i as f32 / n as f32 * 2.0 * PI;
                [cx + a.cos() * r, cy + a.sin() * r]
            })
            .collect()
    }

    fn rect_polygon(cx: f32, cy: f32, hw: f32, hh: f32) -> Vec<[f32; 2]> {
        vec![
            [cx - hw, cy - hh],
            [cx + hw, cy - hh],
            [cx + hw, cy + hh],
            [cx - hw, cy + hh],
        ]
    }

    fn stadium_polygon(cx: f32, cy: f32, half: f32, r: f32, n: usize) -> Vec<[f32; 2]> {
        let mut pts = Vec::new();
        for i in 0..n / 2 {
            let a = -PI / 2.0 + (i as f32 / (n / 2 - 1) as f32) * PI;
            pts.push([cx + half + a.cos() * r, cy + a.sin() * r]);
        }
        for i in 0..n / 2 {
            let a = PI / 2.0 + (i as f32 / (n / 2 - 1) as f32) * PI;
            pts.push([cx - half + a.cos() * r, cy + a.sin() * r]);
        }
        pts
    }

    #[test]
    fn elongated_shape_matches_tunnel() {
        let poly = stadium_polygon(0.5, 0.5, 0.28, 0.08, 48);
        let m = match_templates(&poly, 1.2, 0.35, 1.8, -1.0);
        assert_eq!(m.best, "tunnel", "skorlar: {:?}", m.scores);
        assert!(m.score >= 0.5, "skor={}", m.score);
    }

    #[test]
    fn rectangular_shape_matches_room() {
        let poly = rect_polygon(0.5, 0.5, 0.3, 0.18);
        let m = match_templates(&poly, 1.0, 0.62, 1.5, -1.0);
        assert_eq!(m.best, "room", "skorlar: {:?}", m.scores);
        assert!(m.score >= 0.5, "skor={}", m.score);
    }

    #[test]
    fn compact_weak_negative_matches_shaft() {
        let poly = circle_polygon(0.5, 0.5, 0.16, 32);
        let m = match_templates(&poly, 0.4, 0.4, 1.2, -1.0);
        assert_eq!(m.best, "shaft", "skorlar: {:?}", m.scores);
    }

    #[test]
    fn compact_strong_positive_matches_metal() {
        let poly = circle_polygon(0.5, 0.5, 0.18, 32);
        let m = match_templates(&poly, 0.45, 0.45, 3.2, 1.0);
        assert_eq!(m.best, "metal", "skorlar: {:?}", m.scores);
        assert!(m.score >= 0.5, "skor={}", m.score);
    }

    #[test]
    fn degenerate_polygon_falls_back_to_anomaly() {
        let m = match_templates(&[[0.2, 0.2], [0.8, 0.8]], 0.5, 0.5, 2.0, 1.0);
        assert_eq!(m.best, "anomaly");
        let empty: Vec<[f32; 2]> = Vec::new();
        assert_eq!(match_templates(&empty, 0.5, 0.5, 2.0, 1.0).best, "anomaly");
    }
}
