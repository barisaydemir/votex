//! Ekran haritası renk eşleştirme (OCR yok) — PDF Aşama 2.
//! Sol dikey renk şeridi LUT + HSV Öklid + bağlı bileşen konturları.

use crate::magnetic::{AnomalyClass, Rgba};
use image::{Rgba as ImgRgba, RgbaImage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedAnomaly {
    pub class: AnomalyClass,
    pub cx: f32,
    pub cy: f32,
    pub area: u32,
    pub intensity: f32,
    /// Basit bounding box
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapAnalysisResult {
    pub anomalies: Vec<DetectedAnomaly>,
    pub width: u32,
    pub height: u32,
    /// Overlay: kontur çizilmiş PNG (data URL)
    pub overlay_base64_png: String,
}

#[derive(Clone, Copy)]
pub(crate) struct Hsv {
    pub h: f32,
    pub s: f32,
    pub v: f32,
}

pub(crate) fn rgb_to_hsv(r: u8, g: u8, b: u8) -> Hsv {
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

pub(crate) fn hsv_dist(a: Hsv, b: Hsv) -> f32 {
    let mut dh = (a.h - b.h).abs();
    if dh > 180.0 {
        dh = 360.0 - dh;
    }
    // H ağırlıklı — ELIC paleti hue ile ayrılır
    (dh / 180.0).powi(2) + (a.s - b.s).powi(2) * 0.5 + (a.v - b.v).powi(2) * 0.35
}

/// Soldaki dikey şeritten LUT (üst = +, alt = −).
pub(crate) fn build_lut(img: &RgbaImage, strip_w: u32) -> Vec<Hsv> {
    let w = img.width().min(strip_w.max(1));
    let h = img.height();
    let mut lut = Vec::with_capacity(h as usize);
    for y in 0..h {
        let mut r_sum = 0u32;
        let mut g_sum = 0u32;
        let mut b_sum = 0u32;
        for x in 0..w {
            let p = img.get_pixel(x, y).0;
            r_sum += p[0] as u32;
            g_sum += p[1] as u32;
            b_sum += p[2] as u32;
        }
        let n = w.max(1);
        lut.push(rgb_to_hsv(
            (r_sum / n) as u8,
            (g_sum / n) as u8,
            (b_sum / n) as u8,
        ));
    }
    lut
}

pub(crate) fn lut_index_to_signed(idx: usize, len: usize) -> f32 {
    if len <= 1 {
        return 0.0;
    }
    // üst (0) → +1, alt (len-1) → −1
    1.0 - 2.0 * (idx as f32 / (len - 1) as f32)
}

pub(crate) fn best_lut_match(px: Hsv, lut: &[Hsv]) -> (usize, f32) {
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

pub(crate) fn is_greenish(h: f32, s: f32, v: f32) -> bool {
    // Yeşil zemin maskesi
    s > 0.15 && v > 0.15 && (70.0..=170.0).contains(&h)
}

/// Haritayı analiz et: pozitif/negatif bölgeler + merkezler.
pub fn analyze_colormap_image(
    img: &RgbaImage,
    lut_strip_px: u32,
    min_area: u32,
    match_threshold: f32,
) -> Result<MapAnalysisResult, String> {
    let width = img.width();
    let height = img.height();
    if width < 40 || height < 20 {
        return Err("ROI çok küçük".into());
    }

    let strip = lut_strip_px.clamp(8, 40);
    let lut = build_lut(img, strip);
    let map_x0 = strip + 4;

    // signed map: 0 = nötr/yeşil, >0 metal, <0 void
    let mut signed = vec![0.0f32; (width * height) as usize];
    let mut mask_pos = vec![0u8; (width * height) as usize];
    let mut mask_neg = vec![0u8; (width * height) as usize];

    for y in 0..height {
        for x in map_x0..width {
            let p = img.get_pixel(x, y).0;
            let hsv = rgb_to_hsv(p[0], p[1], p[2]);
            if is_greenish(hsv.h, hsv.s, hsv.v) {
                continue;
            }
            let (idx, dist) = best_lut_match(hsv, &lut);
            if dist > match_threshold {
                continue;
            }
            let s = lut_index_to_signed(idx, lut.len());
            let i = (y * width + x) as usize;
            signed[i] = s;
            if s > 0.15 {
                mask_pos[i] = 1;
            } else if s < -0.15 {
                mask_neg[i] = 1;
            }
        }
    }

    let mut anomalies = Vec::new();
    anomalies.extend(connected_components(
        &mask_pos,
        &signed,
        width,
        height,
        AnomalyClass::PositiveMetal,
        min_area,
    ));
    anomalies.extend(connected_components(
        &mask_neg,
        &signed,
        width,
        height,
        AnomalyClass::NegativeVoid,
        min_area,
    ));

    let overlay = draw_overlay(img, &anomalies);
    let overlay_base64_png = crate::capture::png_data_url(&overlay)?;

    Ok(MapAnalysisResult {
        anomalies,
        width,
        height,
        overlay_base64_png,
    })
}

fn connected_components(
    mask: &[u8],
    signed: &[f32],
    width: u32,
    height: u32,
    class: AnomalyClass,
    min_area: u32,
) -> Vec<DetectedAnomaly> {
    let n = (width * height) as usize;
    let mut visited = vec![false; n];
    let mut out = Vec::new();

    let neighbors = [(-1i32, 0), (1, 0), (0, -1), (0, 1)];

    for y0 in 0..height as i32 {
        for x0 in 0..width as i32 {
            let start = (y0 as u32 * width + x0 as u32) as usize;
            if mask[start] == 0 || visited[start] {
                continue;
            }
            let mut stack = vec![(x0, y0)];
            visited[start] = true;
            let mut cells = Vec::new();
            let mut sum_x = 0.0f32;
            let mut sum_y = 0.0f32;
            let mut sum_abs = 0.0f32;
            let mut min_x = x0 as u32;
            let mut min_y = y0 as u32;
            let mut max_x = x0 as u32;
            let mut max_y = y0 as u32;

            while let Some((x, y)) = stack.pop() {
                let i = (y as u32 * width + x as u32) as usize;
                cells.push((x, y));
                sum_x += x as f32;
                sum_y += y as f32;
                sum_abs += signed[i].abs();
                min_x = min_x.min(x as u32);
                min_y = min_y.min(y as u32);
                max_x = max_x.max(x as u32);
                max_y = max_y.max(y as u32);

                for (dx, dy) in neighbors {
                    let nx = x + dx;
                    let ny = y + dy;
                    if nx < 0 || ny < 0 || nx >= width as i32 || ny >= height as i32 {
                        continue;
                    }
                    let ni = (ny as u32 * width + nx as u32) as usize;
                    if mask[ni] != 0 && !visited[ni] {
                        visited[ni] = true;
                        stack.push((nx, ny));
                    }
                }
            }

            let area = cells.len() as u32;
            if area < min_area {
                continue;
            }
            out.push(DetectedAnomaly {
                class,
                cx: sum_x / area as f32,
                cy: sum_y / area as f32,
                area,
                intensity: sum_abs / area as f32,
                x: min_x,
                y: min_y,
                w: max_x - min_x + 1,
                h: max_y - min_y + 1,
            });
        }
    }
    out
}

fn draw_overlay(img: &RgbaImage, anomalies: &[DetectedAnomaly]) -> RgbaImage {
    let mut out = img.clone();
    for a in anomalies {
        let color = match a.class {
            AnomalyClass::PositiveMetal => ImgRgba([255, 40, 40, 255]),
            AnomalyClass::NegativeVoid => ImgRgba([40, 80, 255, 255]),
            AnomalyClass::Neutral => ImgRgba([255, 255, 255, 255]),
        };
        // bbox
        for x in a.x..a.x.saturating_add(a.w).min(out.width()) {
            if a.y < out.height() {
                out.put_pixel(x, a.y, color);
            }
            let yb = a.y.saturating_add(a.h.saturating_sub(1));
            if yb < out.height() {
                out.put_pixel(x, yb, color);
            }
        }
        for y in a.y..a.y.saturating_add(a.h).min(out.height()) {
            if a.x < out.width() {
                out.put_pixel(a.x, y, color);
            }
            let xr = a.x.saturating_add(a.w.saturating_sub(1));
            if xr < out.width() {
                out.put_pixel(xr, y, color);
            }
        }
        // merkez artı
        let cx = a.cx.round() as i32;
        let cy = a.cy.round() as i32;
        for d in -4..=4 {
            let x = cx + d;
            let y = cy;
            if x >= 0 && y >= 0 && (x as u32) < out.width() && (y as u32) < out.height() {
                out.put_pixel(x as u32, y as u32, color);
            }
            let x = cx;
            let y = cy + d;
            if x >= 0 && y >= 0 && (x as u32) < out.width() && (y as u32) < out.height() {
                out.put_pixel(x as u32, y as u32, color);
            }
        }
    }
    out
}

/// Ham dizi → bipolar RGBA colormap (analitik yol).
pub fn raw_grid_to_rgba(
    data: &[f32],
    width: usize,
    height: usize,
    config: crate::magnetic::MagneticConfig,
) -> Result<(Vec<u8>, Vec<crate::magnetic::AnomalyPoint>), String> {
    let mut analyzer = crate::magnetic::MagneticAnalyzer::new(config);
    analyzer.analyze_grid(data, width, height)
}

#[allow(dead_code)]
fn _rgba_debug(c: Rgba) -> [u8; 4] {
    c.to_array()
}
