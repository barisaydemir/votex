//! Landmark-free symmetry on signed anomaly field.

use super::regularity::{circularity_from_radii, corridor_stability};

/// Void intensity in [0,1] (negative field → positive void).
fn void_at(signed: &[f32], w: u32, h: u32, nx: f32, ny: f32) -> f32 {
    let gx = (nx.clamp(0.0, 1.0) * (w - 1) as f32).round() as i32;
    let gy = (ny.clamp(0.0, 1.0) * (h - 1) as f32).round() as i32;
    if gx < 0 || gy < 0 || gx >= w as i32 || gy >= h as i32 {
        return 0.0;
    }
    (-signed[(gy as u32 * w + gx as u32) as usize]).max(0.0).min(1.0)
}

fn reflect(
    px: f32,
    py: f32,
    cx: f32,
    cy: f32,
    ux: f32,
    uy: f32,
) -> (f32, f32) {
    let dx = px - cx;
    let dy = py - cy;
    let proj = dx * ux + dy * uy;
    let qx = cx + 2.0 * proj * ux - dx;
    let qy = cy + 2.0 * proj * uy - dy;
    (qx, qy)
}

fn axis_deg(ux: f32, uy: f32) -> f32 {
    // Map: +y = south in image, north = -y → bearing from north
    let north = -uy;
    let east = ux;
    let mut deg = east.atan2(north).to_degrees();
    if deg < 0.0 {
        deg += 360.0;
    }
    deg
}

/// Bilateral object symmetry via mirror residual on void field.
/// Returns (symmetry_index, residual, axis_deg).
pub fn bilateral_symmetry(
    signed: &[f32],
    w: u32,
    h: u32,
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
) -> (f32, f32, f32) {
    let major = rx.max(ry).max(0.02);
    let minor = rx.min(ry).max(0.01);
    // Prefer longer bbox axis as midline (object symmetry)
    let (ux, uy) = if rx >= ry {
        (1.0f32, 0.0)
    } else {
        (0.0f32, 1.0)
    };

    // Refine axis with local PCA on void pixels in ellipse
    let (ux, uy) = refine_axis(signed, w, h, cx, cy, rx, ry, ux, uy);

    let steps_u = ((major * (w.max(h) as f32) * 2.2).ceil() as i32).clamp(8, 48);
    let steps_v = ((minor * (w.max(h) as f32) * 2.2).ceil() as i32).clamp(6, 32);
    let mut sum_diff = 0.0f32;
    let mut sum_mag = 0.0f32;
    let mut n = 0u32;

    let vx = -uy;
    let vy = ux;

    for iu in -steps_u..=steps_u {
        for iv in -steps_v..=steps_v {
            let tu = iu as f32 / steps_u as f32;
            let tv = iv as f32 / steps_v as f32;
            // Ellipse in axis frame
            if tu * tu + tv * tv > 1.05 {
                continue;
            }
            let px = cx + ux * tu * major * 1.15 + vx * tv * minor * 1.15;
            let py = cy + uy * tu * major * 1.15 + vy * tv * minor * 1.15;
            if !(0.0..=1.0).contains(&px) || !(0.0..=1.0).contains(&py) {
                continue;
            }
            let (qx, qy) = reflect(px, py, cx, cy, ux, uy);
            if !(0.0..=1.0).contains(&qx) || !(0.0..=1.0).contains(&qy) {
                continue;
            }
            let a = void_at(signed, w, h, px, py);
            let b = void_at(signed, w, h, qx, qy);
            // Skip empty pairs (background)
            if a < 0.04 && b < 0.04 {
                continue;
            }
            sum_diff += (a - b).abs();
            sum_mag += a + b;
            n += 1;
        }
    }

    if n < 12 || sum_mag < 1e-4 {
        return (0.0, 1.0, axis_deg(ux, uy));
    }
    let residual = (sum_diff / sum_mag).clamp(0.0, 1.0);
    let score = (1.0 - residual).clamp(0.0, 1.0);
    (score, residual, axis_deg(ux, uy))
}

fn refine_axis(
    signed: &[f32],
    w: u32,
    h: u32,
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
    ux0: f32,
    uy0: f32,
) -> (f32, f32) {
    let mut cxx = 0.0f32;
    let mut cyy = 0.0f32;
    let mut cxy = 0.0f32;
    let mut count = 0.0f32;
    let rad = rx.max(ry) * 1.2;
    let n = 24;
    for iy in 0..=n {
        for ix in 0..=n {
            let px = cx + (ix as f32 / n as f32 - 0.5) * 2.0 * rad;
            let py = cy + (iy as f32 / n as f32 - 0.5) * 2.0 * rad;
            let dxn = (px - cx) / rx.max(1e-3);
            let dyn_ = (py - cy) / ry.max(1e-3);
            if dxn * dxn + dyn_ * dyn_ > 1.2 {
                continue;
            }
            let v = void_at(signed, w, h, px, py);
            if v < 0.08 {
                continue;
            }
            let dx = px - cx;
            let dy = py - cy;
            cxx += v * dx * dx;
            cyy += v * dy * dy;
            cxy += v * dx * dy;
            count += v;
        }
    }
    if count < 1e-3 {
        return (ux0, uy0);
    }
    cxx /= count;
    cyy /= count;
    cxy /= count;
    let diff = (cxx - cyy) * 0.5;
    let disc = (diff * diff + cxy * cxy).sqrt();
    let l1 = (cxx + cyy) * 0.5 + disc;
    let mut ux = cxy;
    let mut uy = l1 - cxx;
    if ux * ux + uy * uy < 1e-12 {
        ux = l1 - cyy;
        uy = cxy;
    }
    let len = (ux * ux + uy * uy).sqrt();
    if len < 1e-8 {
        return (ux0, uy0);
    }
    (ux / len, uy / len)
}

/// Radial circularity for shafts.
pub fn radial_symmetry(
    signed: &[f32],
    w: u32,
    h: u32,
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
) -> (f32, f32, f32) {
    let r0 = rx.min(ry).max(0.015);
    let mut radii = Vec::with_capacity(36);
    for k in 0..36 {
        let ang = k as f32 * std::f32::consts::TAU / 36.0;
        let dirx = ang.cos();
        let diry = ang.sin();
        let mut last = r0 * 0.3;
        for s in 1..28 {
            let t = r0 * (0.25 + s as f32 * 0.08);
            let px = cx + dirx * t;
            let py = cy + diry * t;
            let v = void_at(signed, w, h, px, py);
            if v < 0.06 {
                break;
            }
            last = t;
        }
        radii.push(last);
    }
    let circ = circularity_from_radii(&radii);
    (circ, 1.0 - circ, axis_deg(1.0, 0.0))
}

/// Tunnel axial corridor uniformity.
pub fn axial_corridor(
    signed: &[f32],
    w: u32,
    h: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
) -> (f32, f32, f32) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len = (dx * dx + dy * dy).sqrt().max(1e-6);
    let ux = dx / len;
    let uy = dy / len;
    let px = -uy;
    let py = ux;
    let samples = 16;
    let mut widths = Vec::with_capacity(samples);
    for i in 1..samples {
        let t = i as f32 / samples as f32;
        let cx = x0 + dx * t;
        let cy = y0 + dy * t;
        let mut half = 0.0f32;
        for s in 1..20 {
            let d = s as f32 * 0.008;
            let a = void_at(signed, w, h, cx + px * d, cy + py * d);
            let b = void_at(signed, w, h, cx - px * d, cy - py * d);
            if a < 0.05 && b < 0.05 {
                break;
            }
            half = d;
        }
        if half > 0.004 {
            widths.push(half * 2.0);
        }
    }
    let stab = corridor_stability(&widths);
    (stab, 1.0 - stab, axis_deg(ux, uy))
}
