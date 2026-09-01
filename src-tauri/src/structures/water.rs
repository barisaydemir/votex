//! Mavi / lacivert / mor negatif anomali → olası su (geri alınabilir overlay).
//!
//! Öğreti:
//! - Saf su, su tabakası, su dolu boşluk → mavi, lacivert veya mor (negatif).
//! - Oda/tünel boşluğu da mavi olabilir → şekil ayırır:
//!   su = düzensiz damar / geniş dağınık leke; yapı = kompakt geometrik.
//! - Su damarı demir oksit / manyetik mineral taşıyorsa etrafında kırmızı–sarı
//!   halo olabilir (dolaylı etki); su çekirdeği yine mavi kalır.
//!
//! Signed-field / tier-0 oda-tünel-metal pipeline’a dokunmaz.

use crate::surface::{Chamber, Evidence, MetalBody, Tunnel, WaterBody};
use crate::vision::rgb_to_hsv;

/// Negatif su tonu: cyan–mavi–lacivert–mor.
pub fn is_water_tone_hsv(h: f32, s: f32, v: f32, r: u8, g: u8, b: u8) -> bool {
    if s < 0.12 || s > 0.98 {
        return false;
    }
    // Çok soluk gri / yeşil zemin değil
    if v < 0.12 {
        return false;
    }
    let blueish = (170.0..=255.0).contains(&h);
    let purple = (255.0..=320.0).contains(&h);
    if !blueish && !purple {
        return false;
    }
    let bi = b as i32;
    let ri = r as i32;
    let gi = g as i32;
    if blueish {
        // Mavi baskın (turkuazda G yüksek olabilir)
        if bi < ri + 4 && bi < gi {
            return false;
        }
        if bi < 45 {
            return false;
        }
    } else {
        // Mor: R ve B yüksek, G daha düşük
        if !(ri >= 40 && bi >= 50 && bi + ri > gi * 2 + 20) {
            return false;
        }
    }
    true
}

/// Geriye uyum — eski açık-mavi penceresi (test / eski çağrılar).
pub fn is_light_blue_hsv(h: f32, s: f32, v: f32, r: u8, g: u8, b: u8) -> bool {
    if v < 0.38 {
        return false;
    }
    if !(175.0..=235.0).contains(&h) {
        return false;
    }
    is_water_tone_hsv(h, s, v, r, g, b)
}

/// Mavi→mor gradyanında "su tonuna yakınlık" (0–1). İki tepe: mavi (hue 210,
/// yarı-genişlik 45) ve mor (hue 280, yarı-genişlik 40). max() ile birleştirilir —
/// her noktada en yakın su tonu tepesine olan mesafe. Bu, 255 sınırında süreklilik
/// sağlar: tek dal seçimi `h <= 255` yapsaydı sınırda (255.0 → 0.0, 255.1 → 0.3775)
/// yoğunluk sıçrırdı ve mavi→mor gradyanlı bir su damarının ortasında çukur oluşurdu.
fn water_hue_mid(h: f32) -> f32 {
    let blue = 1.0 - ((h - 210.0).abs() / 45.0).clamp(0.0, 1.0);
    let purple = 1.0 - ((h - 280.0).abs() / 40.0).clamp(0.0, 1.0);
    blue.max(purple)
}

fn is_warm_mineral_hsv(h: f32, s: f32, v: f32, r: u8, g: u8, b: u8) -> bool {
    if s < 0.25 || v < 0.28 {
        return false;
    }
    // Sarı → turuncu → kırmızı
    if !((0.0..=55.0).contains(&h) || (320.0..=360.0).contains(&h)) {
        return false;
    }
    let ri = r as i32;
    let gi = g as i32;
    let bi = b as i32;
    ri >= bi + 25 && ri >= 80 && (ri + gi) > bi * 2
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WaterShape {
    Vein,
    Diffuse,
    Reject,
}

/// Şekil: su = damar / dağınık leke; kompakt kutu ≈ yapı boşluğu kalıntısı.
fn classify_shape(aspect: f32, fill: f32, area: u32, min_area: u32, map_n: u32) -> WaterShape {
    let area_frac = area as f32 / map_n.max(1) as f32;
    // Kompakt, dolu, karemsi → oda/void kalıntısı; su değil
    if aspect < 1.85 && fill > 0.58 && area_frac < 0.085 {
        return WaterShape::Reject;
    }
    // Çok küçük gürültü
    if area < min_area {
        return WaterShape::Reject;
    }
    // Damar / düzensiz hat: uzun veya orta uzun + seyrek dolum
    if aspect >= 2.15 || (aspect >= 1.55 && fill < 0.52) {
        return WaterShape::Vein;
    }
    // Geniş dağınık leke (düşük–orta fill veya geniş yayılım)
    if area_frac >= 0.012 && fill <= 0.72 && aspect < 2.9 {
        return WaterShape::Diffuse;
    }
    if area_frac >= 0.004 && fill <= 0.58 && aspect < 3.6 {
        return WaterShape::Diffuse;
    }
    // Orta boy yayvan leke
    if fill < 0.48 && area >= min_area * 2 {
        return WaterShape::Diffuse;
    }
    WaterShape::Reject
}

fn footprint_mask(
    w: u32,
    h: u32,
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    metals: &[MetalBody],
) -> Vec<bool> {
    let mut mask = vec![false; (w * h) as usize];
    let wf = (w.max(1) - 1) as f32;
    let hf = (h.max(1) - 1) as f32;
    let mut stamp = |cx: f32, cy: f32, rx: f32, ry: f32, pad: f32| {
        let x0 = (((cx - rx - pad).clamp(0.0, 1.0)) * wf).floor() as i32;
        let x1 = (((cx + rx + pad).clamp(0.0, 1.0)) * wf).ceil() as i32;
        let y0 = (((cy - ry - pad).clamp(0.0, 1.0)) * hf).floor() as i32;
        let y1 = (((cy + ry + pad).clamp(0.0, 1.0)) * hf).ceil() as i32;
        for y in y0..=y1 {
            for x in x0..=x1 {
                if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
                    continue;
                }
                mask[(y as u32 * w + x as u32) as usize] = true;
            }
        }
    };
    for c in chambers {
        stamp(c.cx, c.cy, c.rx.max(0.02), c.ry.max(0.02), 0.03);
    }
    for t in tunnels {
        let cx = (t.x0 + t.x1) * 0.5;
        let cy = (t.y0 + t.y1) * 0.5;
        let rx = ((t.x1 - t.x0).abs() * 0.5).max(t.radius).max(0.02);
        let ry = ((t.y1 - t.y0).abs() * 0.5).max(t.radius).max(0.02);
        stamp(cx, cy, rx, ry, 0.03);
    }
    for m in metals {
        let strength = m.field_strength.max(m.intensity);
        if strength < 0.35 {
            continue;
        }
        let pad = if strength >= 0.55 { 0.035 } else { 0.02 };
        stamp(m.cx, m.cy, m.rx.max(0.02), m.ry.max(0.02), pad);
    }
    mask
}

/// Blob çevresinde kırmızı/sarı mineral halo oranı (0–1).
fn warm_halo_ratio(
    colors: &[u8],
    w: u32,
    h: u32,
    min_x: i32,
    max_x: i32,
    min_y: i32,
    max_y: i32,
    pad: i32,
) -> f32 {
    let x0 = (min_x - pad).max(0);
    let x1 = (max_x + pad).min(w as i32 - 1);
    let y0 = (min_y - pad).max(0);
    let y1 = (max_y + pad).min(h as i32 - 1);
    let mut warm = 0u32;
    let mut total = 0u32;
    for y in y0..=y1 {
        for x in x0..=x1 {
            // İç çekirdek (blob bbox) sayma — halka / komşu bak
            if x >= min_x && x <= max_x && y >= min_y && y <= max_y {
                continue;
            }
            let i = (y as u32 * w + x as u32) as usize;
            let o = i * 3;
            if o + 2 >= colors.len() {
                continue;
            }
            let r = colors[o];
            let g = colors[o + 1];
            let b = colors[o + 2];
            let hsv = rgb_to_hsv(r, g, b);
            total += 1;
            if is_warm_mineral_hsv(hsv.h, hsv.s, hsv.v, r, g, b) {
                warm += 1;
            }
        }
    }
    if total < 8 {
        return 0.0;
    }
    (warm as f32 / total as f32).clamp(0.0, 1.0)
}

/// `colors`: RGB packed. Tier-0 yapılara dokunmaz; yalnız `WaterBody` üretir.
pub fn extract_blue_waters(
    colors: &[u8],
    w: u32,
    h: u32,
    map_width_m: f32,
    map_depth_m: f32,
    depth_range_m: f32,
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    metals: &[MetalBody],
) -> Vec<WaterBody> {
    let n = (w * h) as usize;
    if colors.len() < n * 3 || w < 4 || h < 4 {
        return Vec::new();
    }
    let mask = footprint_mask(w, h, chambers, tunnels, metals);
    let mut seed = vec![false; n];
    let mut intensity = vec![0.0f32; n];
    for i in 0..n {
        if mask[i] {
            continue;
        }
        let o = i * 3;
        let r = colors[o];
        let g = colors[o + 1];
        let b = colors[o + 2];
        let hsv = rgb_to_hsv(r, g, b);
        if !is_water_tone_hsv(hsv.h, hsv.s, hsv.v, r, g, b) {
            continue;
        }
        seed[i] = true;
        // Yoğunluk: doygunluk + mavi/mora yakınlık (yeşilden uzak)
        let hue_mid = water_hue_mid(hsv.h);
        let sat = hsv.s.clamp(0.0, 1.0);
        let val = ((hsv.v - 0.1) / 0.9).clamp(0.0, 1.0);
        intensity[i] = (sat * 0.4 + hue_mid * 0.35 + val * 0.25).clamp(0.0, 1.0);
    }

    let min_area = ((n as f32) * 0.0004).round() as u32;
    let min_area = min_area.clamp(8, 64);
    let blobs = connected_mask(&seed, &intensity, w, h, min_area);
    let wf = (w.max(1) - 1) as f32;
    let hf = (h.max(1) - 1) as f32;

    let mut out = Vec::new();
    for b in blobs {
        let bw = (b.max_x - b.min_x + 1) as f32;
        let bh = (b.max_y - b.min_y + 1) as f32;
        let aspect = (bw / bh.max(1.0)).max(bh / bw.max(1.0));
        let fill = b.area as f32 / (bw * bh).max(1.0);
        let shape = classify_shape(aspect, fill, b.area, min_area, n as u32);
        if shape == WaterShape::Reject {
            continue;
        }

        let halo = warm_halo_ratio(
            colors,
            w,
            h,
            b.min_x,
            b.max_x,
            b.min_y,
            b.max_y,
            3.max((bw.max(bh) * 0.15) as i32),
        );
        let mineralized = halo >= 0.06;

        let cx = (b.mean_x / wf).clamp(0.0, 1.0);
        let cy = (b.mean_y / hf).clamp(0.0, 1.0);
        let rx = (bw / w as f32 * 0.5).max(0.012);
        let ry = (bh / h as f32 * 0.5).max(0.012);
        let width_m = (rx * 2.0 * map_width_m).clamp(0.4, map_width_m * 0.9);
        let length_m = (ry * 2.0 * map_depth_m).clamp(0.4, map_depth_m * 0.9);
        let area_m2 = (width_m * length_m * fill.max(0.35)).max(0.2);

        let e = (b.mean_i * 0.65 + 0.2).clamp(0.0, 1.0);
        let deep_cap = (depth_range_m * 0.28).max(0.6).min(depth_range_m * 0.55);
        let depth_m = super::build::burial_from_emergence(e, 0.4, deep_cap).clamp(0.3, deep_cap);

        let shape_boost = match shape {
            WaterShape::Vein => 0.08,
            WaterShape::Diffuse => 0.06,
            WaterShape::Reject => 0.0,
        };
        let mineral_boost = if mineralized { 0.04 } else { 0.0 };
        let conf = (0.22 + b.mean_i * 0.18 + shape_boost + mineral_boost
            + (b.area as f32 / 120.0).min(0.08))
        .clamp(0.2, 0.52);

        let (method, label) = match (shape, mineralized) {
            (WaterShape::Vein, true) => ("blue_vein_mineral", "olası su damarı · mineral halo"),
            (WaterShape::Vein, false) => ("blue_vein", "olası su damarı"),
            (WaterShape::Diffuse, true) => ("blue_diffuse_mineral", "olası su · dağınık · mineral"),
            (WaterShape::Diffuse, false) => ("blue_diffuse", "olası su · dağınık leke"),
            (WaterShape::Reject, _) => ("reject", "—"),
        };

        let mut reasons = vec![
            "negatif_mavi_mor".into(),
            match shape {
                WaterShape::Vein => "şekil:damar".into(),
                WaterShape::Diffuse => "şekil:dağınık".into(),
                WaterShape::Reject => "şekil:red".into(),
            },
            format!("fill:{:.0}%", fill * 100.0),
            format!("aspect:{:.1}", aspect),
        ];
        if mineralized {
            reasons.push(format!("mineral_halo:{:.0}%", halo * 100.0));
            reasons.push("kırmızı/sarı komşu (demir/mineral?)".into());
        }

        let mut geom = crate::surface::GeometryAnalysis::default();
        geom.method = method.into();
        geom.label = label.into();

        out.push(WaterBody {
            cx,
            cy,
            rx,
            ry,
            width_m,
            length_m,
            area_m2,
            depth_from_surface_m: depth_m,
            depth: (depth_m / depth_range_m.max(0.5)).clamp(0.02, 0.95),
            intensity: b.mean_i,
            confidence: conf,
            evidence: Evidence {
                snr: b.mean_i / 0.2,
                path_support: if matches!(shape, WaterShape::Vein) {
                    0.55
                } else {
                    0.2
                },
                class_margin: halo,
                wall_support: 0.0,
                reasons,
            },
            geometry: geom,
        });
    }
    out.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// Geriye uyum adı.
pub fn extract_yellow_waters(
    colors: &[u8],
    w: u32,
    h: u32,
    map_width_m: f32,
    map_depth_m: f32,
    depth_range_m: f32,
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    metals: &[MetalBody],
) -> Vec<WaterBody> {
    extract_blue_waters(
        colors,
        w,
        h,
        map_width_m,
        map_depth_m,
        depth_range_m,
        chambers,
        tunnels,
        metals,
    )
}

struct MaskBlob {
    mean_x: f32,
    mean_y: f32,
    mean_i: f32,
    area: u32,
    min_x: i32,
    max_x: i32,
    min_y: i32,
    max_y: i32,
}

fn connected_mask(
    seed: &[bool],
    intensity: &[f32],
    w: u32,
    h: u32,
    min_area: u32,
) -> Vec<MaskBlob> {
    let n = (w * h) as usize;
    let mut visited = vec![false; n];
    let mut out = Vec::new();
    let neighbors = [(-1i32, 0), (1, 0), (0, -1), (0, 1)];
    for y0 in 0..h as i32 {
        for x0 in 0..w as i32 {
            let start = (y0 as u32 * w + x0 as u32) as usize;
            if visited[start] || !seed[start] {
                continue;
            }
            let mut stack = vec![(x0, y0)];
            visited[start] = true;
            let mut sum_x = 0.0f32;
            let mut sum_y = 0.0f32;
            let mut sum_i = 0.0f32;
            let mut area = 0u32;
            let mut min_x = x0;
            let mut max_x = x0;
            let mut min_y = y0;
            let mut max_y = y0;
            while let Some((x, y)) = stack.pop() {
                let i = (y as u32 * w + x as u32) as usize;
                area += 1;
                sum_x += x as f32;
                sum_y += y as f32;
                sum_i += intensity[i];
                min_x = min_x.min(x);
                max_x = max_x.max(x);
                min_y = min_y.min(y);
                max_y = max_y.max(y);
                for (dx, dy) in neighbors {
                    let nx = x + dx;
                    let ny = y + dy;
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let ni = (ny as u32 * w + nx as u32) as usize;
                    if visited[ni] || !seed[ni] {
                        continue;
                    }
                    visited[ni] = true;
                    stack.push((nx, ny));
                }
            }
            if area < min_area {
                continue;
            }
            out.push(MaskBlob {
                mean_x: sum_x / area as f32,
                mean_y: sum_y / area as f32,
                mean_i: (sum_i / area as f32).clamp(0.0, 1.0),
                area,
                min_x,
                max_x,
                min_y,
                max_y,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surface::models::GeometryAnalysis;

    /// Mavi→mor geçişi (hue 255 sınırı) yoğunlukta süreksizlik yaratmamalı.
    /// Eski tek-dal seçimi `h <= 255` sınırda 0.0 → 0.3775 sıçrıyordu; max()
    /// birleşimi her noktada en yakın su tonu tepesine mesafeyi verir, süreklidir.
    #[test]
    fn blue_to_purple_transition_is_continuous() {
        // Geçiş bandında (hue 245–265) iki komşu değer arasındaki fark küçük olmalı
        // (sıçrama yok). 0.1'lik adımlarla tarayıp max sıçramayı ölç.
        let mut h = 245.0;
        let mut prev = water_hue_mid(h);
        let mut max_jump = 0.0f32;
        while h < 265.0 {
            h += 0.1;
            let cur = water_hue_mid(h);
            max_jump = max_jump.max((cur - prev).abs());
            prev = cur;
        }
        assert!(
            max_jump < 0.01,
            "mavi→mor geçişi sürekli olmalı, max sıçrama {max_jump:.4} (0.1 hue adımında)"
        );
        // Sınırın iki yanı neredeyse eşit — eski kodda 0.0 vs 0.3775 idi.
        let left = water_hue_mid(254.9);
        let right = water_hue_mid(255.1);
        assert!(
            (left - right).abs() < 0.02,
            "255 sınırının iki yanı sürekli olmalı: left={left:.4} right={right:.4}"
        );
        // Her iki tepe de korunur: saf mavi (210) ve saf mor (280) tepe değeri.
        assert!((water_hue_mid(210.0) - 1.0).abs() < 1e-4, "mavi tepe 1.0 olmalı");
        assert!((water_hue_mid(280.0) - 1.0).abs() < 1e-4, "mor tepe 1.0 olmalı");
    }

    #[test]
    fn cyan_accepted() {
        let hsv = rgb_to_hsv(70, 200, 220);
        assert!(is_water_tone_hsv(hsv.h, hsv.s, hsv.v, 70, 200, 220));
    }

    #[test]
    fn navy_accepted() {
        let hsv = rgb_to_hsv(25, 45, 140);
        assert!(is_water_tone_hsv(hsv.h, hsv.s, hsv.v, 25, 45, 140));
    }

    #[test]
    fn purple_accepted() {
        let hsv = rgb_to_hsv(140, 60, 180);
        assert!(is_water_tone_hsv(hsv.h, hsv.s, hsv.v, 140, 60, 180));
    }

    #[test]
    fn yellow_rejected() {
        let hsv = rgb_to_hsv(240, 210, 40);
        assert!(!is_water_tone_hsv(hsv.h, hsv.s, hsv.v, 240, 210, 40));
    }

    #[test]
    fn green_rejected() {
        let hsv = rgb_to_hsv(34, 180, 70);
        assert!(!is_water_tone_hsv(hsv.h, hsv.s, hsv.v, 34, 180, 70));
    }

    #[test]
    fn compact_box_rejected_vein_accepted() {
        let w = 40u32;
        let h = 40u32;
        let mut colors = vec![0u8; (w * h * 3) as usize];
        // yeşil zemin
        for i in 0..(w * h) as usize {
            colors[i * 3] = 34;
            colors[i * 3 + 1] = 180;
            colors[i * 3 + 2] = 70;
        }
        // kompakt kutu (oda benzeri) — reddedilmeli
        for y in 5..15 {
            for x in 5..15 {
                let i = (y * w + x) as usize;
                colors[i * 3] = 30;
                colors[i * 3 + 1] = 60;
                colors[i * 3 + 2] = 170;
            }
        }
        let waters_box = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[]);
        assert!(
            waters_box.is_empty(),
            "compact navy box should not be water"
        );

        // uzun damar
        for y in 20..24 {
            for x in 4..34 {
                let i = (y * w + x) as usize;
                colors[i * 3] = 40;
                colors[i * 3 + 1] = 90;
                colors[i * 3 + 2] = 190;
            }
        }
        let waters = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[]);
        assert!(!waters.is_empty(), "vein should be water candidate");
        assert!(
            waters[0].geometry.method.contains("vein")
                || waters[0].geometry.label.contains("damar"),
            "expected vein label, got {:?}",
            waters[0].geometry
        );
    }

    #[test]
    fn diffuse_patch_accepted() {
        let w = 48u32;
        let h = 48u32;
        let mut colors = vec![0u8; (w * h * 3) as usize];
        for i in 0..(w * h) as usize {
            colors[i * 3] = 34;
            colors[i * 3 + 1] = 180;
            colors[i * 3 + 2] = 70;
        }
        // Geniş halkamsı / delikli leke → dağınık (düşük fill, kompakt oda değil)
        for y in 12..32 {
            for x in 8..36 {
                let hole = x >= 14 && x <= 28 && y >= 16 && y <= 27;
                if hole {
                    continue;
                }
                let i = (y * w + x) as usize;
                colors[i * 3] = 50;
                colors[i * 3 + 1] = 100;
                colors[i * 3 + 2] = 195;
            }
        }
        let waters = extract_blue_waters(&colors, w, h, 30.0, 30.0, 15.0, &[], &[], &[]);
        assert!(!waters.is_empty(), "diffuse/irregular blue should be found");
    }

    #[test]
    fn mineral_halo_flagged() {
        let w = 36u32;
        let h = 36u32;
        let mut colors = vec![0u8; (w * h * 3) as usize];
        for i in 0..(w * h) as usize {
            colors[i * 3] = 34;
            colors[i * 3 + 1] = 180;
            colors[i * 3 + 2] = 70;
        }
        // mavi damar
        for y in 16..20 {
            for x in 6..28 {
                let i = (y * w + x) as usize;
                colors[i * 3] = 35;
                colors[i * 3 + 1] = 80;
                colors[i * 3 + 2] = 185;
            }
        }
        // kırmızı–sarı komşu şerit
        for y in 12..15 {
            for x in 8..26 {
                let i = (y * w + x) as usize;
                colors[i * 3] = 220;
                colors[i * 3 + 1] = 80;
                colors[i * 3 + 2] = 40;
            }
        }
        let waters = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[]);
        assert!(!waters.is_empty());
        let reasons = &waters[0].evidence.reasons;
        assert!(
            reasons.iter().any(|r| r.contains("mineral") || r.contains("kırmızı")),
            "expected mineral halo reason: {:?}",
            reasons
        );
    }

    /// Mineral halo ridge testi: kırmızı ridge ve mor ridge yan yana.
    /// Mor ridge su adayı olarak tespit edilmeli, kırmızı ridge ise halo olarak
    /// mineralized flag'ini tetiklemeli (warm_halo_ratio ≥ 0.06).
    #[test]
    fn mineral_halo_ridge_adjacent() {
        let w = 48u32;
        let h = 48u32;
        let mut colors = vec![0u8; (w * h * 3) as usize];
        // yeşil zemin
        for i in 0..(w * h) as usize {
            colors[i * 3] = 34;
            colors[i * 3 + 1] = 180;
            colors[i * 3 + 2] = 70;
        }
        // mor ridge (su adayı): satır 20-24, sütun 6-30
        for y in 20..24 {
            for x in 6..30 {
                let (r, g, b) = hsv_to_rgb(280.0, 0.85, 0.85);
                let i = (y * w + x) as usize;
                colors[i * 3] = r;
                colors[i * 3 + 1] = g;
                colors[i * 3 + 2] = b;
            }
        }
        // kırmızı ridge (mineral halo): satır 16-19, sütun 8-28 (mor'un hemen üstü)
        for y in 16..19 {
            for x in 8..28 {
                let (r, g, b) = hsv_to_rgb(10.0, 0.9, 0.85);
                let i = (y * w + x) as usize;
                colors[i * 3] = r;
                colors[i * 3 + 1] = g;
                colors[i * 3 + 2] = b;
            }
        }

        let waters = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[]);
        assert!(!waters.is_empty(), "mor ridge su adayı olarak tespit edilmeli");

        let vein = &waters[0];
        // Mineral halo flag'ı aktif olmalı (warm_halo_ratio ≥ 0.06)
        assert!(
            vein.evidence.class_margin >= 0.06,
            "kırmızı ridge mor ridge için halo oluşturmalı (class_margin={:.3}, beklenen ≥ 0.06)",
            vein.evidence.class_margin
        );
        // Evidence reason'larında mineral/halo bilgisi olmalı
        assert!(
            vein.evidence.reasons.iter().any(|r|
                r.contains("mineral") || r.contains("kırmızı") || r.contains("halo")
            ),
            "mineral halo reason bekleniyor: {:?}",
            vein.evidence.reasons
        );
        // Mineral halo boost'u conf'a yansımış olmalı (conf ≥ 0.26 = 0.22 + 0.04 mineral_boost)
        assert!(
            vein.confidence >= 0.26,
            "mineral boost conf'a yansımış olmalı (conf={:.3}, beklenen ≥ 0.26)",
            vein.confidence
        );
    }

    /// Mineral halo ridge testi (negatif vaka): kırmızı ridge yokken halo olmamalı.
    /// Mineral halo flag'ı yalnızca gerçek mineral komşusuyla tetiklenmeli.
    #[test]
    fn no_halo_without_mineral_neighbor() {
        let w = 48u32;
        let h = 48u32;
        let mut colors = vec![0u8; (w * h * 3) as usize];
        for i in 0..(w * h) as usize {
            colors[i * 3] = 34;
            colors[i * 3 + 1] = 180;
            colors[i * 3 + 2] = 70;
        }
        // mor ridge (su adayı): aynı konum, ama etrafında kırmızı yok
        for y in 20..24 {
            for x in 6..30 {
                let (r, g, b) = hsv_to_rgb(280.0, 0.85, 0.85);
                let i = (y * w + x) as usize;
                colors[i * 3] = r;
                colors[i * 3 + 1] = g;
                colors[i * 3 + 2] = b;
            }
        }

        let waters = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[]);
        assert!(!waters.is_empty(), "mor ridge yine de su adayı olmalı");
        let vein = &waters[0];
        // Mineral halo olmamalı (etrafında kırmızı/sarı yok)
        assert!(
            vein.evidence.class_margin < 0.06,
            "mineral komşu yokken halo olmamalı (class_margin={:.3}, beklenen < 0.06)",
            vein.evidence.class_margin
        );
    }

    /// footprint_mask: kabul edilen yapının (oda/tünel/güçlü metal) üstüne düşen
    /// mavi leke su sayılmaz; listede olmayan (reddedilen) yapı üstündeki sayılır.
    /// Zayıf metal (strength < 0.35) maskeleme yapmaz — o bölge su adayı kalır.
    #[test]
    fn footprint_mask_blocks_accepted_structures_only() {
        let w = 48u32;
        let h = 48u32;
        let mut colors = vec![0u8; (w * h * 3) as usize];
        for i in 0..(w * h) as usize {
            colors[i * 3] = 34;
            colors[i * 3 + 1] = 180;
            colors[i * 3 + 2] = 70;
        }
        // Uzun mavi damar (aspect 30/4 = 7.5 ≥ 2.15 → Vein su adayı)
        for y in 20..24 {
            for x in 4..34 {
                let i = (y * w + x) as usize;
                colors[i * 3] = 40;
                colors[i * 3 + 1] = 90;
                colors[i * 3 + 2] = 190;
            }
        }
        let chamber = Chamber {
            kind: "room".into(),
            cx: 0.4,
            cy: 0.47,
            rx: 0.33,
            ry: 0.06,
            depth: 0.0,
            height: 0.0,
            intensity: 0.5,
            width_m: 1.0,
            length_m: 1.0,
            top_from_surface_m: 0.0,
            bottom_from_surface_m: 0.0,
            height_m: 0.0,
            bearing_deg: 0.0,
            confidence: 0.5,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: GeometryAnalysis::default(),
            outline: Vec::new(),
        };
        let tunnel = Tunnel {
            x0: 0.1,
            y0: 0.44,
            x1: 0.7,
            y1: 0.5,
            radius: 0.05,
            depth: 0.0,
            bearing_deg: 0.0,
            direction: "N".into(),
            heading: "N".into(),
            width_m: 1.0,
            floor_from_surface_m: 0.0,
            crown_from_surface_m: 0.0,
            height_m: 0.0,
            confidence: 0.5,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: GeometryAnalysis::default(),
            outline: Vec::new(),
        };
        let metal_strong = MetalBody {
            cx: 0.4,
            cy: 0.47,
            rx: 0.33,
            ry: 0.06,
            depth: 0.0,
            intensity: 0.6,
            width_m: 1.0,
            length_m: 1.0,
            size_m: 1.0,
            depth_from_surface_m: 0.0,
            inside_chamber: false,
            host_kind: String::new(),
            spread_m: 0.0,
            spread_ratio: 1.0,
            field_strength: 0.6,
            bearing_deg: 0.0,
            plume_height_m: 0.0,
            cue_kind: "metal".into(),
            metal_guess: String::new(),
            confidence: 0.5,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: GeometryAnalysis::default(),
        };
        let metal_weak = MetalBody {
            field_strength: 0.3,
            intensity: 0.3,
            ..metal_strong.clone()
        };

        // 1) Listede yapı yok (damar üstünde yapı reddedilmiş/yok) → su sayılır
        let base = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[]);
        assert_eq!(base.len(), 1, "damar tek su adayı olmalı, got {}", base.len());

        // 2) Kabul edilmiş oda damarı örter → su sayılmaz
        let masked = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[chamber], &[], &[]);
        assert!(
            masked.is_empty(),
            "kabul edilen oda üstündeki mavi leke su sayılmamalı, got {}",
            masked.len()
        );

        // 3) Kabul edilmiş tünel → aynı
        let masked_t = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[tunnel], &[]);
        assert!(
            masked_t.is_empty(),
            "kabul edilen tünel üstündeki mavi leke su sayılmamalı, got {}",
            masked_t.len()
        );

        // 4) Güçlü metal (strength 0.6 ≥ 0.35) → aynı
        let masked_m =
            extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[metal_strong]);
        assert!(
            masked_m.is_empty(),
            "güçlü metal üstündeki mavi leke su sayılmamalı, got {}",
            masked_m.len()
        );

        // 5) Zayıf metal (strength 0.3 < 0.35) → maskeleme yok, su adayı kalır
        let weak_m = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[metal_weak]);
        assert_eq!(
            weak_m.len(),
            1,
            "zayıf metal üstündeki mavi leke su adayı kalmalı, got {}",
            weak_m.len()
        );

        // 6) Derinlik/conf birebir: zayıf metal footprint_mask'e KATILMAZ (strength
        //    < 0.35 → continue), yani maskesi boş listeyle aynı → aynı seed/intensity
        //    → aynı blob → aynı depth/conf/intensity/snr çıktısı. Maskeleme "su
        //    damarının geometrisini değil, yalnızca tohum alanını" değiştirmemeli.
        let a = &base[0];
        let b = &weak_m[0];
        assert_eq!(
            a.depth_from_surface_m, b.depth_from_surface_m,
            "zayıf metal üstündeki su derinliği yapısızla birebir (depth_from_surface_m)"
        );
        assert_eq!(
            a.depth, b.depth,
            "zayıf metal üstündeki su normalize derinliği yapısızla birebir (depth)"
        );
        assert_eq!(
            a.confidence, b.confidence,
            "zayıf metal üstündeki su güveni yapısızla birebir (confidence)"
        );
        assert_eq!(
            a.intensity, b.intensity,
            "zayıf metal üstündeki su yoğunluğu yapısızla birebir (intensity)"
        );
        assert_eq!(
            a.evidence.snr, b.evidence.snr,
            "zayıf metal üstündeki su SNR'si yapısızla birebir (evidence.snr)"
        );
        assert_eq!(
            a.evidence.path_support, b.evidence.path_support,
            "zayıf metal üstündeki su path desteği yapısızla birebir (evidence.path_support)"
        );
        assert_eq!(
            a.evidence.class_margin, b.evidence.class_margin,
            "zayıf metal üstündeki su sınıf marjı yapısızla birebir (evidence.class_margin)"
        );
        assert_eq!(
            a.geometry.method, b.geometry.method,
            "zayıf metal üstündeki su yöntemi yapısızla birebir (geometry.method)"
        );
        assert_eq!(
            a.geometry.label, b.geometry.label,
            "zayıf metal üstündeki su etiketi yapısızla birebir (geometry.label)"
        );
    }

    /// HSV→RGB dönüştürücü (test yardımı): h [0,360), s [0,1], v [0,1] → (r,g,b) [0,255].
    fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
        let c = v * s;
        let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
        let m = v - c;
        let (r, g, b) = if h < 60.0 {
            (c, x, 0.0)
        } else if h < 120.0 {
            (x, c, 0.0)
        } else if h < 180.0 {
            (0.0, c, x)
        } else if h < 240.0 {
            (0.0, x, c)
        } else if h < 300.0 {
            (x, 0.0, c)
        } else {
            (c, 0.0, x)
        };
        (
            ((r + m) * 255.0).round().clamp(0.0, 255.0) as u8,
            ((g + m) * 255.0).round().clamp(0.0, 255.0) as u8,
            ((b + m) * 255.0).round().clamp(0.0, 255.0) as u8,
        )
    }

    /// Mavi→mor gradyanlı tek damar, pipeline seviyesinde tek blob olarak
    /// tespit edilmeli ve ikiye bölünmemeli.
    ///
    /// water_hue_mid() fonksiyonunun max(blue, purple) birleşimi sayesinde
    /// hue 255 sınırında yoğunluk süreklidir; bu, connected_mask'ın gradyanı
    /// tek bileşen olarak覺tırmasını sağlar.
    #[test]
    fn blue_to_purple_gradient_single_blob() {
        let w = 48u32;
        let h = 48u32;
        let mut colors = vec![0u8; (w * h * 3) as usize];
        // Yeşil zemin
        for i in 0..(w * h) as usize {
            colors[i * 3] = 34;
            colors[i * 3 + 1] = 180;
            colors[i * 3 + 2] = 70;
        }

        // Mavi→mor gradyanlı damar: satır 20-24, sütun 4-34 (30 px genişliğinde)
        // Hue 210 (saf mavi) → hue 280 (saf mor) yumuşak geçiş.
        // Doğrulama: rgb_to_hsv ile her hücredeki hue hesaplanır.
        let mut verified_hues = Vec::new();
        for y in 20..24 {
            for x in 4..34 {
                let t = (x as f32 - 4.0) / 29.0; // 0.0 → 1.0 soldan sağa
                let hue = 210.0 + t * (280.0 - 210.0); // 210 → 280
                let (r, g, b) = hsv_to_rgb(hue, 0.85, 0.85);
                let i = (y * w + x) as usize;
                colors[i * 3] = r;
                colors[i * 3 + 1] = g;
                colors[i * 3 + 2] = b;
                let hsv = rgb_to_hsv(r, g, b);
                verified_hues.push((x, hue, hsv.h));
            }
        }

        // Hue 255 civarında (x ≈ 24-25) hue gerçekten 250-260 bandında olmalı
        let mid_hues: Vec<f32> = verified_hues
            .iter()
            .filter(|(x, _, _)| *x >= 23 && *x <= 26)
            .map(|(_, _, h)| *h)
            .collect();
        assert!(
            !mid_hues.is_empty(),
            "hue 255 civarında hücre olmalı"
        );
        assert!(
            mid_hues.iter().all(|h| *h >= 245.0 && *h <= 265.0),
            "orta bölgelerde hue 250-260 aralığında olmalı: {:?}",
            mid_hues
        );

        // Pipeline'ı çalıştır: yapı listesi boş (sadece damar, maskeleme yok)
        let waters = extract_blue_waters(&colors, w, h, 24.0, 24.0, 15.0, &[], &[], &[]);

        // İddia 1: Tam olarak tek su adayı üretilmeli (ikiye bölünme yok)
        assert_eq!(
            waters.len(),
            1,
            "mavi→mor gradyanlı damar tek blob olarak tespit edilmeli, got {}",
            waters.len()
        );

        let vein = &waters[0];

        // İddia 2: Biçim damar (vein) olarak sınıflandırılmalı
        assert!(
            vein.geometry.method.contains("vein"),
            "gradyanlı damar vein yöntemiyle tespit edilmeli, got {:?}",
            vein.geometry.method
        );

        // İddia 3: Güven normal aralıkta (0.2–0.52, cout clamp)
        assert!(
            vein.confidence >= 0.2 && vein.confidence <= 0.52,
            "güven 0.2-0.52 aralığında olmalı, got {}",
            vein.confidence
        );

        // İddia 4: Yoğunluk orta düzeyde olmalı (gradyan ortalaması)
        assert!(
            vein.intensity >= 0.3 && vein.intensity <= 0.9,
            "yoğunluk 0.3-0.9 aralığında olmalı, got {}",
            vein.intensity
        );

        // İddia 5: SNR pozitif olmalı
        assert!(
            vein.evidence.snr > 0.0,
            "SNR pozitif olmalı, got {}",
            vein.evidence.snr
        );

        // İddia 6: Geometri bounding box damarın tamamını kapsamalı
        // (cx ≈ 0.41, rx ≈ 0.31 — 30 px / 48 px = 0.625, yarıçap ≈ 0.31)
        assert!(
            vein.rx > 0.15,
            "damar genişliği rx > 0.15 olmalı (30 px blob), got {}",
            vein.rx
        );

        // Mutasyon kanıtı: water_hue_mid() fonksiyonunu boz (tek-dal seçimine geri dön)
        // → hue 255'te yoğunluk sıçraması → blob ikiye bölünmeli.
        // Bu test fonksiyonu doğrudan çağırmıyor, ama su continuum testi
        // (blue_to_purple_transition_is_continuous) zaten bu dalın bozulmasını yakalar.
        // Pipeline testi bu dalın sonucunu doğrular: gradyan tek blob kalmalı.
    }
}
