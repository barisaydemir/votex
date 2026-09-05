//! İşaretli manyetik alan üretimi — `src-tauri/src/surface/field.rs` port.
//!
//! Sensör modeli (Proton ELIC):
//! - Yeşil = yeryüzü / Z0 (nötr)
//! - Yeşil → sarı → turuncu → kırmızı → beyaz = pozitif çıkış (+)
//! - Yeşil → açık mavi → koyu mavi = negatif çıkış (−)
//! - İnce beyaz çizgi (yeşil içi ridge) = duvar/tünel ipucu → alan 0

// ── HSV (lib.rs ile aynı çekirdek) ─────────────────────────

#[derive(Clone, Copy)]
struct Hsv {
    h: f32,
    s: f32,
    v: f32,
}

fn rgb_to_hsv(r: u8, g: u8, b: u8) -> Hsv {
    let r = r as f32 / 255.0;
    let g = g as f32 / 255.0;
    let b = b as f32 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let v = max;
    let s = if max <= 1e-6 { 0.0 } else { d / max };
    let h = if d <= 1e-6 {
        0.0
    } else if (max - r).abs() < 1e-6 {
        60.0 * (((g - b) / d) % 6.0)
    } else if (max - g).abs() < 1e-6 {
        60.0 * (((b - r) / d) + 2.0)
    } else {
        60.0 * (((r - g) / d) + 4.0)
    };
    let h = if h < 0.0 { h + 360.0 } else { h };
    Hsv { h, s, v }
}

fn hsv_dist(a: Hsv, b: Hsv) -> f32 {
    let mut dh = (a.h - b.h).abs();
    if dh > 180.0 {
        dh = 360.0 - dh;
    }
    (dh / 180.0).powi(2) + (a.s - b.s).powi(2) * 0.5 + (a.v - b.v).powi(2) * 0.35
}

fn is_greenish(h: f32, s: f32, v: f32) -> bool {
    s > 0.15 && v > 0.15 && (70.0..=170.0).contains(&h)
}

fn lut_index_to_signed(idx: usize, len: usize) -> f32 {
    if len <= 1 {
        return 0.0;
    }
    1.0 - 2.0 * (idx as f32 / (len - 1) as f32)
}

fn best_lut_match(px: Hsv, lut: &[Hsv]) -> (usize, f32) {
    let mut best_i = 0usize;
    let mut best_d = f32::MAX;
    for (i, sample) in lut.iter().enumerate() {
        let d = hsv_dist(px, *sample);
        if d < best_d {
            best_d = d;
            best_i = i;
        }
    }
    (best_i, best_d)
}

// ── Polarite yardımcıları (field.rs birebir) ───────────────

fn is_near_white(l: f32, s: f32) -> bool {
    (l >= 165.0 && s <= 0.32) || (l >= 195.0 && s <= 0.42)
}

fn is_warm_rgb(r: u8, g: u8, b: u8) -> bool {
    let r = r as i32;
    let g = g as i32;
    let b = b as i32;
    (r > g && r > b && r > 70)
        || (r > 160 && g > 120 && b < 130)
        || (r >= g - 5 && r >= b + 8 && r > 140)
}

fn is_cool_rgb(r: u8, g: u8, b: u8) -> bool {
    let r = r as i32;
    let g = g as i32;
    let b = b as i32;
    b > r + 10 && b >= g - 15 && b > 55
}

fn is_green_rgb(r: u8, g: u8, b: u8) -> bool {
    let hsv = rgb_to_hsv(r, g, b);
    is_greenish(hsv.h, hsv.s, hsv.v)
}

fn positive_bloom_from_white(r: u8, g: u8, b: u8, l: f32, hsv: Hsv) -> f32 {
    let warm_boost = if is_warm_rgb(r, g, b) { 0.08 } else { 0.0 };
    let from_l = ((l - 160.0) / 95.0).clamp(0.0, 1.0);
    let peak = 0.72 + from_l * 0.26 + warm_boost + (0.12 - hsv.s.min(0.12));
    peak.clamp(0.65, 1.0)
}

fn saturation_rgb(r: u8, g: u8, b: u8) -> f32 {
    let r = r as f32 / 255.0;
    let g = g as f32 / 255.0;
    let b = b as f32 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    if max <= 1e-6 {
        0.0
    } else {
        (max - min) / max
    }
}

fn polarity_from_hue_rgb(r: u8, g: u8, b: u8, hsv: Hsv) -> f32 {
    let rf = r as f32;
    let gf = g as f32;
    let bf = b as f32;

    let warm_hue = (hsv.h <= 70.0) || hsv.h >= 320.0;
    let cool_hue = (180.0..=280.0).contains(&hsv.h);

    if warm_hue && hsv.s > 0.18 && hsv.v > 0.2 {
        let away = ((rf - gf).max(0.0) + (rf - bf).max(0.0) * 0.5) / 255.0;
        let from_sat = ((hsv.s - 0.15) / 0.85).clamp(0.0, 1.0);
        return (0.25 + away * 0.55 + from_sat * 0.35).clamp(0.08, 1.0);
    }
    if cool_hue && hsv.s > 0.15 && hsv.v > 0.15 {
        let away = ((bf - rf).max(0.0) + (bf - gf).max(0.0) * 0.35) / 255.0;
        let from_sat = ((hsv.s - 0.12) / 0.85).clamp(0.0, 1.0);
        return -((0.25 + away * 0.55 + from_sat * 0.35).clamp(0.08, 1.0));
    }

    if rf > gf + 12.0 && rf > bf + 12.0 && rf > 70.0 {
        return ((rf - gf.min(bf)) / 255.0).clamp(0.1, 1.0);
    }
    if bf > rf + 10.0 && bf >= gf - 8.0 && bf > 55.0 {
        return -((bf - rf.min(gf)) / 255.0).clamp(0.1, 1.0);
    }
    if rf > 160.0 && gf > 120.0 && bf < 110.0 && rf + gf > bf * 3.0 {
        return 0.55;
    }
    0.0
}

/// Piksel (3×3 komşuluklu) alan değeri — field.rs white_pixel_field port.
fn white_pixel_field(
    rgba: &[u8],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    r: u8,
    g: u8,
    b: u8,
    l: f32,
    hsv: Hsv,
) -> f32 {
    let w = width as i32;
    let h = height as i32;
    let mut warm_n = 0u32;
    let mut cool_n = 0u32;
    let mut green_n = 0u32;
    for dy in -3i32..=3 {
        for dx in -3i32..=3 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let nx = x as i32 + dx;
            let ny = y as i32 + dy;
            if nx < 0 || ny < 0 || nx >= w || ny >= h {
                continue;
            }
            let p = ((ny as u32 * width + nx as u32) * 4) as usize;
            let (qr, qg, qb) = (rgba[p], rgba[p + 1], rgba[p + 2]);
            let ql = 0.2126 * qr as f32 + 0.7152 * qg as f32 + 0.0722 * qb as f32;
            if is_near_white(ql, saturation_rgb(qr, qg, qb)) {
                continue;
            }
            if is_warm_rgb(qr, qg, qb) {
                warm_n += 1;
            } else if is_cool_rgb(qr, qg, qb) {
                cool_n += 1;
            } else if is_green_rgb(qr, qg, qb) {
                green_n += 1;
            }
        }
    }

    if warm_n >= 3 {
        return (positive_bloom_from_white(r, g, b, l, hsv) + 0.06).min(1.0);
    }
    if cool_n >= 3 && warm_n <= 1 {
        return 0.0;
    }
    if green_n >= 6 && warm_n <= 1 && cool_n <= 1 {
        return 0.0;
    }
    positive_bloom_from_white(r, g, b, l, hsv)
}

/// Tek piksel (komşuluklu) manyetik alan çıkışı (−1..+1).
fn rgb_to_field_signed_at(
    rgba: &[u8],
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    r: u8,
    g: u8,
    b: u8,
    lut: &[Hsv],
) -> f32 {
    let hsv = rgb_to_hsv(r, g, b);
    let l = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;

    if is_near_white(l, hsv.s) {
        return white_pixel_field(rgba, width, height, x, y, r, g, b, l, hsv);
    }

    if is_greenish(hsv.h, hsv.s, hsv.v) {
        return 0.0;
    }

    let (idx, dist) = best_lut_match(hsv, lut);
    if dist <= 0.48 {
        let s = lut_index_to_signed(idx, lut.len());
        if s.abs() >= 0.08 {
            return s;
        }
    }
    polarity_from_hue_rgb(r, g, b, hsv)
}

/// LUT: beyaz/kırmızı (+) … yeşil (0) … mavi (−)
fn elic_bipolar_lut(len: usize) -> Vec<Hsv> {
    let stops: [(u8, u8, u8); 7] = [
        (245, 245, 240),
        (220, 30, 25),
        (255, 120, 20),
        (255, 220, 40),
        (34, 180, 70),
        (70, 200, 220),
        (20, 50, 190),
    ];
    let n = len.max(2);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let t = i as f32 / (n - 1) as f32;
        let x = t * (stops.len() - 1) as f32;
        let i0 = x.floor() as usize;
        let i1 = (i0 + 1).min(stops.len() - 1);
        let local = x - i0 as f32;
        let (r0, g0, b0) = stops[i0];
        let (r1, g1, b1) = stops[i1];
        let r = (r0 as f32 + (r1 as f32 - r0 as f32) * local).round() as u8;
        let g = (g0 as f32 + (g1 as f32 - g0 as f32) * local).round() as u8;
        let b = (b0 as f32 + (b1 as f32 - b0 as f32) * local).round() as u8;
        out.push(rgb_to_hsv(r, g, b));
    }
    out
}

// ── Kalibrasyon (structures/calibrate.rs port) ──────────────

struct FieldCalib {
    void_thr: f32,
    metal_thr: f32,
    #[allow(dead_code)]
    noise_std: f32,
    min_area: u32,
}

fn percentile(vals: &mut Vec<f32>, p: f32) -> f32 {
    if vals.is_empty() {
        return 0.0;
    }
    vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let i = ((vals.len() - 1) as f32 * p.clamp(0.0, 1.0)).round() as usize;
    vals[i.min(vals.len() - 1)]
}

fn calibrate_field(signed: &[f32], w: u32, h: u32) -> FieldCalib {
    let mut voids = Vec::new();
    let mut metals = Vec::new();
    for &v in signed {
        if v < -0.05 {
            voids.push((-v).min(1.0));
        } else if v > 0.05 {
            metals.push(v.min(1.0));
        }
    }
    let void_p70 = percentile(&mut voids, 0.70).max(0.12);
    let metal_p70 = percentile(&mut metals, 0.70).max(0.12);
    let noise_std = {
        let mut vals: Vec<f32> = signed.to_vec();
        vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let med = vals[vals.len() / 2];
        let mut devs: Vec<f32> = vals.iter().map(|x| (x - med).abs()).collect();
        devs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        (1.4826 * devs[devs.len() / 2]).clamp(0.03, 0.25)
    };
    let pixels = (w * h) as f32;
    let min_area = ((pixels * 0.00035).round() as u32).clamp(10, 48);
    FieldCalib {
        void_thr: void_p70.clamp(0.12, 0.42),
        metal_thr: metal_p70.clamp(0.12, 0.45),
        noise_std,
        min_area,
    }
}

// ── Blob tespiti + simetrik gövde sentezi (field.rs port) ──

#[derive(Clone, Copy)]
struct PreviewBlob {
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
    intensity: f32,
}

fn preview_blobs(signed: &[f32], w: u32, h: u32, negative: bool, thr: f32, min_area: u32) -> Vec<PreviewBlob> {
    let n = (w * h) as usize;
    let mut visited = vec![false; n];
    let mut out = Vec::new();
    let neighbors = [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)];

    for y0 in 0..h as i32 {
        for x0 in 0..w as i32 {
            let start = (y0 as u32 * w + x0 as u32) as usize;
            if visited[start] {
                continue;
            }
            let v = signed[start];
            let ok = if negative { v <= -thr } else { v >= thr };
            if !ok {
                continue;
            }

            let mut stack = vec![(x0, y0)];
            visited[start] = true;
            let mut sum_x = 0.0f32;
            let mut sum_y = 0.0f32;
            let mut sum_i = 0.0f32;
            let mut min_x = x0;
            let mut max_x = x0;
            let mut min_y = y0;
            let mut max_y = y0;
            let mut area = 0u32;

            while let Some((x, y)) = stack.pop() {
                let i = (y as u32 * w + x as u32) as usize;
                let val = signed[i].abs();
                area += 1;
                sum_x += x as f32;
                sum_y += y as f32;
                sum_i += val;
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
                    if visited[ni] {
                        continue;
                    }
                    let nv = signed[ni];
                    let nok = if negative { nv <= -thr } else { nv >= thr };
                    if !nok {
                        continue;
                    }
                    visited[ni] = true;
                    stack.push((nx, ny));
                }
            }

            if area < min_area {
                continue;
            }

            let cx = (sum_x / area as f32) / (w - 1).max(1) as f32;
            let cy = (sum_y / area as f32) / (h - 1).max(1) as f32;
            let bw = (max_x - min_x + 1) as f32 / w as f32;
            let bh = (max_y - min_y + 1) as f32 / h as f32;
            out.push(PreviewBlob {
                cx: cx.clamp(0.0, 1.0),
                cy: cy.clamp(0.0, 1.0),
                rx: (bw * 0.5).max(0.02),
                ry: (bh * 0.5).max(0.02),
                intensity: (sum_i / area as f32).clamp(0.0, 1.0),
            });
        }
    }

    out.sort_by(|a, b| {
        b.intensity
            .partial_cmp(&a.intensity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out.truncate(16);
    out
}

fn box_blur_2d(src: &[f32], w: u32, h: u32, radius: i32) -> Vec<f32> {
    if radius <= 0 {
        return src.to_vec();
    }
    let w = w as i32;
    let h = h as i32;
    let mut out = vec![0.0f32; src.len()];
    for y in 0..h {
        for x in 0..w {
            let mut sum = 0.0f32;
            let mut count = 0.0f32;
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    let nx = x + dx;
                    let ny = y + dy;
                    if nx < 0 || ny < 0 || nx >= w || ny >= h {
                        continue;
                    }
                    sum += src[(ny * w + nx) as usize];
                    count += 1.0;
                }
            }
            out[(y * w + x) as usize] = sum / count.max(1.0);
        }
    }
    out
}

/// İşaretli alandan simetrik 3D yükseklik grid'i (−1..+1 normalize).
pub fn synthesize_symmetric_bodies(signed: &[f32], w: u32, h: u32) -> Vec<f32> {
    let calib = calibrate_field(signed, w, h);
    let blobs_neg = preview_blobs(signed, w, h, true, calib.void_thr, calib.min_area);
    let blobs_pos = preview_blobs(signed, w, h, false, calib.metal_thr, calib.min_area);
    let mut out = vec![0.0f32; (w * h) as usize];
    let w_i = w as i32;
    let h_i = h as i32;

    for (blobs, sign) in [(&blobs_neg, -1.0f32), (&blobs_pos, 1.0f32)] {
        for b in blobs {
            let cx = b.cx * (w - 1) as f32;
            let cy = b.cy * (h - 1) as f32;
            let rx = (b.rx * w as f32).max(2.0);
            let ry = (b.ry * h as f32).max(2.0);
            let reach_x = (rx * 2.2).ceil() as i32;
            let reach_y = (ry * 2.2).ceil() as i32;
            let x0 = cx as i32;
            let y0 = cy as i32;
            for y in (y0 - reach_y).max(0)..=(y0 + reach_y).min(h_i - 1) {
                for x in (x0 - reach_x).max(0)..=(x0 + reach_x).min(w_i - 1) {
                    let dx = (x as f32 - cx) / rx;
                    let dy = (y as f32 - cy) / ry;
                    let r2 = dx * dx + dy * dy;
                    if r2 > 4.0 {
                        continue;
                    }
                    let g = (-0.55 * r2).exp() * b.intensity * sign;
                    let idx = (y as u32 * w + x as u32) as usize;
                    out[idx] += g;
                }
            }
        }
    }

    let out = box_blur_2d(&out, w, h, 1);
    let max_abs = out.iter().fold(0.0_f32, |a, v| a.max(v.abs())).max(1e-6);
    out.into_iter()
        .map(|v| (v / max_abs).clamp(-1.0, 1.0))
        .collect()
}

// ── Ana giriş: cleaned RGBA → (signed field, heights, renk grid'i) ──

/// Kaynak resmi grid'e örnekle + işaretli alan üret (build_signed_field port).
pub fn build_signed_field(
    rgba: &[u8],
    cw: u32,
    ch: u32,
    grid_w: u32,
    grid_h: u32,
) -> (Vec<f32>, Vec<u8>) {
    let lut = elic_bipolar_lut(128);
    let mut signed_field = Vec::with_capacity((grid_w * grid_h) as usize);
    let mut colors = Vec::with_capacity((grid_w * grid_h * 3) as usize);

    for gy in 0..grid_h {
        for gx in 0..grid_w {
            let sx = (gx as f32 / (grid_w - 1).max(1) as f32 * (cw - 1) as f32).round() as u32;
            let sy = (gy as f32 / (grid_h - 1).max(1) as f32 * (ch - 1) as f32).round() as u32;
            let sx = sx.min(cw - 1);
            let sy = sy.min(ch - 1);
            let p = ((sy * cw + sx) * 4) as usize;
            let (r, g, b) = (rgba[p], rgba[p + 1], rgba[p + 2]);
            let s = rgb_to_field_signed_at(rgba, cw, ch, sx, sy, r, g, b, &lut);
            signed_field.push(s);
            colors.extend_from_slice(&[r, g, b]);
        }
    }

    let signed_field = box_blur_2d(&signed_field, grid_w, grid_h, 1);
    (signed_field, colors)
}

/// min/max yardımcı.
pub fn min_max(values: &[f32]) -> (f32, f32) {
    let mut min_v = f32::MAX;
    let mut max_v = f32::MIN;
    for &v in values {
        min_v = min_v.min(v);
        max_v = max_v.max(v);
    }
    (min_v, max_v)
}

// ── Testler (field.rs polarity_tests birebir) ──────────────

#[cfg(test)]
mod polarity_tests {
    use super::*;

    fn sample_signed(r: u8, g: u8, b: u8) -> f32 {
        // Tek renk bloğu 16×16, komşuluk çalışsın diye
        let (w, h) = (16u32, 16u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for i in 0..(w * h) as usize {
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = 255;
        }
        let lut = elic_bipolar_lut(64);
        rgb_to_field_signed_at(&rgba, w, h, 8, 8, r, g, b, &lut)
    }

    #[test]
    fn green_is_ground_zero() {
        let s = sample_signed(34, 180, 70);
        assert!(s.abs() < 0.08, "green must be ~0, got {s}");
    }

    #[test]
    fn red_is_positive_exit() {
        let s = sample_signed(220, 30, 25);
        assert!(s > 0.35, "red must be +, got {s}");
    }

    #[test]
    fn blue_is_negative_exit() {
        let s = sample_signed(25, 45, 190);
        assert!(s < -0.35, "blue must be −, got {s}");
    }

    #[test]
    fn yellow_is_positive() {
        let s = sample_signed(255, 220, 40);
        assert!(s > 0.15, "yellow must be +, got {s}");
    }

    #[test]
    fn white_peak_is_strong_positive_bloom() {
        let s = sample_signed(236, 236, 230);
        assert!(s > 0.65, "white bloom must be strong +, got {s}");
    }

    #[test]
    fn surface_pipeline_smoke() {
        // Yeşil zemin + kırmızı blob + mavi blob → heights grid
        let (w, h) = (64u32, 64u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for i in 0..(w * h) as usize {
            rgba[i * 4] = 34;
            rgba[i * 4 + 1] = 180;
            rgba[i * 4 + 2] = 70;
            rgba[i * 4 + 3] = 255;
        }
        for y in 10..24 {
            for x in 10..26 {
                let p = ((y * w + x) * 4) as usize;
                rgba[p] = 220;
                rgba[p + 1] = 30;
                rgba[p + 2] = 25;
            }
        }
        for y in 36..52 {
            for x in 36..56 {
                let p = ((y * w + x) * 4) as usize;
                rgba[p] = 25;
                rgba[p + 1] = 45;
                rgba[p + 2] = 190;
            }
        }

        let (signed, colors) = build_signed_field(&rgba, w, h, 48, 48);
        assert_eq!(signed.len(), 48 * 48);
        assert_eq!(colors.len(), 48 * 48 * 3);

        let heights = synthesize_symmetric_bodies(&signed, 48, 48);
        assert_eq!(heights.len(), 48 * 48);
        let (zmin, zmax) = min_max(&heights);
        assert!(zmin < -0.2, "void depression expected, got {zmin}");
        assert!(zmax > 0.2, "metal rise expected, got {zmax}");
    }
}
