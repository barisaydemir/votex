//! Connected-component blob extraction (+ PCA corridor axis).

use super::types_local::Blob;

pub fn connected_blobs(
    signed: &[f32],
    w: u32,
    h: u32,
    negative: bool,
    thr: f32,
    min_area: u32,
) -> Vec<Blob> {
    connected_blobs_ex(signed, w, h, negative, thr, min_area, false)
}

/// `bridge_positive`: void seed + kırmızı köprü — yapı içi kırmızı mavi bileşeni parçalamaz.
pub fn connected_blobs_ex(
    signed: &[f32],
    w: u32,
    h: u32,
    negative: bool,
    thr: f32,
    min_area: u32,
    bridge_positive: bool,
) -> Vec<Blob> {
    let n = (w * h) as usize;
    let mut visited = vec![false; n];
    let mut out = Vec::new();
    let neighbors = [(-1i32, 0), (1, 0), (0, -1), (0, 1)];
    let w_span = (w - 1).max(1) as f32;
    let h_span = (h - 1).max(1) as f32;
    let bridge = bridge_positive && negative;

    for y0 in 0..h as i32 {
        for x0 in 0..w as i32 {
            let start = (y0 as u32 * w + x0 as u32) as usize;
            if visited[start] {
                continue;
            }
            let v = signed[start];
            // Seed her zaman polariteye uygun — salt metal yapı olmaz
            let ok = if negative { v <= -thr } else { v >= thr };
            if !ok {
                continue;
            }

            let mut stack = vec![(x0, y0)];
            visited[start] = true;
            let mut sum_x = 0.0f32;
            let mut sum_y = 0.0f32;
            let mut sum_i = 0.0f32;
            let mut max_i = 0.0f32;
            let mut min_x = x0;
            let mut max_x = x0;
            let mut min_y = y0;
            let mut max_y = y0;
            let mut area = 0u32;
            let mut void_px = 0u32;
            let mut pts: Vec<(f32, f32)> = Vec::new();

            while let Some((x, y)) = stack.pop() {
                let i = (y as u32 * w + x as u32) as usize;
                let val = signed[i].abs();
                area += 1;
                if signed[i] <= -thr {
                    void_px += 1;
                }
                sum_x += x as f32;
                sum_y += y as f32;
                sum_i += val;
                max_i = max_i.max(val);
                min_x = min_x.min(x);
                max_x = max_x.max(x);
                min_y = min_y.min(y);
                max_y = max_y.max(y);
                pts.push((x as f32, y as f32));

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
                    let nok = if negative {
                        if bridge {
                            nv <= -thr || nv >= thr
                        } else {
                            nv <= -thr
                        }
                    } else {
                        nv >= thr
                    };
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
            // Köprü: yeterli mavi yoksa (neredeyse salt kırmızı) at
            if bridge && void_px < min_area.max(4) {
                continue;
            }

            let bw_px = (max_x - min_x + 1) as f32;
            let bh_px = (max_y - min_y + 1) as f32;
            let bbox = (bw_px * bh_px).max(1.0);
            let mean_x = sum_x / area as f32;
            let mean_y = sum_y / area as f32;
            let cx = (mean_x / w_span).clamp(0.0, 1.0);
            let cy = (mean_y / h_span).clamp(0.0, 1.0);
            let bw = bw_px / w as f32;
            let bh = bh_px / h as f32;
            let rx = (bw * 0.5).max(0.01);
            let ry = (bh * 0.5).max(0.01);

            let (dir_x, dir_y, half_len, axis_aspect) =
                principal_axis(&pts, mean_x, mean_y, w_span, h_span, rx, ry);

            out.push(Blob {
                cx,
                cy,
                rx,
                ry,
                intensity: (sum_i / area as f32).clamp(0.0, 1.0),
                max_intensity: max_i.clamp(0.0, 1.0),
                area_px: area,
                fill_ratio: (area as f32 / bbox).clamp(0.05, 1.0),
                dir_x,
                dir_y,
                half_len,
                axis_aspect,
                outline: outline_from_pixels(&pts, w_span, h_span),
            });
        }
    }

    out.sort_by(|a, b| {
        b.intensity
            .partial_cmp(&a.intensity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if out.len() > 40 {
        out.truncate(40);
    }
    out
}

/// PCA ana ekseni → normalize harita birim yönü + yarı uzunluk.
fn principal_axis(
    pts: &[(f32, f32)],
    mean_x: f32,
    mean_y: f32,
    w_span: f32,
    h_span: f32,
    rx: f32,
    ry: f32,
) -> (f32, f32, f32, f32) {
    // Bbox fallback
    let (fb_dx, fb_dy, fb_hl) = if rx >= ry {
        (1.0f32, 0.0, rx)
    } else {
        (0.0f32, 1.0, ry)
    };

    if pts.len() < 4 {
        return (fb_dx, fb_dy, fb_hl.max(0.02), (rx / ry.max(1e-3)).max(ry / rx.max(1e-3)));
    }

    let mut cxx = 0.0f32;
    let mut cyy = 0.0f32;
    let mut cxy = 0.0f32;
    for &(px, py) in pts {
        let dx = px - mean_x;
        let dy = py - mean_y;
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
    }
    let inv = 1.0 / pts.len() as f32;
    cxx *= inv;
    cyy *= inv;
    cxy *= inv;

    let diff = (cxx - cyy) * 0.5;
    let disc = (diff * diff + cxy * cxy).sqrt();
    let l1 = (cxx + cyy) * 0.5 + disc;
    let l2 = ((cxx + cyy) * 0.5 - disc).max(1e-6);

    // Eigenvector for λ1
    let mut ux = cxy;
    let mut uy = l1 - cxx;
    if ux * ux + uy * uy < 1e-10 {
        ux = l1 - cyy;
        uy = cxy;
    }
    let plen = (ux * ux + uy * uy).sqrt();
    if plen < 1e-8 {
        return (fb_dx, fb_dy, fb_hl.max(0.02), (l1 / l2).sqrt().max(1.0));
    }
    ux /= plen;
    uy /= plen;

    let mut t_min = f32::MAX;
    let mut t_max = f32::MIN;
    for &(px, py) in pts {
        let t = (px - mean_x) * ux + (py - mean_y) * uy;
        t_min = t_min.min(t);
        t_max = t_max.max(t);
    }
    let half_px = ((t_max - t_min) * 0.5).max(1.0);

    // Pixel direction → normalized map direction
    let mut dnx = ux / w_span;
    let mut dny = uy / h_span;
    let dn = (dnx * dnx + dny * dny).sqrt().max(1e-8);
    dnx /= dn;
    dny /= dn;
    // half length in normalized euclidean space
    let half_len = (half_px * dn).max(0.02);
    let aspect = (l1 / l2).sqrt().max(1.0);

    (dnx, dny, half_len, aspect)
}

const N8: [(i32, i32); 8] = [
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
    (0, -1),
    (1, -1),
];

/// Piksel kümesinden normalize (0–1) kapalı ayakizi; fazla uç RDP ile kesilir.
pub fn outline_from_pixels(pts: &[(f32, f32)], w_span: f32, h_span: f32) -> Vec<[f32; 2]> {
    if pts.is_empty() {
        return Vec::new();
    }
    let mut min_x = i32::MAX;
    let mut max_x = i32::MIN;
    let mut min_y = i32::MAX;
    let mut max_y = i32::MIN;
    for &(px, py) in pts {
        let x = px.round() as i32;
        let y = py.round() as i32;
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
    }
    let gw = (max_x - min_x + 3).max(3) as usize;
    let gh = (max_y - min_y + 3).max(3) as usize;
    let mut mask = vec![false; gw * gh];
    for &(px, py) in pts {
        let x = (px.round() as i32 - min_x + 1) as usize;
        let y = (py.round() as i32 - min_y + 1) as usize;
        if x < gw && y < gh {
            mask[y * gw + x] = true;
        }
    }
    let raw = walk_border(&mask, gw, gh);
    let mut outline: Vec<[f32; 2]> = if raw.len() >= 6 {
        raw.iter()
            .map(|&(x, y)| {
                let gx = x as i32 + min_x - 1;
                let gy = y as i32 + min_y - 1;
                [
                    (gx as f32 / w_span.max(1.0)).clamp(0.0, 1.0),
                    (gy as f32 / h_span.max(1.0)).clamp(0.0, 1.0),
                ]
            })
            .collect()
    } else {
        let x0 = (min_x as f32 / w_span.max(1.0)).clamp(0.0, 1.0);
        let x1 = (max_x as f32 / w_span.max(1.0)).clamp(0.0, 1.0);
        let y0 = (min_y as f32 / h_span.max(1.0)).clamp(0.0, 1.0);
        let y1 = (max_y as f32 / h_span.max(1.0)).clamp(0.0, 1.0);
        vec![[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    };
    ensure_ccw(&mut outline);
    simplify_closed(&outline, 40)
}

fn is_filled(mask: &[bool], gw: usize, gh: usize, x: i32, y: i32) -> bool {
    if x < 0 || y < 0 {
        return false;
    }
    let ux = x as usize;
    let uy = y as usize;
    ux < gw && uy < gh && mask[uy * gw + ux]
}

fn is_border(mask: &[bool], gw: usize, gh: usize, x: usize, y: usize) -> bool {
    if !mask[y * gw + x] {
        return false;
    }
    let xi = x as i32;
    let yi = y as i32;
    !is_filled(mask, gw, gh, xi + 1, yi)
        || !is_filled(mask, gw, gh, xi - 1, yi)
        || !is_filled(mask, gw, gh, xi, yi + 1)
        || !is_filled(mask, gw, gh, xi, yi - 1)
}

fn walk_border(mask: &[bool], gw: usize, gh: usize) -> Vec<(usize, usize)> {
    let Some(start) = find_start(mask, gw, gh) else {
        return Vec::new();
    };
    if !is_border(mask, gw, gh, start.0, start.1) {
        return Vec::new();
    }
    let mut contour = Vec::new();
    let mut x = start.0 as i32;
    let mut y = start.1 as i32;
    let mut dir = 0usize; // east
    let limit = (gw * gh * 4).max(64);
    for _ in 0..limit {
        contour.push((x as usize, y as usize));
        let mut found = false;
        // Turn left first (CCW outer contour)
        for k in 0..8 {
            let nd = (dir + 6 + k) % 8;
            let nx = x + N8[nd].0;
            let ny = y + N8[nd].1;
            if is_filled(mask, gw, gh, nx, ny) {
                x = nx;
                y = ny;
                dir = nd;
                found = true;
                break;
            }
        }
        if !found {
            break;
        }
        if x == start.0 as i32 && y == start.1 as i32 && contour.len() > 4 {
            break;
        }
    }
    contour
}

fn find_start(mask: &[bool], gw: usize, gh: usize) -> Option<(usize, usize)> {
    for y in 0..gh {
        for x in 0..gw {
            if mask[y * gw + x] {
                return Some((x, y));
            }
        }
    }
    None
}

fn ensure_ccw(pts: &mut [[f32; 2]]) {
    if pts.len() < 3 {
        return;
    }
    let mut area = 0.0f32;
    for i in 0..pts.len() {
        let j = (i + 1) % pts.len();
        area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
    }
    if area < 0.0 {
        pts.reverse();
    }
}

fn simplify_closed(pts: &[[f32; 2]], max_n: usize) -> Vec<[f32; 2]> {
    let mut ring = pts.to_vec();
    if ring.len() >= 2 {
        let first = ring[0];
        let last = *ring.last().unwrap();
        if (first[0] - last[0]).abs() < 1e-5 && (first[1] - last[1]).abs() < 1e-5 {
            ring.pop();
        }
    }
    if ring.len() <= 8 {
        return ring;
    }
    // Kapalı halkada first≈last olursa RDP 2 noktaya çöker — önce açık halka.
    let mut eps = 0.0015f32;
    let mut out = rdp(&ring, eps);
    for _ in 0..8 {
        if out.len() <= max_n {
            break;
        }
        eps *= 1.6;
        out = rdp(&ring, eps);
    }
    if out.len() < 4 {
        out = subsample_ring(&ring, 16.min(max_n).max(8));
    }
    if out.len() > max_n {
        out = subsample_ring(&out, max_n);
    }
    out
}

fn subsample_ring(pts: &[[f32; 2]], n: usize) -> Vec<[f32; 2]> {
    if pts.len() <= n {
        return pts.to_vec();
    }
    let step = pts.len() as f32 / n as f32;
    let mut thin = Vec::with_capacity(n);
    let mut i = 0.0f32;
    while thin.len() < n && (i as usize) < pts.len() {
        thin.push(pts[i as usize]);
        i += step;
    }
    thin
}

fn rdp(pts: &[[f32; 2]], eps: f32) -> Vec<[f32; 2]> {
    if pts.len() <= 2 {
        return pts.to_vec();
    }
    let mut idx = 0usize;
    let mut max_d = 0.0f32;
    let a = pts[0];
    let b = pts[pts.len() - 1];
    for i in 1..pts.len() - 1 {
        let d = perp_dist(pts[i], a, b);
        if d > max_d {
            max_d = d;
            idx = i;
        }
    }
    if max_d > eps {
        let left = rdp(&pts[..=idx], eps);
        let right = rdp(&pts[idx..], eps);
        let mut out = left;
        out.pop();
        out.extend(right);
        out
    } else {
        vec![a, b]
    }
}

fn perp_dist(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let len = (dx * dx + dy * dy).sqrt();
    if len < 1e-8 {
        let ux = p[0] - a[0];
        let uy = p[1] - a[1];
        return (ux * ux + uy * uy).sqrt();
    }
    ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx).abs() / len
}

/// Geniş/yatık blob'ları yerel tepe noktalarına böl — tek AABB koridorunu kes.
pub fn split_peak_blobs(
    signed: &[f32],
    w: u32,
    h: u32,
    blobs: Vec<Blob>,
    negative: bool,
    thr: f32,
    min_area: u32,
) -> Vec<Blob> {
    let w_span = (w - 1).max(1) as f32;
    let h_span = (h - 1).max(1) as f32;
    let mut out = Vec::new();

    for b in blobs {
        let wide = b.rx >= 0.08 || (b.rx / b.ry.max(1e-3) >= 1.8 && b.rx >= 0.055);
        if !wide {
            out.push(b);
            continue;
        }

        let x0 = ((b.cx - b.rx) * w_span).floor().max(0.0) as u32;
        let x1 = ((b.cx + b.rx) * w_span).ceil().min(w_span) as u32;
        let y0 = ((b.cy - b.ry) * h_span).floor().max(0.0) as u32;
        let y1 = ((b.cy + b.ry) * h_span).ceil().min(h_span) as u32;
        if x1 <= x0 + 2 || y1 <= y0 + 1 {
            out.push(b);
            continue;
        }

        // Sütun başına max |alan|
        let cols = (x1 - x0 + 1) as usize;
        let mut col_max = vec![0.0f32; cols];
        let mut col_y = vec![0.0f32; cols];
        let mut col_n = vec![0u32; cols];
        for y in y0..=y1 {
            for x in x0..=x1 {
                let v = signed[(y * w + x) as usize];
                let mag = if negative {
                    if v <= -thr {
                        -v
                    } else {
                        0.0
                    }
                } else if v >= thr {
                    v
                } else {
                    0.0
                };
                if mag <= 0.0 {
                    continue;
                }
                let ci = (x - x0) as usize;
                if mag > col_max[ci] {
                    col_max[ci] = mag;
                    col_y[ci] = y as f32;
                }
                col_n[ci] += 1;
            }
        }

        let mut peaks: Vec<usize> = Vec::new();
        let peak_thr = thr * 0.85;
        for i in 1..cols.saturating_sub(1) {
            if col_max[i] < peak_thr || col_n[i] == 0 {
                continue;
            }
            if col_max[i] >= col_max[i - 1] && col_max[i] >= col_max[i + 1] {
                if peaks
                    .last()
                    .map(|&p| i >= p + ((0.06 * w as f32) as usize).max(3))
                    .unwrap_or(true)
                {
                    peaks.push(i);
                } else if col_max[i] > col_max[*peaks.last().unwrap()] {
                    *peaks.last_mut().unwrap() = i;
                }
            }
        }

        if peaks.len() < 2 {
            out.push(b);
            continue;
        }

        let half_win = ((b.rx * w_span * 0.35) as u32).clamp(2, 12);
        let mut parts = Vec::new();
        for &pi in &peaks {
            let px = x0 + pi as u32;
            let py = col_y[pi].round() as u32;
            let mut sum_x = 0.0f32;
            let mut sum_y = 0.0f32;
            let mut sum_i = 0.0f32;
            let mut max_i = 0.0f32;
            let mut min_x = px as i32;
            let mut max_x = px as i32;
            let mut min_y = py as i32;
            let mut max_y = py as i32;
            let mut area = 0u32;
            let mut pts: Vec<(f32, f32)> = Vec::new();

            let xa = px.saturating_sub(half_win);
            let xb = (px + half_win).min(w - 1);
            let ya = ((b.cy - b.ry) * h_span).floor().max(0.0) as u32;
            let yb = ((b.cy + b.ry) * h_span).ceil().min(h_span) as u32;
            for y in ya..=yb.min(h - 1) {
                for x in xa..=xb {
                    let v = signed[(y * w + x) as usize];
                    let mag = if negative {
                        if v <= -thr {
                            -v
                        } else {
                            0.0
                        }
                    } else if v >= thr {
                        v
                    } else {
                        0.0
                    };
                    if mag <= 0.0 {
                        continue;
                    }
                    area += 1;
                    sum_x += x as f32;
                    sum_y += y as f32;
                    sum_i += mag;
                    max_i = max_i.max(mag);
                    min_x = min_x.min(x as i32);
                    max_x = max_x.max(x as i32);
                    min_y = min_y.min(y as i32);
                    max_y = max_y.max(y as i32);
                    pts.push((x as f32, y as f32));
                }
            }
            if area < min_area.max(4) {
                continue;
            }
            let mean_x = sum_x / area as f32;
            let mean_y = sum_y / area as f32;
            let bw = ((max_x - min_x + 1) as f32 / w as f32).max(0.02);
            let bh = ((max_y - min_y + 1) as f32 / h as f32).max(0.02);
            let rx = (bw * 0.5).min(0.12);
            let ry = (bh * 0.5).min(0.2);
            let (dir_x, dir_y, half_len, axis_aspect) =
                principal_axis(&pts, mean_x, mean_y, w_span, h_span, rx, ry);
            parts.push(Blob {
                cx: (mean_x / w_span).clamp(0.0, 1.0),
                cy: (mean_y / h_span).clamp(0.0, 1.0),
                rx,
                ry,
                intensity: (sum_i / area as f32).clamp(0.0, 1.0),
                max_intensity: max_i.clamp(0.0, 1.0),
                area_px: area,
                fill_ratio: (area as f32 / (bw * bh * w as f32 * h as f32).max(1.0)).clamp(0.05, 1.0),
                dir_x,
                dir_y,
                half_len: half_len.min(0.14),
                axis_aspect,
                outline: outline_from_pixels(&pts, w_span, h_span),
            });
        }

        if parts.len() >= 2 {
            out.extend(parts);
        } else {
            out.push(b);
        }
    }

    out.sort_by(|a, b| {
        b.intensity
            .partial_cmp(&a.intensity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if out.len() > 48 {
        out.truncate(48);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ortadan kırmızı bant — mavi ikiye bölünür; köprü tek bileşende birleştirir.
    #[test]
    fn through_red_keeps_void_with_red_inside() {
        let w = 16u32;
        let h = 16u32;
        let mut signed = vec![0.0f32; (w * h) as usize];
        for y in 3..13 {
            for x in 2..7 {
                signed[(y * w + x) as usize] = -0.55;
            }
            for x in 9..14 {
                signed[(y * w + x) as usize] = -0.55;
            }
            for x in 7..9 {
                signed[(y * w + x) as usize] = 0.75;
            }
        }
        let plain = connected_blobs(&signed, w, h, true, 0.25, 6);
        let bridged = connected_blobs_ex(&signed, w, h, true, 0.25, 6, true);
        assert!(
            plain.len() >= 2,
            "plain must split around red bar, got {}",
            plain.len()
        );
        assert_eq!(
            bridged.len(),
            1,
            "bridged must reunite void+red, got {}",
            bridged.len()
        );
        assert!(
            bridged[0].area_px > plain.iter().map(|b| b.area_px).max().unwrap_or(0),
            "bridged larger than any plain fragment"
        );
        assert!(
            bridged[0].outline.len() >= 4,
            "bridged blob must keep a footprint, got {}",
            bridged[0].outline.len()
        );
    }

    #[test]
    fn l_shape_outline_is_not_a_rectangle() {
        let mut pts = Vec::new();
        for y in 0..10 {
            for x in 0..4 {
                pts.push((x as f32, y as f32));
            }
        }
        for y in 0..4 {
            for x in 4..12 {
                pts.push((x as f32, y as f32));
            }
        }
        let outline = outline_from_pixels(&pts, 20.0, 20.0);
        assert!(
            outline.len() >= 6,
            "L blob needs more than a box, got {}",
            outline.len()
        );
        let min_x = outline.iter().map(|p| p[0]).fold(f32::MAX, f32::min);
        let max_x = outline.iter().map(|p| p[0]).fold(f32::MIN, f32::max);
        let min_y = outline.iter().map(|p| p[1]).fold(f32::MAX, f32::min);
        let max_y = outline.iter().map(|p| p[1]).fold(f32::MIN, f32::max);
        assert!(max_x - min_x > 0.2);
        assert!(max_y - min_y > 0.15);
    }

    #[test]
    fn compact_square_keeps_at_least_four_outline_points() {
        let mut pts = Vec::new();
        for y in 2..8 {
            for x in 2..8 {
                pts.push((x as f32, y as f32));
            }
        }
        let outline = outline_from_pixels(&pts, 20.0, 20.0);
        assert!(
            outline.len() >= 4,
            "compact room must still have a drawable footprint, got {}",
            outline.len()
        );
    }
}

