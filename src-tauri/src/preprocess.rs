//! Proton ELIC ekran görüntüsü temizleme:
//! - Sol HUD / renk skalası
//! - Alt Windows görev çubuğu (koyu + yarı saydam)
//! - Üst Windows başlık / pusola şeridi

use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropInfo {
    pub left: u32,
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
    pub cleaned_w: u32,
    pub cleaned_h: u32,
}

/// Ekran görüntüsünden HUD + görev çubuğunu kırp.
pub fn clean_elic_screenshot(img: &RgbaImage) -> Result<(RgbaImage, CropInfo), String> {
    let w = img.width();
    let h = img.height();
    if w < 64 || h < 64 {
        return Err("Görüntü çok küçük".into());
    }

    let left = detect_left_hud_width(img);
    let bottom = detect_taskbar_height(img);
    let top = detect_top_hud_height(img, left);
    let right = detect_right_margin(img, left, top, bottom);

    let x0 = left.min(w.saturating_sub(32));
    let y0 = top.min(h.saturating_sub(32));
    let x1 = w.saturating_sub(right).max(x0 + 16);
    let y1 = h.saturating_sub(bottom).max(y0 + 16);

    let cw = x1 - x0;
    let ch = y1 - y0;
    let cleaned = image::imageops::crop_imm(img, x0, y0, cw, ch).to_image();

    Ok((
        cleaned,
        CropInfo {
            left: x0,
            top: y0,
            right,
            bottom,
            cleaned_w: cw,
            cleaned_h: ch,
        },
    ))
}

fn luminance(p: &[u8; 4]) -> f32 {
    0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32
}

fn saturation(p: &[u8; 4]) -> f32 {
    let r = p[0] as f32 / 255.0;
    let g = p[1] as f32 / 255.0;
    let b = p[2] as f32 / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    if max <= 1e-6 {
        0.0
    } else {
        (max - min) / max
    }
}

/// Beyaz/parlak duvar ipucu (yumuşatmadan önce yakalanır).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallCue {
    pub x: f32,
    pub y: f32,
    pub strength: f32,
    /// true = mavi boşluk kenarı
    #[serde(default)]
    pub near_void: bool,
    /// true = yeşil zemin içinde düz beyaz çizgi (tünel ipucu)
    #[serde(default)]
    pub green_line: bool,
}

/// Yeşil içi düz beyaz çizgi segmenti (normalize uçlar).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GreenLineSeg {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    pub strength: f32,
    pub length: f32,
}

/// Yakın beyaz ışık / highlight → duvar / tünel ipucu.
/// - Mavi kenarı: oda/sarnıç duvarı
/// - Yeşil içinde düz beyaz çizgi (yeşil→beyaz→yeşil geçiş): tünel
pub fn detect_wall_cues(img: &RgbaImage) -> Vec<WallCue> {
    let w = img.width().max(1);
    let h = img.height().max(1);
    if w < 16 || h < 16 {
        return Vec::new();
    }
    let mut raw: Vec<(u32, u32, f32, bool, bool)> = Vec::new();
    let step = ((w.min(h) / 110).max(1)) as usize;
    let margin = 5u32;
    let x_end = w.saturating_sub(margin);
    let y_end = h.saturating_sub(margin);
    if x_end <= margin || y_end <= margin {
        return Vec::new();
    }

    let is_blue_void = |q: &[u8; 4]| -> bool {
        q[2] as i32 > q[0] as i32 + 25 && q[2] as i32 >= q[1] as i32 - 10 && q[2] > 70
    };
    let is_map_green = |q: &[u8; 4]| -> bool {
        let s = saturation(q);
        let l = luminance(q);
        q[1] as i32 > q[0] as i32 + 10
            && q[1] as i32 > q[2] as i32 + 6
            && s > 0.15
            && l > 30.0
            && l < 225.0
    };
    let is_near_white = |q: &[u8; 4]| -> bool {
        let l = luminance(q);
        let s = saturation(q);
        l >= 150.0 && s <= 0.42
    };
    // Yeşil üzerinde açık/sarımsı çizgi (öğreti: altında yapı)
    let is_pale_on_green = |q: &[u8; 4]| -> bool {
        let l = luminance(q);
        let s = saturation(q);
        let r = q[0] as i32;
        let g = q[1] as i32;
        let b = q[2] as i32;
        // Açık yeşil–sarı şerit: beyaz kadar parlak olmayabilir
        l >= 95.0
            && l <= 210.0
            && s >= 0.08
            && s <= 0.55
            && g >= r - 15
            && g > b + 8
            && (r + g) > b * 2
    };
    let sample = |x: i32, y: i32| -> Option<[u8; 4]> {
        if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
            return None;
        }
        Some(img.get_pixel(x as u32, y as u32).0)
    };

    let dirs: [(i32, i32); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];

    for y in (margin..y_end).step_by(step) {
        for x in (margin..x_end).step_by(step) {
            let p = img.get_pixel(x, y).0;
            let whiteish = is_near_white(&p);
            let pale = is_pale_on_green(&p);
            if !whiteish && !pale {
                continue;
            }
            let l = luminance(&p);
            let s = saturation(&p);

            let mut near_blue = false;
            let mut green_n = 0u32;
            for dy in -3i32..=3 {
                for dx in -3i32..=3 {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let Some(q) = sample(x as i32 + dx, y as i32 + dy) else {
                        continue;
                    };
                    if is_blue_void(&q) {
                        near_blue = true;
                    }
                    if is_map_green(&q) {
                        green_n += 1;
                    }
                }
            }
            let in_green_field = green_n >= 4;

            // Piksel geçişi: yeşil → açık çizgi → yeşil + çizgi boyunca süreklilik
            let mut best_line = 0.0f32;
            for &(ux, uy) in &dirs {
                let px = -uy;
                let py = ux;
                let mut side_green = 0u32;
                for dist in [2i32, 3, 4] {
                    for sign in [-1i32, 1] {
                        let Some(q) =
                            sample(x as i32 + px * dist * sign, y as i32 + py * dist * sign)
                        else {
                            continue;
                        };
                        if is_map_green(&q) {
                            side_green += 1;
                        }
                    }
                }
                if side_green < 3 {
                    continue;
                }
                let mut along = 0u32;
                let mut along_bright = 0.0f32;
                for t in -4i32..=4 {
                    if t == 0 {
                        continue;
                    }
                    let Some(q) = sample(x as i32 + ux * t, y as i32 + uy * t) else {
                        continue;
                    };
                    along += 1;
                    if is_near_white(&q) || is_pale_on_green(&q) {
                        along_bright += 1.0;
                    } else if luminance(&q) > l - 30.0 && saturation(&q) < 0.55 {
                        along_bright += 0.4;
                    }
                }
                if along < 4 {
                    continue;
                }
                let cont = along_bright / along as f32;
                if cont < 0.4 {
                    continue;
                }
                let score = cont * (side_green as f32 / 6.0).min(1.0);
                best_line = best_line.max(score);
            }
            let is_green_line = in_green_field
                && !near_blue
                && best_line >= (if pale && !whiteish { 0.36 } else { 0.42 });

            if !(near_blue || is_green_line || (in_green_field && whiteish && l >= 170.0)) {
                continue;
            }

            let mut strength = if whiteish {
                ((l - 150.0) / 105.0).clamp(0.12, 1.0) * (1.0 - s * 0.35)
            } else {
                ((l - 90.0) / 120.0).clamp(0.14, 0.85) * (1.0 - s * 0.2)
            };
            if is_green_line {
                strength = (strength * (1.25 + best_line * 0.55)).min(1.0);
            } else if near_blue {
                strength = (strength * 1.5).min(1.0);
            } else if in_green_field {
                strength = (strength * 1.25).min(1.0);
            }
            raw.push((x, y, strength, near_blue, is_green_line));
        }
    }
    raw.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    let denom_x = (w - 1).max(1) as f32;
    let denom_y = (h - 1).max(1) as f32;
    for (x, y, s, near_void, green_line) in raw {
        let nx = x as f32 / denom_x;
        let ny = y as f32 / denom_y;
        let min_d2 = if green_line { 0.0016 } else { 0.0045 };
        let too_close = out.iter().any(|c: &WallCue| {
            let dx = c.x - nx;
            let dy = c.y - ny;
            dx * dx + dy * dy < min_d2
        });
        if too_close {
            continue;
        }
        out.push(WallCue {
            x: nx,
            y: ny,
            strength: s,
            near_void,
            green_line,
        });
        if out.len() >= 140 {
            break;
        }
    }
    out
}

/// Yeşil içi düz beyaz çizgi noktalarını segmentlere çevir (tünel adayları).
pub fn extract_green_line_segments(cues: &[WallCue]) -> Vec<GreenLineSeg> {
    let pts: Vec<(usize, f32, f32, f32)> = cues
        .iter()
        .enumerate()
        .filter(|(_, c)| c.green_line && !c.near_void)
        .map(|(i, c)| (i, c.x, c.y, c.strength))
        .collect();
    if pts.len() < 4 {
        return Vec::new();
    }

    let cell = 0.04f32;
    let gw = ((1.0 / cell).ceil() as usize).max(1);
    let mut bins: Vec<Vec<usize>> = vec![Vec::new(); gw * gw];
    for (li, (_, x, y, _)) in pts.iter().enumerate() {
        let bx = ((*x / cell).floor() as usize).min(gw - 1);
        let by = ((*y / cell).floor() as usize).min(gw - 1);
        bins[by * gw + bx].push(li);
    }

    let mut visited = vec![false; pts.len()];
    let mut segs = Vec::new();

    for start in 0..pts.len() {
        if visited[start] {
            continue;
        }
        let mut stack = vec![start];
        visited[start] = true;
        let mut members = Vec::new();
        while let Some(i) = stack.pop() {
            members.push(i);
            let (_, x, y, _) = pts[i];
            let bx = ((x / cell).floor() as i32).max(0);
            let by = ((y / cell).floor() as i32).max(0);
            for oy in -1i32..=1 {
                for ox in -1i32..=1 {
                    let nx = bx + ox;
                    let ny = by + oy;
                    if nx < 0 || ny < 0 || nx >= gw as i32 || ny >= gw as i32 {
                        continue;
                    }
                    for &j in &bins[ny as usize * gw + nx as usize] {
                        if visited[j] {
                            continue;
                        }
                        let (_, x2, y2, _) = pts[j];
                        let dx = x2 - x;
                        let dy = y2 - y;
                        if dx * dx + dy * dy <= (cell * 1.9).powi(2) {
                            visited[j] = true;
                            stack.push(j);
                        }
                    }
                }
            }
        }
        if members.len() < 3 {
            continue;
        }

        let mx = members.iter().map(|&i| pts[i].1).sum::<f32>() / members.len() as f32;
        let my = members.iter().map(|&i| pts[i].2).sum::<f32>() / members.len() as f32;
        let mut sxx = 0.0f32;
        let mut syy = 0.0f32;
        let mut sxy = 0.0f32;
        for &i in &members {
            let dx = pts[i].1 - mx;
            let dy = pts[i].2 - my;
            sxx += dx * dx;
            syy += dy * dy;
            sxy += dx * dy;
        }
        let trace = sxx + syy;
        let det = sxx * syy - sxy * sxy;
        let disc = (trace * trace * 0.25 - det).max(0.0).sqrt();
        let l1 = trace * 0.5 + disc;
        let l2 = trace * 0.5 - disc;
        let aspect = if l2.abs() < 1e-8 {
            8.0
        } else {
            (l1 / l2.abs()).sqrt().clamp(1.0, 20.0)
        };
        // Düz çizgi: yüksek uzama
        if aspect < 1.95 {
            continue;
        }
        let (dx, dy) = if sxy.abs() > 1e-8 || (l1 - syy).abs() > 1e-8 {
            let vx = l1 - syy;
            let vy = sxy;
            let len = (vx * vx + vy * vy).sqrt().max(1e-6);
            (vx / len, vy / len)
        } else if sxx >= syy {
            (1.0, 0.0)
        } else {
            (0.0, 1.0)
        };
        let mut min_p = 0.0f32;
        let mut max_p = 0.0f32;
        for (k, &i) in members.iter().enumerate() {
            let p = (pts[i].1 - mx) * dx + (pts[i].2 - my) * dy;
            if k == 0 {
                min_p = p;
                max_p = p;
            } else {
                min_p = min_p.min(p);
                max_p = max_p.max(p);
            }
        }
        let length = (max_p - min_p).abs();
        if length < 0.05 {
            continue;
        }
        let strength =
            members.iter().map(|&i| pts[i].3).sum::<f32>() / members.len() as f32;
        segs.push(GreenLineSeg {
            x0: (mx + dx * min_p).clamp(0.02, 0.98),
            y0: (my + dy * min_p).clamp(0.02, 0.98),
            x1: (mx + dx * max_p).clamp(0.02, 0.98),
            y1: (my + dy * max_p).clamp(0.02, 0.98),
            strength,
            length,
        });
        if segs.len() >= 8 {
            break;
        }
    }
    segs.sort_by(|a, b| {
        (b.length * b.strength)
            .partial_cmp(&(a.length * a.strength))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    segs
}

fn is_map_pixel(p: &[u8; 4]) -> bool {
    // ELIC haritası: doygun yeşil / kırmızı-sarı / mavi tonları
    let s = saturation(p);
    let l = luminance(p);
    if s < 0.18 || l < 18.0 || l > 245.0 {
        return false;
    }
    let r = p[0] as i32;
    let g = p[1] as i32;
    let b = p[2] as i32;
    let greenish = g > r + 15 && g > b + 10;
    let warm = r > g && r > b && r > 70;
    let cool = b > r + 10 && b >= g - 20 && b > 50;
    let yellow = r > 160 && g > 120 && b < 120;
    greenish || warm || cool || yellow
}

fn is_ui_dark(p: &[u8; 4]) -> bool {
    let s = saturation(p);
    let l = luminance(p);
    // Windows görev çubuğu / koyu HUD zemini
    l < 55.0 && s < 0.25
}

/// Soldan sağa tarayarak HUD/skala genişliğini bul.
fn detect_left_hud_width(img: &RgbaImage) -> u32 {
    let w = img.width();
    let h = img.height();
    let limit = (w / 3).max(40).min(220);
    let sample_y0 = (h as f32 * 0.15) as u32;
    let sample_y1 = (h as f32 * 0.85) as u32;

    let mut best = 0u32;
    let mut map_streak = 0u32;

    for x in 0..limit {
        let mut map_n = 0u32;
        let mut ui_n = 0u32;
        let mut n = 0u32;
        let step = ((sample_y1 - sample_y0) / 40).max(1);
        let mut y = sample_y0;
        while y < sample_y1 {
            let p = img.get_pixel(x, y).0;
            if is_map_pixel(&p) {
                map_n += 1;
            } else if is_ui_dark(&p) || saturation(&p) < 0.12 {
                ui_n += 1;
            }
            n += 1;
            y += step;
        }
        let map_ratio = map_n as f32 / n.max(1) as f32;
        let ui_ratio = ui_n as f32 / n.max(1) as f32;

        // Sol skala: koyu zemin + ince renk şeridi → map oranı düşük
        if map_ratio > 0.42 && ui_ratio < 0.45 {
            map_streak += 1;
            if map_streak >= 4 {
                best = x.saturating_sub(3);
                break;
            }
        } else {
            map_streak = 0;
            best = x + 1;
        }
    }

    // En az biraz kırp (tipik ELIC skala ~70-140px)
    best.clamp(48, limit)
}

/// Alttan Windows görev çubuğu yüksekliği.
/// Win10/11: koyu, yarı saydam veya duvar kağıdı sızdıran çubuk — yalnız `is_ui_dark` yetmez.
fn detect_taskbar_height(img: &RgbaImage) -> u32 {
    let w = img.width();
    let h = img.height();
    // Win11 taskbar ~40–56px; yüksek ekranda %20'ye kadar tara
    let max_bar = ((h as f32) * 0.22).round() as u32;
    let max_bar = max_bar.clamp(48, 120).min(h / 4);

    let mut bar = 0u32;

    for dy in 0..max_bar {
        let y = h - 1 - dy;
        let mut dark = 0u32;
        let mut mapish = 0u32;
        let mut grayish = 0u32;
        let mut n = 0u32;
        let step = (w / 80).max(1);
        // Sol HUD'u sayma — görev çubuğu orta/sağdan ölç
        let x0 = (w / 5).min(w.saturating_sub(8));
        let mut x = x0;
        while x < w {
            let p = img.get_pixel(x, y).0;
            let l = luminance(&p);
            let s = saturation(&p);
            if is_ui_dark(&p) {
                dark += 1;
            }
            if s < 0.22 && l < 140.0 {
                grayish += 1;
            }
            if is_map_pixel(&p) {
                mapish += 1;
            }
            n += 1;
            x += step;
        }
        let dark_r = dark as f32 / n.max(1) as f32;
        let gray_r = grayish as f32 / n.max(1) as f32;
        let map_r = mapish as f32 / n.max(1) as f32;

        let looks_chrome = map_r < 0.22 && (dark_r > 0.35 || gray_r > 0.55 || (dark_r + gray_r) > 0.6);
        let looks_empty_map = map_r < 0.12;

        if looks_chrome || looks_empty_map {
            bar = dy + 1;
        } else if bar > 8 && map_r > 0.28 {
            // Haritaya girdik — Windows çubuğu biraz daha kesilsin
            return (bar + 18).min(max_bar);
        }
    }

    if bar < 28 {
        let fallback = (((h as f32) * 0.07).round() as u32).clamp(44, 64);
        fallback.min(max_bar)
    } else {
        (bar + 18).min(max_bar)
    }
}

/// Üst Windows başlık çubuğu / ELIC pusola HUD.
fn detect_top_hud_height(img: &RgbaImage, left: u32) -> u32 {
    let w = img.width();
    let h = img.height();
    let max_bar = ((h as f32) * 0.12).round() as u32;
    let max_bar = max_bar.clamp(20, 72);
    let x0 = left.min(w.saturating_sub(8));

    let mut bar = 0u32;
    for y in 0..max_bar {
        let mut chrome = 0u32;
        let mut mapish = 0u32;
        let step = ((w - x0) / 50).max(1);
        let mut x = x0;
        let mut n = 0u32;
        while x < w {
            let p = img.get_pixel(x, y).0;
            let l = luminance(&p);
            let s = saturation(&p);
            // Koyu HUD, açık başlık çubuğu, neredeyse beyaz menü
            if is_ui_dark(&p) || (s < 0.18 && l > 200.0) || (s < 0.20 && l < 130.0) {
                chrome += 1;
            }
            if is_map_pixel(&p) {
                mapish += 1;
            }
            n += 1;
            x += step;
        }
        let ui_r = chrome as f32 / n.max(1) as f32;
        let map_r = mapish as f32 / n.max(1) as f32;
        if map_r < 0.22 && ui_r > 0.32 {
            bar = y + 1;
        } else if bar > 8 && map_r > 0.35 {
            bar = (bar + 4).min(max_bar);
            break;
        }
    }
    bar.min(max_bar)
}

fn detect_right_margin(img: &RgbaImage, left: u32, top: u32, bottom: u32) -> u32 {
    let w = img.width();
    let h = img.height();
    let y0 = top.min(h.saturating_sub(8));
    let y1 = h.saturating_sub(bottom).max(y0 + 8);
    let max_m = (w / 20).clamp(0, 24);

    let mut margin = 0u32;
    for dx in 0..max_m {
        let x = w - 1 - dx;
        if x <= left {
            break;
        }
        let mut ui = 0u32;
        let mut n = 0u32;
        let step = ((y1 - y0) / 30).max(1);
        let mut y = y0;
        while y < y1 {
            let p = img.get_pixel(x, y).0;
            if is_ui_dark(&p) || saturation(&p) < 0.08 {
                ui += 1;
            }
            n += 1;
            y += step;
        }
        if ui as f32 / n.max(1) as f32 > 0.7 {
            margin = dx + 1;
        } else if margin > 2 {
            break;
        }
    }
    margin
}

/// Temizlenmiş harita: yalnızca UI/etiket beyazını yumuşat.
/// Sıcak/kırmızı yanındaki beyaz fışkırmayı (pozitif zirve) silme.
pub fn soften_white_overlays(img: &mut RgbaImage) {
    let w = img.width();
    let h = img.height();
    let is_warm = |q: &[u8; 4]| -> bool {
        let r = q[0] as i32;
        let g = q[1] as i32;
        let b = q[2] as i32;
        (r > g && r > b && r > 70) || (r > 160 && g > 120 && b < 130)
    };
    for y in 0..h {
        for x in 0..w {
            let p = img.get_pixel(x, y).0;
            let l = luminance(&p);
            let s = saturation(&p);
            if !(l > 220.0 && s < 0.12) {
                continue;
            }
            let mut warm_n = 0u32;
            let mut map_n = 0u32;
            let mut g_sum = 0u32;
            for dy in -2i32..=2 {
                for dx in -2i32..=2 {
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let q = img.get_pixel(nx as u32, ny as u32).0;
                    if is_warm(&q) {
                        warm_n += 1;
                    }
                    if is_map_pixel(&q) {
                        map_n += 1;
                        g_sum += q[1] as u32;
                    }
                }
            }
            // Pozitif fışkırma: sıcak komşu varsa dokunma
            if warm_n >= 2 {
                continue;
            }
            if map_n > 0 {
                let gg = (g_sum / map_n) as u8;
                img.put_pixel(x, y, Rgba([30, gg.saturating_sub(20).max(60), 40, 255]));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn crops_windows_taskbar_from_bottom() {
        let w = 320u32;
        let h = 240u32;
        let mut img = RgbaImage::from_pixel(w, h, Rgba([34, 180, 70, 255])); // map green
        // Sol HUD koyu
        for y in 0..h {
            for x in 0..70 {
                img.put_pixel(x, y, Rgba([18, 20, 22, 255]));
            }
        }
        // Alt görev çubuğu (Win11 koyu gri)
        for y in (h - 48)..h {
            for x in 0..w {
                img.put_pixel(x, y, Rgba([32, 32, 34, 255]));
            }
        }
        let (cleaned, crop) = clean_elic_screenshot(&img).expect("crop");
        assert!(
            crop.bottom >= 48,
            "taskbar bottom crop too small: {}",
            crop.bottom
        );
        assert!(
            cleaned.height() <= h - 48,
            "cleaned height should drop taskbar: {} vs {}",
            cleaned.height(),
            h
        );
        // Temizlenmiş alt satır harita yeşili olmalı
        let bottom_y = cleaned.height() - 1;
        let p = cleaned.get_pixel(cleaned.width() / 2, bottom_y).0;
        assert!(
            p[1] > p[0] && p[1] > 80,
            "bottom row should be map green, got {:?}",
            p
        );
    }
}
