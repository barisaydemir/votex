//! Votex WASM — magnetic colormap analysis core for the mobile PWA.
//!
//! Ported from `src-tauri/src/vision.rs` (desktop Tauri backend) as a
//! dependency-free core that accepts raw RGBA pixels from JS `getImageData()`
//! and returns detected anomalies as JSON. Runs fully offline on the phone.

use wasm_bindgen::prelude::*;

// ── HSV color space (ported from vision.rs) ────────────────

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

// ── Anomaly detection (connected components) ───────────────

#[derive(Clone)]
struct DetectedAnomaly {
    class: &'static str, // "positive" | "negative"
    cx: f32,
    cy: f32,
    area: u32,
    intensity: f32,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
}

fn connected_components(
    mask: &[u8],
    signed: &[f32],
    width: u32,
    height: u32,
    class: &'static str,
    min_area: u32,
) -> Vec<DetectedAnomaly> {
    let n = (width * height) as usize;
    let mut visited = vec![false; n];
    let mut out = Vec::new();
    let neighbors = [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)];

    for y0 in 0..height as i32 {
        for x0 in 0..width as i32 {
            let start = (y0 as u32 * width + x0 as u32) as usize;
            if mask[start] == 0 || visited[start] {
                continue;
            }
            let mut stack = vec![(x0, y0)];
            visited[start] = true;
            let mut cells = 0u32;
            let mut sum_x = 0.0f32;
            let mut sum_y = 0.0f32;
            let mut sum_abs = 0.0f32;
            let mut min_x = x0 as u32;
            let mut min_y = y0 as u32;
            let mut max_x = x0 as u32;
            let mut max_y = y0 as u32;

            while let Some((x, y)) = stack.pop() {
                let i = (y as u32 * width + x as u32) as usize;
                cells += 1;
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

            let area = cells;
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

// ── Public API ──────────────────────────────────────────────

/// Analysis result returned to JS as JSON string.
/// Plain String (no JsValue/serde-wasm-bindgen) keeps the bundle small.
#[wasm_bindgen]
pub struct AnalysisResult {
    json: String,
}

#[wasm_bindgen]
impl AnalysisResult {
    #[wasm_bindgen(getter)]
    pub fn json(&self) -> String {
        self.json.clone()
    }
}

/// Analyze a colormap image for positive/negative magnetic anomalies.
///
/// * `rgba` — raw RGBA pixel buffer from `ctx.getImageData().data`
/// * `width`, `height` — image dimensions
/// * `lut_strip_px` — width of the left vertical legend strip (8..40)
/// * `min_area` — minimum blob area in pixels
/// * `match_threshold` — HSV distance threshold for LUT matching
#[wasm_bindgen]
pub fn analyze_colormap(
    rgba: &[u8],
    width: u32,
    height: u32,
    lut_strip_px: u32,
    min_area: u32,
    match_threshold: f32,
) -> Result<AnalysisResult, JsValue> {
    if width < 40 || height < 20 {
        return Err("ROI çok küçük".into());
    }
    if (rgba.len() as u64) < (width as u64) * (height as u64) * 4 {
        return Err("RGBA buffer too small".into());
    }

    let strip = lut_strip_px.clamp(8, 40);

    // Build LUT from the left vertical strip (top = +, bottom = −)
    let mut lut: Vec<Hsv> = Vec::with_capacity(height as usize);
    for y in 0..height {
        let mut r_sum = 0u32;
        let mut g_sum = 0u32;
        let mut b_sum = 0u32;
        for x in 0..strip {
            let p = ((y * width + x) * 4) as usize;
            r_sum += rgba[p] as u32;
            g_sum += rgba[p + 1] as u32;
            b_sum += rgba[p + 2] as u32;
        }
        let n = strip.max(1);
        lut.push(rgb_to_hsv(
            (r_sum / n) as u8,
            (g_sum / n) as u8,
            (b_sum / n) as u8,
        ));
    }

    let map_x0 = strip + 4;
    let n_px = (width * height) as usize;
    let mut signed = vec![0.0f32; n_px];
    let mut mask_pos = vec![0u8; n_px];
    let mut mask_neg = vec![0u8; n_px];

    for y in 0..height {
        for x in map_x0..width {
            let p = ((y * width + x) * 4) as usize;
            let hsv = rgb_to_hsv(rgba[p], rgba[p + 1], rgba[p + 2]);
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
        "positive",
        min_area,
    ));
    anomalies.extend(connected_components(
        &mask_neg,
        &signed,
        width,
        height,
        "negative",
        min_area,
    ));

    // Build JSON manually (no serde needed — keeps bundle tiny)
    let mut json = String::with_capacity(256 + anomalies.len() * 96);
    json.push_str("{\"width\":");
    json.push_str(&width.to_string());
    json.push_str(",\"height\":");
    json.push_str(&height.to_string());
    json.push_str(",\"anomalies\":[");
    for (i, a) in anomalies.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&format!(
            "{{\"class\":\"{}\",\"cx\":{:.2},\"cy\":{:.2},\"area\":{},\"intensity\":{:.4},\"x\":{},\"y\":{},\"w\":{},\"h\":{}}}",
            a.class,
            a.cx,
            a.cy,
            a.area,
            a.intensity,
            a.x,
            a.y,
            a.w,
            a.h
        ));
    }
    json.push_str("]}");

    Ok(AnalysisResult { json })
}

/// Basic image statistics (histogram-based) — complements the JS analyzer
/// with fast native computation.
#[wasm_bindgen]
pub fn image_stats(rgba: &[u8]) -> String {
    let pixels = rgba.len() / 4;
    if pixels == 0 {
        return "{}".into();
    }
    let mut sum = 0.0f64;
    let mut min = 255u8;
    let mut max = 0u8;
    let mut hist = [0u32; 256];

    let mut i = 0;
    while i < rgba.len() {
        let r = rgba[i] as f32;
        let g = rgba[i + 1] as f32;
        let b = rgba[i + 2] as f32;
        let y = (r * 0.299 + g * 0.587 + b * 0.114) as u8;
        sum += y as f64;
        if y < min {
            min = y;
        }
        if y > max {
            max = y;
        }
        hist[y as usize] += 1;
        i += 4;
    }

    let mean = sum / pixels as f64;
    let mut var = 0.0f64;
    for &h in &hist {
        if h > 0 {
            let d = h as f64 - mean;
            var += d * d * h as f64;
        }
    }
    let var = var / pixels as f64;
    let mut entropy = 0.0f64;
    for &h in &hist {
        if h > 0 {
            let p = h as f64 / pixels as f64;
            entropy -= p * p.log2();
        }
    }

    format!(
        "{{\"mean\":{:.2},\"min\":{},\"max\":{},\"stdDev\":{:.2},\"entropy\":{:.3}}}",
        mean,
        min,
        max,
        var.sqrt(),
        entropy
    )
}

/// Crate version — handy for cache busting from JS.
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
