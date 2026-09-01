//! Path support along corridor segments + side-view wall mouths.

use crate::preprocess::WallCue;

use super::types_local::Blob;

pub fn path_void_support(
    signed: &[f32],
    w: u32,
    h: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    thr: f32,
) -> f32 {
    path_samples(signed, w, h, x0, y0, x1, y1, thr, false)
}

/// Oda–oda / koridor bağı: kırmızı anomali path'i KESMEZ; nötr zemin de koridor sayılır.
/// (Karşı PC'de kırmızı dolgu mavi yolu böldüğü için tünel kayboluyordu.)
pub fn path_corridor_support(
    signed: &[f32],
    w: u32,
    h: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    thr: f32,
) -> f32 {
    path_samples(signed, w, h, x0, y0, x1, y1, thr, true)
}

/// Yapı path skoru: `through_red` açıkken kırmızı kesici değil.
pub fn path_structure_support(
    signed: &[f32],
    w: u32,
    h: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    thr: f32,
    through_red: bool,
) -> f32 {
    if through_red {
        path_corridor_support(signed, w, h, x0, y0, x1, y1, thr)
    } else {
        path_void_support(signed, w, h, x0, y0, x1, y1, thr)
    }
}

fn path_samples(
    signed: &[f32],
    w: u32,
    h: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    thr: f32,
    corridor_mode: bool,
) -> f32 {
    let n = 28;
    let mut hit = 0u32;
    let soft = thr * 0.62;
    let fill = thr * 0.55;
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len = (dx * dx + dy * dy).sqrt().max(1e-6);
    let px = -dy / len / (w.max(1) as f32);
    let py = dx / len / (h.max(1) as f32);

    for i in 0..=n {
        let t = i as f32 / n as f32;
        let nx = x0 + dx * t;
        let ny = y0 + dy * t;
        let mut local_hit = false;
        for k in -1i32..=1 {
            let sx = nx + px * k as f32;
            let sy = ny + py * k as f32;
            let gx = (sx * (w - 1) as f32).round() as i32;
            let gy = (sy * (h - 1) as f32).round() as i32;
            if gx < 0 || gy < 0 || gx >= w as i32 || gy >= h as i32 {
                continue;
            }
            let v = signed[(gy as u32 * w + gx as u32) as usize];
            // Mavi boşluk = koridor. Kırmızı dolgu/çıkış yolu KESMEZ.
            if v <= -soft || v >= fill {
                local_hit = true;
                break;
            }
            // Bağlantı: odalar arası nötr/zayıf zemin + her türlü kırmızı = geçit
            if corridor_mode && (v.abs() <= soft * 1.15 || v > 0.0) {
                local_hit = true;
                break;
            }
        }
        if local_hit {
            hit += 1;
        }
    }
    hit as f32 / (n + 1) as f32
}

/// Path kontrolü / çizim uçları — PCA ana ekseni (bbox değil).
pub fn tunnel_path_endpoints(b: &Blob, _side: bool) -> (f32, f32, f32, f32) {
    // Yan ve dik: ana eksen boyunca — eğimli koridor Y'si korunur
    tunnel_endpoints(b, false)
}

pub fn tunnel_endpoints(b: &Blob, _side: bool) -> (f32, f32, f32, f32) {
    let (dx, dy, hl) = if b.half_len < 0.02 || b.axis_aspect < 1.25 {
        if b.rx >= b.ry {
            (1.0, 0.0, b.rx * 0.85)
        } else {
            (0.0, 1.0, b.ry * 0.85)
        }
    } else {
        (b.dir_x, b.dir_y, b.half_len * 0.92)
    };
    (
        (b.cx - dx * hl).clamp(0.0, 1.0),
        (b.cy - dy * hl).clamp(0.0, 1.0),
        (b.cx + dx * hl).clamp(0.0, 1.0),
        (b.cy + dy * hl).clamp(0.0, 1.0),
    )
}

/// Dik çekim: tünel uçlarını duvar ipuçlarına yasla.
pub fn top_tunnel_endpoints(b: &Blob, walls: &[WallCue]) -> (f32, f32, f32, f32) {
    let (bx0, by0, bx1, by1) = tunnel_endpoints(b, false);
    if walls.len() < 2 {
        return (bx0, by0, bx1, by1);
    }
    let y_lo = (b.cy - b.ry.max(b.half_len) * 1.5).clamp(0.0, 1.0);
    let y_hi = (b.cy + b.ry.max(b.half_len) * 1.5).clamp(0.0, 1.0);
    let x_lo = (b.cx - b.rx.max(b.half_len) * 1.5).clamp(0.0, 1.0);
    let x_hi = (b.cx + b.rx.max(b.half_len) * 1.5).clamp(0.0, 1.0);
    let dx = bx1 - bx0;
    let dy = by1 - by0;
    let len = (dx * dx + dy * dy).sqrt().max(1e-6);
    let ux = dx / len;
    let uy = dy / len;

    let mut min_p = 0.0f32;
    let mut max_p = 0.0f32;
    let mut hit = 0u32;
    for c in walls {
        if c.x < x_lo || c.x > x_hi || c.y < y_lo || c.y > y_hi {
            continue;
        }
        let p = (c.x - b.cx) * ux + (c.y - b.cy) * uy;
        if hit == 0 {
            min_p = p;
            max_p = p;
        } else {
            min_p = min_p.min(p);
            max_p = max_p.max(p);
        }
        hit += 1;
    }
    if hit < 2 || (max_p - min_p).abs() < 0.04 {
        return (bx0, by0, bx1, by1);
    }
    (
        (b.cx + ux * min_p).clamp(0.02, 0.98),
        (b.cy + uy * min_p).clamp(0.02, 0.98),
        (b.cx + ux * max_p).clamp(0.02, 0.98),
        (b.cy + uy * max_p).clamp(0.02, 0.98),
    )
}

/// Yan çekim tünel ağızları: yalnızca boşluk kenarındaki duvar ipuçları.
pub fn side_tunnel_endpoints(
    b: &Blob,
    walls: &[WallCue],
    signed: &[f32],
    w: u32,
    h: u32,
    metal_thr: f32,
) -> (f32, f32, f32, f32) {
    let (fallback_x0, fallback_y0, fallback_x1, fallback_y1) = tunnel_path_endpoints(b, true);
    let y_lo = (b.cy - b.ry * 1.15).clamp(0.0, 1.0);
    let y_hi = (b.cy + b.ry * 1.15).clamp(0.0, 1.0);
    let left_edge = b.cx - b.rx.max(b.half_len);
    let right_edge = b.cx + b.rx.max(b.half_len);
    let x_lo = (left_edge - 0.04).clamp(0.0, 1.0);
    let x_hi = (right_edge + 0.04).clamp(0.0, 1.0);

    let mut left: Option<(f32, f32, f32)> = None; // x, y, score
    let mut right: Option<(f32, f32, f32)> = None;

    for c in walls {
        if c.y < y_lo || c.y > y_hi || c.x < x_lo || c.x > x_hi {
            continue;
        }
        // Kenara yapışık olmalı — uzaktaki highlight ağız uydurmasın
        let near_left = (c.x - left_edge).abs() < 0.07;
        let near_right = (c.x - right_edge).abs() < 0.07;
        if near_left && c.x <= b.cx + 0.02 {
            let score = c.strength / (0.02 + (c.x - left_edge).abs());
            if left.map(|(_, _, s)| score > s).unwrap_or(true) {
                left = Some((c.x.clamp(0.02, 0.98), c.y.clamp(0.02, 0.98), score));
            }
        }
        if near_right && c.x >= b.cx - 0.02 {
            let score = c.strength / (0.02 + (c.x - right_edge).abs());
            if right.map(|(_, _, s)| score > s).unwrap_or(true) {
                right = Some((c.x.clamp(0.02, 0.98), c.y.clamp(0.02, 0.98), score));
            }
        }
    }

    let (x0, y0, x1, y1) = match (left, right) {
        (Some((lx, ly, _)), Some((rx, ry, _))) if (rx - lx).abs() > 0.05 => {
            if lx <= rx {
                (lx, ly, rx, ry)
            } else {
                (rx, ry, lx, ly)
            }
        }
        (Some((lx, ly, _)), None) => {
            if lx <= fallback_x1 {
                (lx, ly, fallback_x1, fallback_y1)
            } else {
                (fallback_x1, fallback_y1, lx, ly)
            }
        }
        (None, Some((rx, ry, _))) => {
            if fallback_x0 <= rx {
                (fallback_x0, fallback_y0, rx, ry)
            } else {
                (rx, ry, fallback_x0, fallback_y0)
            }
        }
        _ => (fallback_x0, fallback_y0, fallback_x1, fallback_y1),
    };

    // Kırmızı uçta / içinde olabilir (tünel çıkışı, dolgu) — uçları kırmızından
    // çekip tüneli kısaltma. Yapı önce; metal sonra kesişir.
    let _ = (signed, w, h, metal_thr);
    if (x1 - x0).abs() + (y1 - y0).abs() < 0.05 {
        return (fallback_x0, fallback_y0, fallback_x1, fallback_y1);
    }
    if x0 <= x1 {
        (x0, y0, x1, y1)
    } else {
        (x1, y1, x0, y0)
    }
}
