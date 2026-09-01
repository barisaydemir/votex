//! İşaretli manyetik alan üretimi.
//!
//! Sensör modeli (Proton ELIC):
//! - Yeşil = yeryüzü / Z0 (nötr)
//! - Yeşil → sarı → turuncu → kırmızı → **beyaz** = pozitif manyetik çıkış (+)
//!   (yoğun pozitif değer yapının etrafından yüzeye fışkırır; zirve beyaza kadar gider)
//! - Yeşil → açık mavi → koyu mavi = negatif manyetik çıkış (−)
//!
//! İnce beyaz çizgi (yeşil içi ridge) duvar/tünel ipucudur.
//! Alan olarak beyaz = yoğun pozitif yüzey fışkırması.

use crate::structures::calibrate_field;
use crate::vision::{
    best_lut_match, is_greenish, lut_index_to_signed, rgb_to_hsv, Hsv,
};
use image::RgbaImage;

/// Colormap piksel → işaretli alan (−1..+1) + ham RGB grid.
pub fn build_signed_field(
    cleaned: &RgbaImage,
    grid_w: u32,
    grid_h: u32,
) -> (Vec<f32>, Vec<u8>) {
    let cw = cleaned.width();
    let ch = cleaned.height();
    let lut = elic_bipolar_lut(128);
    let mut signed_field = Vec::with_capacity((grid_w * grid_h) as usize);
    let mut colors = Vec::with_capacity((grid_w * grid_h * 3) as usize);

    for gy in 0..grid_h {
        for gx in 0..grid_w {
            let sx = (gx as f32 / (grid_w - 1).max(1) as f32 * (cw - 1) as f32).round() as u32;
            let sy = (gy as f32 / (grid_h - 1).max(1) as f32 * (ch - 1) as f32).round() as u32;
            let sx = sx.min(cw - 1);
            let sy = sy.min(ch - 1);
            let p = cleaned.get_pixel(sx, sy).0;
            let signed = rgb_to_field_signed_at(cleaned, sx, sy, p[0], p[1], p[2], &lut);
            signed_field.push(signed);
            colors.extend_from_slice(&[p[0], p[1], p[2]]);
        }
    }

    let signed_field = box_blur_2d(&signed_field, grid_w, grid_h, 1);
    (signed_field, colors)
}

/// Tek piksel (komşuluklu): manyetik alan çıkışı (−1..+1).
pub fn rgb_to_field_signed_at(
    img: &RgbaImage,
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
        return white_pixel_field(img, x, y, r, g, b, l, hsv);
    }

    if is_greenish(hsv.h, hsv.s, hsv.v) {
        return 0.0;
    }

    let (idx, dist) = best_lut_match(hsv, lut);
    if dist <= 0.48 {
        let s = lut_index_to_signed(idx, lut.len());
        // Yeşile çok yakın LUT → hue yedek (sarı/turuncu kaçmasın)
        if s.abs() >= 0.08 {
            return s;
        }
    }
    polarity_from_hue_rgb(r, g, b, hsv)
}

/// Komşuluksuz yedek (test / tek renk).
pub fn rgb_to_field_signed(r: u8, g: u8, b: u8, lut: &[Hsv]) -> f32 {
    let hsv = rgb_to_hsv(r, g, b);
    let l = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;
    if is_near_white(l, hsv.s) {
        return positive_bloom_from_white(r, g, b, l, hsv);
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

fn white_pixel_field(
    img: &RgbaImage,
    x: u32,
    y: u32,
    r: u8,
    g: u8,
    b: u8,
    l: f32,
    hsv: Hsv,
) -> f32 {
    let w = img.width() as i32;
    let h = img.height() as i32;
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
            let q = img.get_pixel(nx as u32, ny as u32).0;
            let ql = 0.2126 * q[0] as f32 + 0.7152 * q[1] as f32 + 0.0722 * q[2] as f32;
            if is_near_white(ql, saturation_rgb(q[0], q[1], q[2])) {
                continue;
            }
            if is_warm_rgb(q[0], q[1], q[2]) {
                warm_n += 1;
            } else if is_cool_rgb(q[0], q[1], q[2]) {
                cool_n += 1;
            } else if is_green_rgb(q[0], q[1], q[2]) {
                green_n += 1;
            }
        }
    }

    // Yapı etrafı sıcak/kırmızı yanında beyaz → yoğun pozitif yüzey fışkırması
    if warm_n >= 3 {
        return (positive_bloom_from_white(r, g, b, l, hsv) + 0.06).min(1.0);
    }
    // Mavi boşluk kenarı highlight → alan değil
    if cool_n >= 3 && warm_n <= 1 {
        return 0.0;
    }
    // Saf yeşil içi ince çizgi → alan 0
    if green_n >= 6 && warm_n <= 1 && cool_n <= 1 {
        return 0.0;
    }
    positive_bloom_from_white(r, g, b, l, hsv)
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

/// LUT: beyaz/kırmızı (+) … yeşil (0) … mavi (−)
fn elic_bipolar_lut(len: usize) -> Vec<Hsv> {
    let stops = [
        (245u8, 245u8, 240u8), // + beyaz zirve
        (220, 30, 25),
        (255, 120, 20),
        (255, 220, 40),
        (34, 180, 70),
        (70, 200, 220),
        (20, 50, 190),
    ];
    let mut out = Vec::with_capacity(len.max(2));
    let n = len.max(2);
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

pub fn synthesize_symmetric_bodies(signed: &[f32], w: u32, h: u32) -> Vec<f32> {
    let calib = calibrate_field(signed, w, h);
    let blobs_neg = preview_blobs(signed, w, h, true, calib.void_thr, calib.min_area);
    let blobs_pos = preview_blobs(signed, w, h, false, calib.metal_thr, calib.min_area);
    let mut out = vec![0.0f32; (w * h) as usize];
    let w_i = w as i32;
    let h_i = h as i32;

    let paint = |out: &mut [f32], b: &PreviewBlob, sign: f32| {
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
    };

    // Negatif alan → boşluk gövdesi; pozitif → metal/oksidasyon alanı
    for b in &blobs_neg {
        paint(&mut out, b, -1.0);
    }
    for b in &blobs_pos {
        paint(&mut out, b, 1.0);
    }
    let out = box_blur_2d(&out, w, h, 1);
    let max_abs = out.iter().fold(0.0_f32, |a, v| a.max(v.abs())).max(1e-6);
    out.into_iter()
        .map(|v| (v / max_abs).clamp(-1.0, 1.0))
        .collect()
}

pub fn min_max(values: &[f32]) -> (f32, f32) {
    let mut min_v = f32::MAX;
    let mut max_v = f32::MIN;
    for &v in values {
        min_v = min_v.min(v);
        max_v = max_v.max(v);
    }
    (min_v, max_v)
}

#[derive(Clone)]
struct PreviewBlob {
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
    intensity: f32,
}

fn preview_blobs(
    signed: &[f32],
    w: u32,
    h: u32,
    negative: bool,
    thr: f32,
    min_area: u32,
) -> Vec<PreviewBlob> {
    let n = (w * h) as usize;
    let mut visited = vec![false; n];
    let mut out = Vec::new();
    let neighbors = [(-1i32, 0), (1, 0), (0, -1), (0, 1)];

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

#[cfg(test)]
mod polarity_tests {
    use super::{elic_bipolar_lut, rgb_to_field_signed};

    #[test]
    fn green_is_ground_zero() {
        let lut = elic_bipolar_lut(64);
        let s = rgb_to_field_signed(34, 180, 70, &lut);
        assert!(s.abs() < 0.08, "green must be ~0, got {s}");
    }

    #[test]
    fn red_is_positive_exit() {
        let lut = elic_bipolar_lut(64);
        let s = rgb_to_field_signed(220, 30, 25, &lut);
        assert!(s > 0.35, "red must be +, got {s}");
    }

    #[test]
    fn blue_is_negative_exit() {
        let lut = elic_bipolar_lut(64);
        let s = rgb_to_field_signed(25, 45, 190, &lut);
        assert!(s < -0.35, "blue must be −, got {s}");
    }

    #[test]
    fn yellow_is_positive() {
        let lut = elic_bipolar_lut(64);
        let s = rgb_to_field_signed(255, 220, 40, &lut);
        assert!(s > 0.15, "yellow must be +, got {s}");
    }

    #[test]
    fn white_peak_is_strong_positive_bloom() {
        let lut = elic_bipolar_lut(64);
        let s = rgb_to_field_signed(236, 236, 230, &lut);
        assert!(s > 0.65, "concentrated positive bloom to white must be strong +, got {s}");
    }

    #[test]
    fn warm_white_is_surface_exit_peak() {
        let lut = elic_bipolar_lut(64);
        let s = rgb_to_field_signed(250, 240, 220, &lut);
        assert!(s > 0.7, "warm white near structure must be peak +, got {s}");
    }
}
