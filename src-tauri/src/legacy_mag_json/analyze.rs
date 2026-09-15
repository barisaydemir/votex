use super::parse::{
    average_step_spacing, cell_f32, estimate_step_count_from_spacing, looks_like_legacy_dik,
    parse_outer_and_table, parse_samples, parse_samples_with_steps, resolve_scan_segments,
    samples_from_table, scan_step_metrics, OuterDoc, Sample, ScanTable,
};
use super::level::{level_legacy_mag_json, median_f64, zero_order_median_level_xy};
use super::types::*;

fn magnitude(s: &Sample) -> f32 {
    (s.bx * s.bx + s.by * s.by + s.bz * s.bz).sqrt()
}

/// Aynı (x,y) civarına düşen tekrar çekimleri tek örneğe indir (Bx/By/Bz ortalaması).
/// Dönüş: birleşik örnekler, eşsiz nokta sayısı, tahmini geçiş sayısı (hücre başına max revisit).
fn coalesce_repeat_samples(samples: &[Sample], tol_m: f32) -> (Vec<Sample>, usize, u32) {
    if samples.is_empty() {
        return (Vec::new(), 0, 1);
    }
    let tol = tol_m.max(0.02);
    // Anahtar: santimetre ölçeğinde yuvarlanmış koordinat
    let key = |x: f32, y: f32| -> (i32, i32) {
        (
            (x / tol).round() as i32,
            (y / tol).round() as i32,
        )
    };
    use std::collections::HashMap;
    let mut acc: HashMap<(i32, i32), (f32, f32, f32, f32, f32, u32)> = HashMap::new();
    for s in samples {
        let k = key(s.x_m, s.y_m);
        let e = acc.entry(k).or_insert((0.0, 0.0, 0.0, 0.0, 0.0, 0));
        e.0 += s.x_m;
        e.1 += s.y_m;
        e.2 += s.bx;
        e.3 += s.by;
        e.4 += s.bz;
        e.5 += 1;
    }
    let mut max_revisit = 1u32;
    let mut out = Vec::with_capacity(acc.len());
    for (_, (sx, sy, bx, by, bz, n)) in acc {
        max_revisit = max_revisit.max(n);
        let nf = n as f32;
        out.push(Sample {
            x_m: sx / nf,
            y_m: sy / nf,
            bx: bx / nf,
            by: by / nf,
            bz: bz / nf,
        });
    }
    let unique_n = out.len();
    (out, unique_n, max_revisit)
}

/// Yakın pozitif blob'ları birleştir (aynı yerin tekrar tespitleri).
fn merge_proximate_blobs(
    blobs: Vec<Blob>,
    resid: &[f32],
    gw: u32,
    gh: u32,
    ext: Extent,
    merge_dist_m: f32,
) -> Vec<Blob> {
    if blobs.len() <= 1 {
        return blobs;
    }
    let centroid = |b: &Blob| -> (f32, f32) {
        let mut sx = 0.0f32;
        let mut sy = 0.0f32;
        for &(gx, gy) in &b.cells {
            let (mx, my) = ext.cell_to_m(gx as f32, gy as f32, gw, gh);
            sx += mx;
            sy += my;
        }
        let n = b.cells.len().max(1) as f32;
        (sx / n, sy / n)
    };

    let n = blobs.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(p: &mut [usize], i: usize) -> usize {
        let mut i = i;
        while p[i] != i {
            p[i] = p[p[i]];
            i = p[i];
        }
        i
    }
    let cents: Vec<(f32, f32)> = blobs.iter().map(centroid).collect();
    for i in 0..n {
        if blobs[i].polarity <= 0.0 {
            continue;
        }
        for j in (i + 1)..n {
            if blobs[j].polarity <= 0.0 {
                continue;
            }
            let dx = cents[i].0 - cents[j].0;
            let dy = cents[i].1 - cents[j].1;
            if (dx * dx + dy * dy).sqrt() <= merge_dist_m {
                let a = find(&mut parent, i);
                let b = find(&mut parent, j);
                if a != b {
                    parent[b] = a;
                }
            }
        }
    }

    use std::collections::{HashMap, HashSet};
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        groups.entry(find(&mut parent, i)).or_default().push(i);
    }

    let mut merged = Vec::with_capacity(groups.len());
    for (_root, idxs) in groups {
        if idxs.len() == 1 {
            merged.push(blobs[idxs[0]].clone());
            continue;
        }
        let mut set: HashSet<(u32, u32)> = HashSet::new();
        let mut sum_a = 0.0f32;
        let mut max_abs = 0.0f32;
        let mut pol = 0.0f32;
        for &i in &idxs {
            pol = if blobs[i].polarity > 0.0 { 1.0 } else { -1.0 };
            for &(gx, gy) in &blobs[i].cells {
                if set.insert((gx, gy)) {
                    let a = resid[(gy * gw + gx) as usize];
                    sum_a += a;
                    max_abs = max_abs.max(a.abs());
                }
            }
        }
        merged.push(Blob {
            cells: set.into_iter().collect(),
            sum_a,
            max_abs,
            polarity: pol,
        });
    }
    merged.sort_by(|a, b| {
        b.max_abs
            .partial_cmp(&a.max_abs)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    merged
}

// ---------------------------------------------------------------------------
// Şekil motoru v2 — bikübik ×4 upsample + marching-squares izo-kontür +
// ağırlıklı moment elipsi. Düşük çözünürlüklü taramalarda (ör. 14 adım ×
// ~3 geçiş) açı sıralı hücre kontürleri 1-4 noktaya çöküyordu; bu yol gerçek,
// kapalı ve alanlı poligonlar üretir.
// ---------------------------------------------------------------------------

const MS_UPSAMPLE: usize = 4;

/// 1B Catmull-Rom büyütme: n örnek → (n-1)*factor+1 örnek.
fn upsample_catmull_rom(src: &[f32], n: usize, factor: usize) -> Vec<f32> {
    if n < 2 || factor < 1 {
        return src.to_vec();
    }
    let out_n = (n - 1) * factor + 1;
    let mut out = Vec::with_capacity(out_n);
    for i in 0..out_n {
        let x = i as f32 / factor as f32;
        let k = (x.floor() as usize).min(n - 2);
        let t = x - k as f32;
        let p0 = src[k.saturating_sub(1)];
        let p1 = src[k];
        let p2 = src[(k + 1).min(n - 1)];
        let p3 = src[(k + 2).min(n - 1)];
        let t2 = t * t;
        let t3 = t2 * t;
        out.push(
            0.5 * (2.0 * p1
                + (p2 - p0) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3),
        );
    }
    out
}

/// Marching-squares segmentlerini uç noktalarına göre kapalı döngülere bağlar.
fn chain_ms_loops(segs: Vec<([f32; 2], [f32; 2])>) -> Vec<Vec<[f32; 2]>> {
    use std::collections::HashMap;
    let key = |p: [f32; 2]| ((p[0] * 4096.0).round() as i64, (p[1] * 4096.0).round() as i64);
    let mut adj: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (i, (a, b)) in segs.iter().enumerate() {
        adj.entry(key(*a)).or_default().push(i);
        adj.entry(key(*b)).or_default().push(i);
    }
    let mut used = vec![false; segs.len()];
    let mut loops = Vec::new();
    for start in 0..segs.len() {
        if used[start] {
            continue;
        }
        used[start] = true;
        let first = segs[start].0;
        let first_key = key(first);
        let mut pts = vec![first];
        let mut cur = segs[start].1;
        loop {
            pts.push(cur);
            let k = key(cur);
            if k == first_key {
                break;
            }
            let next = adj
                .get(&k)
                .and_then(|cands| cands.iter().copied().find(|&si| !used[si]));
            let Some(si) = next else { break };
            used[si] = true;
            let (pa, pb) = segs[si];
            cur = if key(pa) == k { pb } else { pa };
        }
        loops.push(pts);
    }
    loops
}

/// Alan verilen alanın en büyük marching-squares döngüsü (alan koordinatlarında).
fn marching_squares_largest_loop(
    field: &[f32],
    w: usize,
    h: usize,
    iso: f32,
) -> Option<Vec<[f32; 2]>> {
    if w < 2 || h < 2 || field.len() < w * h {
        return None;
    }
    let val = |x: usize, y: usize| field[y * w + x];
    let lerp = |a: f32, b: f32| {
        let d = b - a;
        if d.abs() < 1e-9 {
            0.5
        } else {
            ((iso - a) / d).clamp(0.0, 1.0)
        }
    };
    let mut segs: Vec<([f32; 2], [f32; 2])> = Vec::new();
    for y in 0..h - 1 {
        for x in 0..w - 1 {
            let tl = val(x, y);
            let tr = val(x + 1, y);
            let br = val(x + 1, y + 1);
            let bl = val(x, y + 1);
            let idx = (tl >= iso) as u8 * 8
                + (tr >= iso) as u8 * 4
                + (br >= iso) as u8 * 2
                + (bl >= iso) as u8;
            if idx == 0 || idx == 15 {
                continue;
            }
            let top = [x as f32 + lerp(tl, tr), y as f32];
            let bottom = [x as f32 + lerp(bl, br), y as f32 + 1.0];
            let left = [x as f32, y as f32 + lerp(tl, bl)];
            let right = [x as f32 + 1.0, y as f32 + lerp(tr, br)];
            match idx {
                1 | 14 => segs.push((left, bottom)),
                2 | 13 => segs.push((bottom, right)),
                3 | 12 => segs.push((left, right)),
                4 | 11 => segs.push((top, right)),
                6 | 9 => segs.push((top, bottom)),
                7 | 8 => segs.push((left, top)),
                5 => {
                    segs.push((top, right));
                    segs.push((left, bottom));
                }
                10 => {
                    segs.push((top, left));
                    segs.push((bottom, right));
                }
                _ => {}
            }
        }
    }
    let loops = chain_ms_loops(segs);
    loops
        .into_iter()
        .filter(|lp| lp.len() >= 3)
        .max_by(|a, b| {
            let (aa, _) = polygon_area_perimeter(a);
            let (ab, _) = polygon_area_perimeter(b);
            aa.partial_cmp(&ab).unwrap_or(std::cmp::Ordering::Equal)
        })
}

/// Blob'u çevreleyen yerel pencereyi ×4 bikübik büyütüp iso seviyesinde
/// marching-squares konturu çıkarır; normalize koordinata döner. Başarısızsa
/// eski açı sıralı hücre kontürüne düşer.
fn ms_blob_outline(blob: &Blob, resid: &[f32], gw: u32, gh: u32, iso_abs: f32) -> Vec<[f32; 2]> {
    let fallback = blob_outline_polygon(blob, gw, gh);
    if gw < 3 || gh < 3 || blob.cells.is_empty() || !iso_abs.is_finite() || iso_abs <= 0.0 {
        return fallback;
    }
    let (mut bx0, mut by0, mut bx1, mut by1) = (u32::MAX, u32::MAX, 0u32, 0u32);
    for &(gx, gy) in &blob.cells {
        bx0 = bx0.min(gx);
        by0 = by0.min(gy);
        bx1 = bx1.max(gx);
        by1 = by1.max(gy);
    }
    let margin = 2u32;
    let x0 = bx0.saturating_sub(margin);
    let y0 = by0.saturating_sub(margin);
    let x1 = (bx1 + margin).min(gw - 1);
    let y1 = (by1 + margin).min(gh - 1);
    let ww = (x1 - x0 + 1) as usize;
    let wh = (y1 - y0 + 1) as usize;
    if ww < 3 || wh < 3 {
        return fallback;
    }
    let mut win = vec![0.0f32; ww * wh];
    for yy in 0..wh {
        for xx in 0..ww {
            let gi = (y0 as usize + yy) * gw as usize + (x0 as usize + xx);
            win[yy * ww + xx] = resid[gi].abs();
        }
    }
    // Ayrıştırılmış bikübik: önce satırlar, sonra sütunlar.
    let row_w = (ww - 1) * MS_UPSAMPLE + 1;
    let rows: Vec<f32> = win
        .chunks(ww)
        .flat_map(|row| upsample_catmull_rom(row, ww, MS_UPSAMPLE))
        .collect();
    let col_h = (wh - 1) * MS_UPSAMPLE + 1;
    let mut field = vec![0.0f32; row_w * col_h];
    for xx in 0..row_w {
        let col: Vec<f32> = (0..wh).map(|yy| rows[yy * row_w + xx]).collect();
        let up = upsample_catmull_rom(&col, wh, MS_UPSAMPLE);
        for (yy, v) in up.into_iter().enumerate() {
            field[yy * row_w + xx] = v;
        }
    }
    let Some(loopf) = marching_squares_largest_loop(&field, row_w, col_h, iso_abs) else {
        return fallback;
    };
    let (area, _) = polygon_area_perimeter(&loopf);
    if loopf.len() < 4 || area <= 1e-7 {
        return fallback;
    }
    // Alan koordinatı → global ızgara → normalize (hücre altı hassasiyet korunur)
    let scale = 1.0 / MS_UPSAMPLE as f32;
    let denom_x = (gw as f32 - 1.0).max(1.0);
    let denom_y = (gh as f32 - 1.0).max(1.0);
    let mut poly: Vec<[f32; 2]> = loopf
        .iter()
        .map(|&p| {
            [
                (x0 as f32 + p[0] * scale) / denom_x,
                (y0 as f32 + p[1] * scale) / denom_y,
            ]
        })
        .collect();
    // Hafif decimation — JSON payload küçük kalsın
    let cap = 36usize;
    if poly.len() > cap {
        let step = (poly.len() + cap - 1) / cap;
        poly = poly.iter().step_by(step).copied().collect();
    }
    poly
}

/// Ağırlıklı moment elipsi (hücre değerleriyle ağırlıklandırılmış kovaryans).
#[derive(Clone, Copy, Debug)]
struct MomentEllipse {
    cx: f32,
    cy: f32,
    a: f32,
    b: f32,
    angle_rad: f32,
}

fn weighted_moment_ellipse(
    blob: &Blob,
    resid: &[f32],
    gw: u32,
    gh: u32,
    ext: Extent,
) -> Option<MomentEllipse> {
    let mut sw = 0.0f32;
    let mut sx = 0.0f32;
    let mut sy = 0.0f32;
    for &(gx, gy) in &blob.cells {
        let w = resid[(gy * gw + gx) as usize].abs().max(1e-6);
        let (mx, my) = ext.cell_to_m(gx as f32, gy as f32, gw, gh);
        sw += w;
        sx += mx * w;
        sy += my * w;
    }
    if sw <= 1e-9 {
        return None;
    }
    let (cx, cy) = (sx / sw, sy / sw);
    let mut cxx = 0.0f32;
    let mut cyy = 0.0f32;
    let mut cxy = 0.0f32;
    for &(gx, gy) in &blob.cells {
        let w = resid[(gy * gw + gx) as usize].abs().max(1e-6);
        let (mx, my) = ext.cell_to_m(gx as f32, gy as f32, gw, gh);
        let (dx, dy) = (mx - cx, my - cy);
        cxx += w * dx * dx;
        cyy += w * dy * dy;
        cxy += w * dx * dy;
    }
    cxx /= sw;
    cyy /= sw;
    cxy /= sw;
    let tr = cxx + cyy;
    let det = (cxx * cyy - cxy * cxy).max(0.0);
    let half = tr * 0.5;
    let disc = (half * half - det).max(0.0).sqrt();
    let l1 = (half + disc).max(1e-8);
    let l2 = (half - disc).max(1e-8);
    // Düzgün elips için yarı-eksen ≈ 2·sqrt(λ)
    let a = 2.0 * l1.sqrt();
    let b = 2.0 * l2.sqrt();
    let angle_rad = 0.5 * (2.0 * cxy).atan2(cxx - cyy);
    Some(MomentEllipse {
        cx,
        cy,
        a,
        b: b.min(a),
        angle_rad,
    })
}

/// Normalize kontür noktalarının moment elipsine RMS sapması (metre).
fn contour_rms_to_ellipse(polygon: &[[f32; 2]], ext: Extent, me: &MomentEllipse) -> Option<f32> {
    if polygon.len() < 3 || me.a <= 1e-6 || me.b <= 1e-6 {
        return None;
    }
    let (c, s) = (me.angle_rad.cos(), me.angle_rad.sin());
    let mut sum = 0.0f32;
    for &[nx, ny] in polygon {
        let px = ext.x0 + nx * ext.span_x();
        let py = ext.y0 + ny * ext.span_y();
        let (dx, dy) = (px - me.cx, py - me.cy);
        let u = dx * c + dy * s;
        let v = -dx * s + dy * c;
        // Gerçek en-yakın-nokta mesafesi: parametre açısında ternary arama.
        let phi0 = v.atan2(u);
        let dist2 = |phi: f32| {
            let (eu, ev) = (me.a * phi.cos(), me.b * phi.sin());
            (u - eu) * (u - eu) + (v - ev) * (v - ev)
        };
        let half_pi = std::f32::consts::FRAC_PI_2;
        let mut lo = phi0 - half_pi;
        let mut hi = phi0 + half_pi;
        for _ in 0..40 {
            let m1 = lo + (hi - lo) / 3.0;
            let m2 = hi - (hi - lo) / 3.0;
            if dist2(m1) < dist2(m2) {
                hi = m2;
            } else {
                lo = m1;
            }
        }
        sum += dist2((lo + hi) * 0.5);
    }
    Some((sum / polygon.len() as f32).sqrt())
}

fn median_f32(vals: &mut [f32]) -> f32 {
    if vals.is_empty() {
        return 0.0;
    }
    vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = vals.len();
    if n % 2 == 1 {
        vals[n / 2]
    } else {
        0.5 * (vals[n / 2 - 1] + vals[n / 2])
    }
}

fn stddev_f32(vals: &[f32], mean: f32) -> f32 {
    if vals.len() < 2 {
        return 1.0;
    }
    let var = vals
        .iter()
        .map(|v| {
            let d = *v - mean;
            d * d
        })
        .sum::<f32>()
        / (vals.len() as f32);
    var.sqrt().max(1.0)
}

#[derive(Clone, Copy, Debug)]
struct Extent {
    x0: f32,
    x1: f32,
    y0: f32,
    y1: f32,
}

impl Extent {
    fn from_samples(samples: &[Sample], meta_xm: f32, meta_ym: f32) -> Self {
        let mut x0 = f32::INFINITY;
        let mut x1 = f32::NEG_INFINITY;
        let mut y0 = f32::INFINITY;
        let mut y1 = f32::NEG_INFINITY;
        for s in samples {
            x0 = x0.min(s.x_m);
            x1 = x1.max(s.x_m);
            y0 = y0.min(s.y_m);
            y1 = y1.max(s.y_m);
        }
        if !x0.is_finite() || (x1 - x0).abs() < 1e-3 {
            x0 = 0.0;
            x1 = meta_xm.max(1.0);
        }
        if !y0.is_finite() || (y1 - y0).abs() < 1e-3 {
            y0 = 0.0;
            y1 = meta_ym.max(1.0);
        }
        // Metadata sahası daha genişse onu kullan (0..meta); data dışına taşmasın
        x0 = x0.min(0.0);
        y0 = y0.min(0.0);
        x1 = x1.max(meta_xm).max(x0 + 0.5);
        y1 = y1.max(meta_ym).max(y0 + 0.5);
        Self { x0, x1, y0, y1 }
    }

    fn span_x(self) -> f32 {
        (self.x1 - self.x0).max(0.5)
    }
    fn span_y(self) -> f32 {
        (self.y1 - self.y0).max(0.5)
    }

    fn to_cell(self, x: f32, y: f32, gw: u32, gh: u32) -> (u32, u32) {
        let gx = (((x - self.x0) / self.span_x()) * (gw as f32 - 1.0))
            .round()
            .clamp(0.0, (gw - 1) as f32) as u32;
        let gy = (((y - self.y0) / self.span_y()) * (gh as f32 - 1.0))
            .round()
            .clamp(0.0, (gh - 1) as f32) as u32;
        (gx, gy)
    }

    fn cell_to_m(self, gx: f32, gy: f32, gw: u32, gh: u32) -> (f32, f32) {
        let x = self.x0 + (gx / (gw as f32 - 1.0).max(1.0)) * self.span_x();
        let y = self.y0 + (gy / (gh as f32 - 1.0).max(1.0)) * self.span_y();
        (x, y)
    }
}

fn nearest_sample_xy(samples: &[Sample], x: f32, y: f32) -> (f32, f32) {
    let mut best = (x, y);
    let mut best_d = f32::INFINITY;
    for s in samples {
        let d = (s.x_m - x).hypot(s.y_m - y);
        if d < best_d {
            best_d = d;
            best = (s.x_m, s.y_m);
        }
    }
    best
}

/// Örnekleri gerçek data extent ile ızgaraya binle. Boş hücre doldurulmaz.
fn build_grid(
    samples: &[Sample],
    ext: Extent,
) -> (u32, u32, Vec<f32>, Vec<u32>) {
    let mut xs: Vec<f32> = samples.iter().map(|s| s.x_m).collect();
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    xs.dedup_by(|a, b| (*a - *b).abs() < 1e-3);
    let mut ys: Vec<f32> = samples.iter().map(|s| s.y_m).collect();
    ys.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    ys.dedup_by(|a, b| (*a - *b).abs() < 1e-3);

    let gw = (xs.len().max(4) as u32).clamp(4, 96);
    let gh = (ys.len().max(8) as u32).clamp(8, 128);

    let mut sum = vec![0.0f32; (gw * gh) as usize];
    let mut counts = vec![0u32; (gw * gh) as usize];

    for s in samples {
        let (gx, gy) = ext.to_cell(s.x_m, s.y_m, gw, gh);
        let idx = (gy * gw + gx) as usize;
        sum[idx] += magnitude(s);
        counts[idx] += 1;
    }

    let mut grid = vec![0.0f32; (gw * gh) as usize];
    for i in 0..grid.len() {
        if counts[i] > 0 {
            grid[i] = sum[i] / counts[i] as f32;
        }
    }

    (gw, gh, grid, counts)
}

/// Residual + σ; yalnızca ölçülen hücrelerden median/σ.
fn residual_field(grid: &[f32], counts: &[u32]) -> (Vec<f32>, f32, f32) {
    let mut vals: Vec<f32> = grid
        .iter()
        .zip(counts.iter())
        .filter(|(_, c)| **c > 0)
        .map(|(v, _)| *v)
        .collect();
    if vals.is_empty() {
        vals = grid.to_vec();
    }
    let med = median_f32(&mut vals);
    let resid: Vec<f32> = grid.iter().map(|v| v - med).collect();
    let measured: Vec<f32> = resid
        .iter()
        .zip(counts.iter())
        .filter(|(_, c)| **c > 0)
        .map(|(v, _)| *v)
        .collect();
    let mean = if measured.is_empty() {
        0.0
    } else {
        measured.iter().sum::<f32>() / measured.len() as f32
    };
    let sig = stddev_f32(&measured, mean);
    (resid, med, sig)
}

/// Geçişler arası interpolasyon — düşük çözünürlüklü taramalarda zayıf eksen
/// (geçiş yönü) fiziksel hücre boyu diğer eksenden ≥1,6× büyükse o eksende
/// ızgarayı k=2..6 kat yoğunlaştırır (lineer enterpolasyon), ardından kalan
/// iç boşlukları IDW (p=2) ile doldurur.
///
/// Konum eşlemesi korunur: yeni boyut n2 = k·(n−1)+1, orijinal satır i yeni
/// i·k konumuna düşer → metre koordinatları değişmez. İstatistikler
/// (median/σ) daha önce ölçülen hücrelerden hesaplandığı için enterpolasyon
/// σ'yı şişirmez; IDW kaynağı olarak yalnızca ölçülen hücreler kullanılır.
const INTERP_MAX_CELLS: usize = 700_000;

fn interpolate_pass_gaps(
    resid: &[f32],
    counts: &[u32],
    gw: u32,
    gh: u32,
    span_x: f32,
    span_y: f32,
) -> (u32, u32, Vec<f32>, Vec<u32>, u32, u32) {
    let cell_x = span_x / (gw.saturating_sub(1).max(1) as f32);
    let cell_y = span_y / (gh.saturating_sub(1).max(1) as f32);
    if !cell_x.is_finite() || !cell_y.is_finite() || cell_x <= 0.0 || cell_y <= 0.0 {
        return (gw, gh, resid.to_vec(), counts.to_vec(), 0, 0);
    }
    // Zayıf eksen: fiziksel hücre boyu büyük olan yön (geçiş aralığı).
    let (k, along_y) = if cell_y >= cell_x * 1.6 && gh >= 4 {
        ((cell_y / cell_x).round().clamp(2.0, 6.0) as usize, true)
    } else if cell_x >= cell_y * 1.6 && gw >= 4 {
        ((cell_x / cell_y).round().clamp(2.0, 6.0) as usize, false)
    } else {
        (1usize, true)
    };
    // Hücre sayısı sınırını aşarsa k'yı kırp.
    let base_cells = (gw as usize).max(1) * (gh as usize).max(1);
    let k = if base_cells > 0 {
        let max_k = ((INTERP_MAX_CELLS / base_cells) as f32).sqrt().floor() as usize;
        k.min(max_k.max(1))
    } else {
        1
    };
    let gw2 = if along_y { gw as usize } else { k * (gw as usize - 1) + 1 };
    let gh2 = if along_y { k * (gh as usize - 1) + 1 } else { gh as usize };

    let mut resid2 = vec![0.0f32; gw2 * gh2];
    let mut counts2 = vec![0u32; gw2 * gh2];
    // Yalnızca ölçülen hücreler IDW kaynağı olabilir.
    let mut measured = vec![false; gw2 * gh2];

    for y2 in 0..gh2 {
        for x2 in 0..gw2 {
            let (ox, oy, tx, ty) = if along_y {
                (x2, y2 / k, 0.0f32, (y2 % k) as f32 / k as f32)
            } else {
                (x2 / k, y2, (x2 % k) as f32 / k as f32, 0.0f32)
            };
            let dst = y2 * gw2 + x2;
            if tx == 0.0 && ty == 0.0 {
                let src = oy * gw as usize + ox;
                resid2[dst] = resid[src];
                counts2[dst] = counts[src];
                measured[dst] = counts[src] > 0;
                continue;
            }
            // Braket orijinal hücreler (aynı sütun/satırdaki komşu ölçüm satırı)
            let (ax, ay, bx, by) = if along_y {
                (ox, oy, ox, (oy + 1).min(gh as usize - 1))
            } else {
                (ox, oy, (ox + 1).min(gw as usize - 1), oy)
            };
            let ia = ay * gw as usize + ax;
            let ib = by * gw as usize + bx;
            if counts[ia] > 0 && counts[ib] > 0 {
                let t = if along_y { ty } else { tx };
                resid2[dst] = resid[ia] + (resid[ib] - resid[ia]) * t;
                counts2[dst] = 1; // enterpolasyonlu
            }
            // Tek taraf ölçülmüş → boş bırak (IDW turu değerlendirecek)
        }
    }

    // IDW boşluk doldurma — zaten değeri olan hücrelere dokunma.
    let radius = (k as i32 + 1).max(3);
    let mut filled = 0u32;
    let mut out = resid2.clone();
    for y2 in 0..gh2 {
        for x2 in 0..gw2 {
            let i = y2 * gw2 + x2;
            if measured[i] || counts2[i] > 0 {
                continue;
            }
            let mut sw = 0.0f32;
            let mut acc = 0.0f32;
            let mut nbrs = 0u32;
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    if dx == 0 && dy == 0 {
                        continue;
                    }
                    let nx = x2 as i32 + dx;
                    let ny = y2 as i32 + dy;
                    if nx < 0 || ny < 0 || nx >= gw2 as i32 || ny >= gh2 as i32 {
                        continue;
                    }
                    let j = (ny as usize) * gw2 + nx as usize;
                    if !measured[j] {
                        continue;
                    }
                    let d2 = ((dx * dx + dy * dy) as f32).max(1.0);
                    let w = 1.0 / d2; // p=2
                    sw += w;
                    acc += w * resid2[j];
                    nbrs += 1;
                }
            }
            if nbrs >= 3 && sw > 0.0 {
                out[i] = acc / sw;
                counts2[i] = 1;
                filled += 1;
            }
        }
    }

    (
        gw2 as u32,
        gh2 as u32,
        out,
        counts2,
        if k > 1 { k as u32 } else { 0 },
        filled,
    )
}


#[derive(Clone, Debug)]
struct DepthEstimate {
    center_m: f32,
    top_m: f32,
    bottom_m: f32,
    method: &'static str,
    rms: f32,
    uncertainty_m: f32,
    interval_low_m: f32,
    interval_high_m: f32,
    fit_samples: u32,
}

fn depth_interval(center_m: f32, uncertainty_m: f32) -> (f32, f32) {
    let uncertainty = uncertainty_m.max(0.05);
    let low = (center_m - uncertainty).max(0.08);
    let high = (center_m + uncertainty).min(10.0).max(low + 0.05);
    (low, high)
}

/// Dikey dipol ΔT: g(ρ,z) = (2z² − ρ²) / (ρ²+z²)^{5/2}
fn dipole_kernel(rho: f32, z: f32) -> f32 {
    let z = z.max(0.08);
    let r2 = rho * rho + z * z;
    let num = 2.0 * z * z - rho * rho;
    num / r2.powf(2.5)
}

fn apply_sensor_height(mut est: DepthEstimate, sensor_height_m: f32) -> DepthEstimate {
    let h = 0.50;
    est.center_m = (est.center_m + h).min(10.0);
    est.top_m = (est.top_m + h).min(9.8);
    est.bottom_m = (est.bottom_m + h).min(10.0).max(est.top_m + 0.15);
    est.interval_low_m = (est.interval_low_m + h).max(0.0);
    est.interval_high_m = (est.interval_high_m + h).min(10.5).max(est.interval_low_m + 0.1);
    est
}

/// Peters half-width: küre/dipol z ≈ rh / 0.766
fn depth_peters_halfwidth(half_width_m: f32) -> DepthEstimate {
    let rh = half_width_m.clamp(0.12, 2.5);
    let z = (rh / 0.766).clamp(0.25, 8.0);
    let half_h = (rh * 0.55).clamp(0.15, z * 0.85);
    let top = (z - half_h).clamp(0.08, 9.5);
    let bot = (z + half_h).min(10.0).max(top + 0.2);
    // Peters, manyetik profile doğrudan least-squares uydurmaz; bu nedenle
    // aralık dipol fitine göre daha geniş ve uyum hatası "uygulanmadı/zayıf"
    // olarak 1.0 ile işaretlenir.
    let uncertainty = (rh * 0.55 + z * 0.25).clamp(0.35, (z * 0.8).max(0.4));
    let (interval_low_m, interval_high_m) = depth_interval(z, uncertainty);
    DepthEstimate {
        center_m: z,
        top_m: top,
        bottom_m: bot,
        method: "peters",
        rms: 1.0,
        uncertainty_m: uncertainty,
        interval_low_m,
        interval_high_m,
        fit_samples: 0,
    }
}

/// Residual haritada pozitif tepe ↔ negatif çukur açıklığı (metre).
fn peak_trough_separation_m(
    resid: &[f32],
    counts: &[u32],
    ext: Extent,
    gw: u32,
    gh: u32,
    cx: f32,
    cy: f32,
    peak: f32,
) -> Option<(f32, f32)> {
    if peak <= 1e-6 {
        return None;
    }
    let search = (ext.span_x().min(ext.span_y()) * 0.85)
        .max(1.2)
        .min(ext.span_x().hypot(ext.span_y()) * 0.75);
    let mut trough: Option<(f32, f32, f32)> = None; // x,y,val
    for gy in 0..gh {
        for gx in 0..gw {
            let i = (gy * gw + gx) as usize;
            if counts.get(i).copied().unwrap_or(0) == 0 {
                continue;
            }
            let v = resid[i];
            if v >= 0.0 {
                continue;
            }
            let (mx, my) = ext.cell_to_m(gx as f32, gy as f32, gw, gh);
            let d = (mx - cx).hypot(my - cy);
            if d > search || d < 0.15 {
                continue;
            }
            match trough {
                None => trough = Some((mx, my, v)),
                Some((_, _, tv)) if v < tv => trough = Some((mx, my, v)),
                _ => {}
            }
        }
    }
    let (tx, ty, tval) = trough?;
    let lobe_ratio = (-tval) / peak;
    if lobe_ratio < 0.22 {
        return None;
    }
    let sep = (tx - cx).hypot(ty - cy);
    if !(0.45..=6.0).contains(&sep) {
        return None;
    }
    Some((sep, lobe_ratio))
}

fn depth_from_center(center_m: f32, half_width_m: f32, method: &'static str, rms: f32, fit_samples: u32) -> DepthEstimate {
    let z = center_m.clamp(0.25, 8.0);
    let half_h = (half_width_m * 0.55)
        .max(z * 0.18)
        .clamp(0.15, z * 0.9);
    let top = (z - half_h).clamp(0.08, 9.5);
    let bot = (z + half_h).min(10.0).max(top + 0.2);
    let uncertainty = ((half_width_m * 0.35).max(0.2) + rms * z * 0.9)
        .clamp(0.2, (z * 0.85).max(0.35));
    let (interval_low_m, interval_high_m) = depth_interval(z, uncertainty);
    DepthEstimate {
        center_m: z,
        top_m: top,
        bottom_m: bot,
        method,
        rms,
        uncertainty_m: uncertainty,
        interval_low_m,
        interval_high_m,
        fit_samples,
    }
}

/// Yerel (ρ, residual) → dikey-dipol LS derinlik; kötü uyumda Peters.
fn estimate_depth_dipole(pts: &[(f32, f32)], half_width_m: f32) -> DepthEstimate {
    let peak = pts.iter().map(|(_, f)| *f).fold(0.0f32, f32::max);
    let n_pos = pts.iter().filter(|(_, f)| *f > 0.0).count();
    if peak <= 1e-6 || n_pos < 5 {
        return depth_peters_halfwidth(half_width_m);
    }

    let z_lo = 0.15f32;
    let z_hi = 8.0f32;
    let steps = 80u32;
    let mut best_z = (half_width_m / 0.766).clamp(0.3, 6.0);
    let mut best_rms = f32::INFINITY;
    let win = (half_width_m * 3.0).max(1.2).min(4.0);

    for i in 0..=steps {
        let z = z_lo + (z_hi - z_lo) * (i as f32) / steps as f32;
        let mut sg2 = 0.0f32;
        let mut sfg = 0.0f32;
        let mut n = 0u32;
        for &(rho, f) in pts {
            if f <= 0.0 || rho > win {
                continue;
            }
            let g = dipole_kernel(rho, z);
            sg2 += g * g;
            sfg += f * g;
            n += 1;
        }
        if n < 5 || sg2 < 1e-18 {
            continue;
        }
        let a = sfg / sg2;
        if a <= 0.0 {
            continue;
        }
        let mut sse = 0.0f32;
        let mut m = 0u32;
        for &(rho, f) in pts {
            if f <= 0.0 || rho > win {
                continue;
            }
            let e = f - a * dipole_kernel(rho, z);
            sse += e * e;
            m += 1;
        }
        if m < 5 {
            continue;
        }
        let rms = (sse / m as f32).sqrt() / peak;
        if rms < best_rms {
            best_rms = rms;
            best_z = z;
        }
    }

    if !best_rms.is_finite() || best_rms > 0.6 {
        return depth_peters_halfwidth(half_width_m);
    }

    depth_from_center(
        best_z,
        half_width_m,
        "dipole",
        best_rms,
        pts.iter().filter(|(_, f)| *f > 0.0).count() as u32,
    )
}

/// Metal derinliği: dipol/Peters + bipolar tepe–çukur düzeltmesi.
///
/// Yalnızca pozitif lob üzerinde dipol LS, geniş bipolar anomalilerde sığ kalır
/// (half-width tavanı + dar pencere). Legacy3DMag saha örneklerinde tepe–çukur
/// açıklığı Δ ile gömü ~bipolar_sep_factor·Δ bandına oturur; dipolle
/// dipole_blend / (1−blend) karıştırılır. Sonuçlara cihaz–yüzey ofseti eklenir.
fn estimate_depth_metal(
    pts: &[(f32, f32)],
    half_width_m: f32,
    resid: &[f32],
    counts: &[u32],
    ext: Extent,
    gw: u32,
    gh: u32,
    cx: f32,
    cy: f32,
    peak: f32,
    params: LegacyDepthParams,
) -> DepthEstimate {
    let dipole = estimate_depth_dipole(pts, half_width_m);
    let Some((sep, _lobe_ratio)) =
        peak_trough_separation_m(resid, counts, ext, gw, gh, cx, cy, peak)
    else {
        return apply_sensor_height(dipole, params.sensor_height_m);
    };

    let z_bi = (sep * params.bipolar_sep_factor).clamp(0.5, 8.0);
    let r_cap = (ext.span_x().min(ext.span_y()) * 0.2).clamp(0.2, 1.2);
    let width_capped = half_width_m >= r_cap * 0.92;
    let dipole_shallow = dipole.center_m < z_bi * 0.72;
    if !(width_capped || dipole_shallow) {
        return apply_sensor_height(dipole, params.sensor_height_m);
    }

    let w_dip = params.dipole_blend.clamp(0.0, 1.0);
    let w_bi = 1.0 - w_dip;
    let z = (w_dip * dipole.center_m + w_bi * z_bi).clamp(0.4, 8.0);
    let disagree = (z - dipole.center_m).abs();
    let mut est = depth_from_center(
        z,
        sep.max(half_width_m),
        "bipolar",
        (dipole.rms * 0.5 + disagree / z.max(0.5) * 0.35).clamp(0.15, 0.85),
        dipole.fit_samples,
    );
    est.uncertainty_m = (est.uncertainty_m + disagree * 0.25)
        .clamp(0.35, (z * 0.55).max(0.5));
    let (lo, hi) = depth_interval(est.center_m, est.uncertainty_m);
    est.interval_low_m = lo;
    est.interval_high_m = hi;
    apply_sensor_height(est, params.sensor_height_m)
}

fn collect_radial_residuals(
    resid: &[f32],
    counts: &[u32],
    ext: Extent,
    gw: u32,
    gh: u32,
    cx: f32,
    cy: f32,
    max_rho: f32,
) -> Vec<(f32, f32)> {
    let mut out = Vec::with_capacity(64);
    for gy in 0..gh {
        for gx in 0..gw {
            let i = (gy * gw + gx) as usize;
            if counts[i] == 0 {
                continue;
            }
            let (mx, my) = ext.cell_to_m(gx as f32, gy as f32, gw, gh);
            let rho = (mx - cx).hypot(my - cy);
            if rho <= max_rho {
                out.push((rho, resid[i]));
            }
        }
    }
    out
}

fn local_half_max_radius(
    resid: &[f32],
    counts: &[u32],
    ext: Extent,
    gw: u32,
    gh: u32,
    cx: f32,
    cy: f32,
    peak: f32,
    search_m: f32,
) -> f32 {
    let thr = peak * 0.5;
    let mut r = 0.1f32;
    for gy in 0..gh {
        for gx in 0..gw {
            let i = (gy * gw + gx) as usize;
            if counts[i] == 0 || resid[i] < thr {
                continue;
            }
            let (mx, my) = ext.cell_to_m(gx as f32, gy as f32, gw, gh);
            let d = (mx - cx).hypot(my - cy);
            if d <= search_m {
                r = r.max(d);
            }
        }
    }
    let r_cap = (ext.span_x().min(ext.span_y()) * 0.2).clamp(0.2, 1.2);
    r.clamp(0.12, r_cap)
}

#[derive(Clone, Debug)]
struct ShapeFit {
    shape_type: &'static str,
    orientation_deg: f32,
    width_m: f32,
    length_m: f32,
    roundness: f32,
    aspect_ratio: f32,
    fit_error: f32,
    confidence: f32,
    source: &'static str,
}

fn polygon_area_perimeter(polygon: &[[f32; 2]]) -> (f32, f32) {
    if polygon.len() < 3 {
        return (0.0, 0.0);
    }
    let mut area2 = 0.0f32;
    let mut perimeter = 0.0f32;
    for i in 0..polygon.len() {
        let a = polygon[i];
        let b = polygon[(i + 1) % polygon.len()];
        area2 += a[0] * b[1] - b[0] * a[1];
        perimeter += (b[0] - a[0]).hypot(b[1] - a[1]);
    }
    (area2.abs() * 0.5, perimeter)
}

fn classify_shape(
    polygon: &[[f32; 2]],
    rx: f32,
    ry: f32,
    _kind: &str,
    as_candidate: bool,
    contour_rms_m: Option<f32>,
) -> ShapeFit {
    let width_m = (rx * 2.0).max(0.15);
    let length_m = (ry * 2.0).max(0.15);
    let aspect_ratio = (width_m.max(length_m) / width_m.min(length_m).max(0.05)).max(1.0);
    let (area, perimeter) = polygon_area_perimeter(polygon);
    let roundness = if perimeter > 1e-5 {
        (4.0 * std::f32::consts::PI * area / (perimeter * perimeter)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    let mut min_y = f32::INFINITY;
    let mut max_y = f32::NEG_INFINITY;
    for &[x, y] in polygon {
        min_x = min_x.min(x);
        max_x = max_x.max(x);
        min_y = min_y.min(y);
        max_y = max_y.max(y);
    }
    let bbox_area = ((max_x - min_x).max(0.0) * (max_y - min_y).max(0.0)).max(1e-5);
    let rectangularity = (area / bbox_area).clamp(0.0, 1.0);
    let mut mean_x = 0.0f32;
    let mut mean_y = 0.0f32;
    if !polygon.is_empty() {
        for &[x, y] in polygon {
            mean_x += x;
            mean_y += y;
        }
        let n = polygon.len() as f32;
        mean_x /= n;
        mean_y /= n;
    }
    let mut cov_xx = 0.0f32;
    let mut cov_yy = 0.0f32;
    let mut cov_xy = 0.0f32;
    for &[x, y] in polygon {
        let dx = x - mean_x;
        let dy = y - mean_y;
        cov_xx += dx * dx;
        cov_yy += dy * dy;
        cov_xy += dx * dy;
    }
    let orientation_deg = if polygon.len() >= 2 {
        0.5 * (2.0 * cov_xy).atan2(cov_xx - cov_yy).to_degrees()
    } else if width_m >= length_m {
        0.0
    } else {
        90.0
    };
    let irregularity = (1.0 - roundness).max(0.0) * 0.55 + (1.0 - rectangularity).max(0.0) * 0.45;

    // Dejenere kontür: 3'ten az nokta veya alan ~0 (örn. tek hücre genişliğindeki
    // blob'un gidiş-dönüş kontürü — LEGACY3DMAG düşük çözünürlükte yaygın).
    // Bu durumda roundness/rectangularity anlamsızlaşır ve her anomali
    // "irregular + RMS 1.00 + %4" tabanına düşer. Bunun yerine sınıflandırma
    // sığdırılmış rx/ry ölçüsünden yapılır ve kaynak "inferred" işaretlenir;
    // 3D katman da ölçülen kırık kontür yerine temiz elips geometrisi çizer.
    let degenerate_contour = polygon.len() < 3 || area <= 1e-5;
    let (shape_type, model_error) = if degenerate_contour {
        if aspect_ratio <= 1.25 {
            ("circle", 0.35)
        } else if aspect_ratio >= 2.2 {
            ("capsule", 0.45)
        } else {
            ("ellipse", 0.40)
        }
    } else if roundness >= 0.78 && aspect_ratio <= 1.25 {
        ("circle", (1.0 - roundness).clamp(0.0, 1.0))
    } else if roundness >= 0.66 && aspect_ratio > 1.25 {
        ("ellipse", ((1.0 - roundness) * 0.6 + (aspect_ratio - 1.0).min(2.0) * 0.08).clamp(0.0, 1.0))
    } else if rectangularity >= 0.82 && polygon.len() <= 16 {
        // MS kontürleri köşeleri yumuşattığı için dikdörtgen eşiği yükseltildi
        // (π/4≈0.785 elips rectangularity'sini dışarıda bırakır) ve nokta sayısı
        // sınırı MS çözünürlüğüne göre gevşetildi.
        (if aspect_ratio <= 1.25 { "square" } else { "rectangle" }, (1.0 - rectangularity).clamp(0.0, 1.0))
    } else if aspect_ratio >= 2.2 && roundness >= 0.46 {
        ("capsule", (1.0 - roundness).clamp(0.0, 1.0))
    } else if polygon.len() >= 5 {
        ("polygon", irregularity.clamp(0.0, 1.0))
    } else {
        ("irregular", irregularity.clamp(0.0, 1.0))
    };
    // Şekil motoru v2: ölçülen kontür-elips RMS'si varsa, elips ailesinde
    // sezgisel model hatası yerine göreli ölçülen sapmayı kullan.
    let model_error = if !degenerate_contour {
        match contour_rms_m {
            Some(rms_m) => match shape_type {
                "circle" | "ellipse" | "capsule" => {
                    (rms_m / (width_m.max(length_m) * 0.5).max(0.2)).clamp(0.01, 1.0)
                }
                _ => model_error,
            },
            None => model_error,
        }
    } else {
        model_error
    };
    let confidence = (1.0 - model_error).clamp(0.05, 0.98) * if as_candidate { 0.95 } else { 0.86 };
    ShapeFit {
        shape_type,
        orientation_deg,
        width_m,
        length_m,
        roundness,
        aspect_ratio,
        fit_error: model_error,
        confidence,
        source: if degenerate_contour { "inferred" } else { "grid-contour" },
    }
}

fn build_metal_at(
    cx: f32,
    cy: f32,
    peak: f32,
    r: f32,
    depth: &DepthEstimate,
    sigma: f32,
    polygon: Vec<[f32; 2]>,
    core_polygon: Vec<[f32; 2]>,
    map_width_m: f32,
    map_depth_m: f32,
) -> LegacyShape {
    let strength = peak / sigma.max(1.0);
    let fit = classify_shape(&polygon, r, r, "metal", true, None);
    let tpl = crate::shape_templates::match_templates(&polygon, r, r, strength, 1.0);
    let (foot_area_m2, foot_perim_m) = polygon_area_perimeter(&polygon);
    let contour_sigma = if polygon.len() >= 3 { 0.70 } else { 0.0 };
    LegacyShape {
        kind: "metal".into(),
        label: format!(
            "Metal · {strength:.1}σ · ({cx:.2},{cy:.2}) · {:.2} m [{}]",
            depth.center_m, depth.method
        ),
        cx,
        cy,
        rx: r,
        ry: r,
        polarity: 1.0,
        strength,
        confidence: (0.4 + strength.min(2.5) * 0.15).min(0.85),
        depth_top_m: depth.top_m,
        depth_bottom_m: depth.bottom_m,
        mesh_kind: "plume".into(),
        peak_sigma: strength,
        depth_label: format!(
            "merkez ({cx:.2},{cy:.2}) · {} z={:.2} · örtü {:.2}–{:.2} · r {:.2} · rms {:.2} · aralık {:.2}–{:.2} m",
            depth.method, depth.center_m, depth.top_m, depth.bottom_m, r, depth.rms,
            depth.interval_low_m, depth.interval_high_m
        ),
        depth_method: depth.method.into(),
        depth_fit_error: depth.rms,
        depth_uncertainty_m: depth.uncertainty_m,
        depth_interval_low_m: depth.interval_low_m,
        depth_interval_high_m: depth.interval_high_m,
        depth_fit_samples: depth.fit_samples,
        polygon,
        shape_type: fit.shape_type.into(),
        shape_source: fit.source.into(),
        orientation_deg: fit.orientation_deg,
        width_m: fit.width_m,
        length_m: fit.length_m,
        roundness: fit.roundness,
        aspect_ratio: fit.aspect_ratio,
        shape_fit_error: fit.fit_error,
        shape_confidence: fit.confidence,
        core_polygon,
        peak_x_m: cx,
        peak_y_m: cy,
        footprint_area_m2: foot_area_m2 * map_width_m.max(0.0) * map_depth_m.max(0.0),
        footprint_perimeter_m: foot_perim_m
            * ((map_width_m * map_width_m + map_depth_m * map_depth_m) * 0.5).sqrt().max(0.0),
        contour_threshold_sigma: contour_sigma,
        template_kind: tpl.best.into(),
        template_score: tpl.score,
        template_scores: tpl
            .scores
            .into_iter()
            .map(|(key, score)| (key.to_string(), score))
            .collect(),
    }
}

/// En güçlü pozitif ölçüm hücresi → metal.
fn metal_from_peak_measured(
    resid: &[f32],
    counts: &[u32],
    samples: &[Sample],
    ext: Extent,
    gw: u32,
    gh: u32,
    sigma: f32,
    params: LegacyDepthParams,
) -> Option<LegacyShape> {
    let mut best: Option<(u32, u32, f32)> = None;
    for gy in 0..gh {
        for gx in 0..gw {
            let i = (gy * gw + gx) as usize;
            if counts[i] == 0 {
                continue;
            }
            let a = resid[i];
            if a <= 0.0 {
                continue;
            }
            match best {
                None => best = Some((gx, gy, a)),
                Some((_, _, ba)) if a > ba => best = Some((gx, gy, a)),
                _ => {}
            }
        }
    }
    let (pgx, pgy, peak) = best?;
    if peak <= 0.0 {
        return None;
    }
    let (cx0, cy0) = ext.cell_to_m(pgx as f32, pgy as f32, gw, gh);
    let (cx, cy) = nearest_sample_xy(samples, cx0, cy0);
    let search_m = (ext.span_x().min(ext.span_y()) * 0.35).clamp(0.6, 2.5);
    let r = local_half_max_radius(resid, counts, ext, gw, gh, cx, cy, peak, search_m);
    let pts = collect_radial_residuals(resid, counts, ext, gw, gh, cx, cy, (r * 3.5).max(1.5));
    let depth = estimate_depth_metal(&pts, r, resid, counts, ext, gw, gh, cx, cy, peak, params);
    Some(build_metal_at(
        cx,
        cy,
        peak,
        r,
        &depth,
        sigma,
        Vec::new(),
        Vec::new(),
        ext.span_x(),
        ext.span_y(),
    ))
}

/// Tek pozitif blob → metal şekli.
fn metal_from_blob(
    blob: &Blob,
    resid: &[f32],
    counts: &[u32],
    samples: &[Sample],
    ext: Extent,
    gw: u32,
    gh: u32,
    sigma: f32,
    params: LegacyDepthParams,
) -> Option<LegacyShape> {
    let mut peak = 0.0f32;
    let mut wsum = 0.0f32;
    let mut sx = 0.0f32;
    let mut sy = 0.0f32;
    for &(gx, gy) in &blob.cells {
        let i = (gy * gw + gx) as usize;
        if counts.get(i).copied().unwrap_or(0) == 0 {
            continue;
        }
        let a = resid[i].max(0.0);
        peak = peak.max(a);
        let w = a * a + 1e-6;
        let (mx, my) = ext.cell_to_m(gx as f32, gy as f32, gw, gh);
        sx += mx * w;
        sy += my * w;
        wsum += w;
    }
    if peak <= 0.0 || wsum <= 1e-12 {
        return None;
    }
    if peak < sigma * 0.95 {
        return None;
    }
    let (cx, cy) = nearest_sample_xy(samples, sx / wsum, sy / wsum);
    let search_m = (ext.span_x().min(ext.span_y()) * 0.35).clamp(0.6, 2.5);
    let r = local_half_max_radius(resid, counts, ext, gw, gh, cx, cy, peak, search_m);
    let pts = collect_radial_residuals(resid, counts, ext, gw, gh, cx, cy, (r * 3.5).max(1.5));
    let depth = estimate_depth_metal(&pts, r, resid, counts, ext, gw, gh, cx, cy, peak, params);
    let (_, _, peak_abs) = peak_cell(blob, resid, gw);
    let poly = ms_blob_outline(blob, resid, gw, gh, peak_abs * 0.70);
    let core = ms_blob_outline(blob, resid, gw, gh, peak_abs * 0.50);
    Some(build_metal_at(
        cx,
        cy,
        peak,
        r,
        &depth,
        sigma,
        poly,
        core,
        ext.span_x(),
        ext.span_y(),
    ))
}

/// En güçlü pozitif blob(lar); yoksa tepe hücresinden tek metal.
fn metal_from_best_blob(
    blobs: &[Blob],
    resid: &[f32],
    counts: &[u32],
    samples: &[Sample],
    ext: Extent,
    gw: u32,
    gh: u32,
    sigma: f32,
    params: LegacyDepthParams,
) -> Option<LegacyShape> {
    metals_from_positive_blobs(blobs, resid, counts, samples, ext, gw, gh, sigma, params)
        .into_iter()
        .next()
        .or_else(|| metal_from_peak_measured(resid, counts, samples, ext, gw, gh, sigma, params))
}

/// Güçlü pozitif bloblardan en fazla 5 metal (örtüşmeyen).
fn metals_from_positive_blobs(
    blobs: &[Blob],
    resid: &[f32],
    counts: &[u32],
    samples: &[Sample],
    ext: Extent,
    gw: u32,
    gh: u32,
    sigma: f32,
    params: LegacyDepthParams,
) -> Vec<LegacyShape> {
    let mut ranked: Vec<&Blob> = blobs.iter().filter(|b| b.polarity > 0.0).collect();
    ranked.sort_by(|a, b| {
        b.max_abs
            .partial_cmp(&a.max_abs)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut out: Vec<LegacyShape> = Vec::new();
    for blob in ranked {
        if out.len() >= 5 {
            break;
        }
        let Some(metal) = metal_from_blob(blob, resid, counts, samples, ext, gw, gh, sigma, params) else {
            continue;
        };
        let overlaps = out.iter().any(|prev: &LegacyShape| {
            let dx = prev.cx - metal.cx;
            let dy = prev.cy - metal.cy;
            let min_r = (prev.rx.max(0.2) + metal.rx.max(0.2)) * 0.55;
            (dx * dx + dy * dy).sqrt() < min_r
        });
        if overlaps {
            continue;
        }
        out.push(metal);
    }
    out
}

#[derive(Clone)]
struct Blob {
    cells: Vec<(u32, u32)>,
    #[allow(dead_code)]
    sum_a: f32,
    max_abs: f32,
    polarity: f32,
}

fn extract_blobs(resid: &[f32], counts: &[u32], gw: u32, gh: u32, sigma: f32) -> Vec<Blob> {
    let thr = (sigma * 0.45).max(1.0);
    let n = (gw * gh) as usize;
    let mut seen = vec![false; n];
    let mut blobs = Vec::new();

    let neighbors = |gx: u32, gy: u32| -> Vec<(u32, u32)> {
        let mut out = Vec::with_capacity(4);
        if gx > 0 {
            out.push((gx - 1, gy));
        }
        if gx + 1 < gw {
            out.push((gx + 1, gy));
        }
        if gy > 0 {
            out.push((gx, gy - 1));
        }
        if gy + 1 < gh {
            out.push((gx, gy + 1));
        }
        out
    };

    for gy in 0..gh {
        for gx in 0..gw {
            let i = (gy * gw + gx) as usize;
            if counts[i] == 0 || seen[i] || resid[i].abs() < thr {
                continue;
            }
            let seed_pol = if resid[i] >= 0.0 { 1.0 } else { -1.0 };
            let mut stack = vec![(gx, gy)];
            seen[i] = true;
            let mut cells = Vec::new();
            let mut sum_a = 0.0f32;
            let mut max_abs = 0.0f32;

            while let Some((cx, cy)) = stack.pop() {
                let ci = (cy * gw + cx) as usize;
                let a = resid[ci];
                cells.push((cx, cy));
                sum_a += a;
                max_abs = max_abs.max(a.abs());
                for (nx, ny) in neighbors(cx, cy) {
                    let ni = (ny * gw + nx) as usize;
                    if counts[ni] == 0 || seen[ni] {
                        continue;
                    }
                    let na = resid[ni];
                    if na.abs() < thr {
                        continue;
                    }
                    if na.signum() != seed_pol && na.signum() != 0.0 {
                        continue;
                    }
                    seen[ni] = true;
                    stack.push((nx, ny));
                }
            }

            let min_cells = 1usize;
            if cells.len() >= min_cells {
                blobs.push(Blob {
                    cells,
                    sum_a,
                    max_abs,
                    polarity: seed_pol,
                });
            }
        }
    }

    blobs.sort_by(|a, b| {
        b.max_abs
            .partial_cmp(&a.max_abs)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    blobs.truncate(24);
    blobs
}

fn cell_to_norm(gx: u32, gy: u32, gw: u32, gh: u32) -> [f32; 2] {
    [
        (gx as f32) / (gw as f32 - 1.0).max(1.0),
        (gy as f32) / (gh as f32 - 1.0).max(1.0),
    ]
}

fn cell_to_m(gx: f32, gy: f32, gw: u32, gh: u32, x_m: f32, y_m: f32) -> (f32, f32) {
    let cx = (gx / (gw as f32 - 1.0).max(1.0)) * x_m;
    let cy = (gy / (gh as f32 - 1.0).max(1.0)) * y_m;
    (cx, cy)
}

/// Blob dış konturu — açıya göre sıralı normalize polygon.
fn blob_outline_polygon(blob: &Blob, gw: u32, gh: u32) -> Vec<[f32; 2]> {
    use std::collections::HashSet;
    let set: HashSet<(u32, u32)> = blob.cells.iter().copied().collect();
    let mut edge = Vec::new();
    for &(gx, gy) in &blob.cells {
        let border = gx == 0
            || gy == 0
            || gx + 1 >= gw
            || gy + 1 >= gh
            || !set.contains(&(gx.wrapping_sub(1), gy))
            || !set.contains(&(gx + 1, gy))
            || !set.contains(&(gx, gy.wrapping_sub(1)))
            || !set.contains(&(gx, gy + 1));
        if border {
            edge.push((gx, gy));
        }
    }
    if edge.is_empty() {
        return blob
            .cells
            .iter()
            .take(12)
            .map(|&(gx, gy)| cell_to_norm(gx, gy, gw, gh))
            .collect();
    }
    let mut sx = 0.0f32;
    let mut sy = 0.0f32;
    for &(gx, gy) in &edge {
        sx += gx as f32;
        sy += gy as f32;
    }
    let n = edge.len() as f32;
    let cgx = sx / n;
    let cgy = sy / n;
    edge.sort_by(|a, b| {
        let aa = ((a.1 as f32) - cgy).atan2((a.0 as f32) - cgx);
        let bb = ((b.1 as f32) - cgy).atan2((b.0 as f32) - cgx);
        aa.partial_cmp(&bb).unwrap_or(std::cmp::Ordering::Equal)
    });
    // Seyrek örnekle (çok nokta olmasın)
    let step = (edge.len() / 24).max(1);
    edge.iter()
        .step_by(step)
        .map(|&(gx, gy)| cell_to_norm(gx, gy, gw, gh))
        .collect()
}

fn peak_cell(blob: &Blob, resid: &[f32], gw: u32) -> (u32, u32, f32) {
    let mut best = (blob.cells[0].0, blob.cells[0].1, 0.0f32);
    for &(gx, gy) in &blob.cells {
        let a = resid[(gy * gw + gx) as usize].abs();
        if a >= best.2 {
            best = (gx, gy, a);
        }
    }
    best
}

/// Metal yarıçapı: tepeden ~%70 konturu (daha sıkı footprint).
fn metal_half_max_radius(
    peak_gx: u32,
    peak_gy: u32,
    peak_abs: f32,
    resid: &[f32],
    gw: u32,
    gh: u32,
    x_m: f32,
    y_m: f32,
) -> f32 {
    let thr = peak_abs * 0.70;
    let cell_dx = x_m / (gw.saturating_sub(1).max(1) as f32);
    let cell_dy = y_m / (gh.saturating_sub(1).max(1) as f32);
    let mut max_r = cell_dx.max(cell_dy) * 0.5;
    let r_cells = ((gw.max(gh) as f32) * 0.35).ceil() as u32;
    for dy in 0..=r_cells {
        for dx in 0..=r_cells {
            let cands = [
                (peak_gx.saturating_sub(dx), peak_gy.saturating_sub(dy)),
                ((peak_gx + dx).min(gw.saturating_sub(1)), peak_gy.saturating_sub(dy)),
                (peak_gx.saturating_sub(dx), (peak_gy + dy).min(gh.saturating_sub(1))),
                (
                    (peak_gx + dx).min(gw.saturating_sub(1)),
                    (peak_gy + dy).min(gh.saturating_sub(1)),
                ),
            ];
            for (cx, cy) in cands {
                let a = resid[(cy * gw + cx) as usize].abs();
                if a >= thr {
                    let dxm = (cx as f32 - peak_gx as f32) * cell_dx;
                    let dym = (cy as f32 - peak_gy as f32) * cell_dy;
                    max_r = max_r.max((dxm * dxm + dym * dym).sqrt());
                }
            }
        }
    }
    // Gerçek footprint — sahayı doldurmasın
    max_r.clamp(0.08, (x_m.min(y_m) * 0.22).min(1.2))
}

fn blob_to_shape(
    blob: &Blob,
    resid: &[f32],
    gw: u32,
    gh: u32,
    ext: Extent,
    sigma: f32,
    as_candidate: bool,
    params: LegacyDepthParams,
) -> LegacyShape {
    let mut min_x = u32::MAX;
    let mut max_x = 0u32;
    let mut min_y = u32::MAX;
    let mut max_y = 0u32;
    for &(gx, gy) in &blob.cells {
        min_x = min_x.min(gx);
        max_x = max_x.max(gx);
        min_y = min_y.min(gy);
        max_y = max_y.max(gy);
    }

    let (peak_gx, peak_gy, peak_abs) = peak_cell(blob, resid, gw);
    let strength = peak_abs / sigma.max(1.0);
    let peak_sigma = strength;
    let x_meters = ext.span_x();
    let y_meters = ext.span_y();

    // Merkez: residual-ağırlıklı; metal nihai şekli metal_from_best_blob'ta
    let (cx, cy, rx, ry, mesh_kind, kind, label, confidence, depth_top, depth_bot):
        (f32, f32, f32, f32, String, String, String, f32, f32, f32) =
        if as_candidate && blob.polarity > 0.0 && strength >= 1.15 {
            let r = metal_half_max_radius(
                peak_gx, peak_gy, peak_abs, resid, gw, gh, x_meters, y_meters,
            );
            let (mx, my) = ext.cell_to_m(peak_gx as f32, peak_gy as f32, gw, gh);
            let top = (r * 0.8).clamp(0.2, 5.0);
            let body = (r * 1.3).clamp(0.35, (10.0 - top).max(0.35));
            let bot = (top + body).min(10.0);
            (
                mx,
                my,
                r,
                r,
                "plume".into(),
                "metal".into(),
                format!("Metal aday · {strength:.1}σ · ({mx:.2},{my:.2})"),
                (0.42 + strength.min(2.5) * 0.18).min(0.82),
                top,
                bot,
            )
        } else {
            let mut sx = 0.0f32;
            let mut sy = 0.0f32;
            let mut wsum = 0.0f32;
            for &(gx, gy) in &blob.cells {
                let a = resid[(gy * gw + gx) as usize].abs().max(0.1);
                let (mx, my) = ext.cell_to_m(gx as f32, gy as f32, gw, gh);
                sx += mx * a;
                sy += my * a;
                wsum += a;
            }
            let (mx, my) = if wsum > 1e-6 {
                (sx / wsum, sy / wsum)
            } else {
                ext.cell_to_m(
                    (min_x + max_x) as f32 * 0.5,
                    (min_y + max_y) as f32 * 0.5,
                    gw,
                    gh,
                )
            };
            let rx = (((max_x - min_x + 1) as f32) / gw as f32 * x_meters * 0.5).max(0.15);
            let ry = (((max_y - min_y + 1) as f32) / gh as f32 * y_meters * 0.5).max(0.15);
            let aspect = (rx.max(ry) / rx.min(ry).max(0.05)).max(1.0);

            if as_candidate {
                if aspect >= 2.2 {
                    let top = (0.45 + (2.0 - strength.min(2.0)) * 0.35).clamp(0.35, 1.4);
                    let h = (1.0 + strength.min(2.5) * 0.7).clamp(0.9, 3.2);
                    (
                        mx,
                        my,
                        rx,
                        ry,
                        "elongated".into(),
                        "tunnel".into(),
                        format!("Koridor · örtü {top:.2}–{:.2} m", top + h),
                        (0.28 + strength.min(2.0) * 0.12).min(0.58),
                        top,
                        top + h,
                    )
                } else {
                    let top = (0.5 + (2.0 - strength.min(2.0)) * 0.4).clamp(0.4, 1.6);
                    let h = (1.2 + strength.min(2.5) * 0.65).clamp(1.0, 3.5);
                    (
                        mx,
                        my,
                        rx,
                        ry,
                        "box".into(),
                        "room".into(),
                        format!("Yapı · örtü {top:.2} m · h {h:.2} m"),
                        (0.30 + strength.min(2.0) * 0.12).min(0.6),
                        top,
                        top + h,
                    )
                }
            } else if blob.polarity > 0.0 {
                let top = (0.25 + (2.0 - strength.min(2.0)) * 0.3).clamp(0.2, 1.0);
                let h = (0.7 + strength.min(3.0) * 0.5).clamp(0.5, 2.5);
                (
                    mx,
                    my,
                    rx,
                    ry,
                    "box".into(),
                    "anomaly".into(),
                    format!("Pozitif anomali · {strength:.1}σ · {top:.2}–{:.2} m", top + h),
                    (0.38 + strength.min(2.0) * 0.15).min(0.72),
                    top,
                    top + h,
                )
            } else {
                let top = (0.7 + strength.min(2.0) * 0.35).clamp(0.5, 2.0);
                let h = (1.4 + strength.min(2.5) * 0.8).clamp(1.0, 4.0);
                (
                    mx,
                    my,
                    rx,
                    ry,
                    "box".into(),
                    "anomaly".into(),
                    format!("Negatif anomali · {strength:.1}σ · {top:.2}–{:.2} m", top + h),
                    (0.36 + strength.min(2.0) * 0.14).min(0.7),
                    top,
                    top + h,
                )
            }
        };

    // Şekil motoru v2: yerel pencere ×4 bikübik + marching-squares kontür.
    let polygon = if kind == "metal" {
        // Obje şekli: ~%70 tepe konturu; yayılım için en az 8 köşe
        let mut poly = ms_blob_outline(blob, resid, gw, gh, peak_abs * 0.70);
        if poly.len() < 5 {
            poly = blob_outline_polygon(blob, gw, gh);
        }
        poly
    } else {
        ms_blob_outline(blob, resid, gw, gh, (sigma * 0.45).max(1.0))
    };
    let moment = weighted_moment_ellipse(blob, resid, gw, gh, ext);
    let contour_rms_m = moment
        .as_ref()
        .and_then(|me| contour_rms_to_ellipse(&polygon, ext, me))
        .map(|rms| rms.clamp(0.0, 2.0));
    let depth_label = format!(
        "örtü {:.2} m · taban {:.2} m · kalınlık {:.2} m · cihaz+{:.2} m",
        depth_top + params.sensor_height_m,
        depth_bot + params.sensor_height_m,
        (depth_bot - depth_top).max(0.0),
        params.sensor_height_m
    );
    // Genel blob şekillerinde fiziksel model fit'i yapılmaz. Bunu açıkça
    // işaretleyip, geometrik derinlik aralığını konservatif belirsizlik olarak
    // yayınlarız; UI böylece bu değerleri kesin ölçüm gibi göstermez.
    let depth_top = depth_top + params.sensor_height_m;
    let depth_bot = (depth_bot + params.sensor_height_m).min(10.0).max(depth_top + 0.15);
    let depth_center = (depth_top + depth_bot) * 0.5;
    let depth_uncertainty = ((depth_bot - depth_top) * 0.6).max(0.45);
    let (depth_interval_low_m, depth_interval_high_m) =
        depth_interval(depth_center, depth_uncertainty);
    let fit = classify_shape(&polygon, rx, ry, &kind, as_candidate, contour_rms_m);
    // Şablon eşleştirme katmanı: MS kontürünü oda/tünel/şaft/metal maskeleriyle
    // korelasyonla sınıflandır (geometri 0.62 + fiziksel öncüller 0.38).
    let tpl = crate::shape_templates::match_templates(&polygon, rx, ry, strength, blob.polarity);
    let (foot_area_m2, foot_perim_m) = polygon_area_perimeter(&polygon);
    let contour_sigma = if polygon.len() >= 3 { 0.45 } else { 0.0 };

    LegacyShape {
        kind,
        label,
        cx,
        cy,
        rx,
        ry,
        polarity: blob.polarity,
        strength,
        confidence,
        depth_top_m: depth_top,
        depth_bottom_m: depth_bot,
        mesh_kind,
        peak_sigma,
        depth_label,
        depth_method: "heuristic".into(),
        depth_fit_error: 1.0,
        depth_uncertainty_m: depth_uncertainty,
        depth_interval_low_m,
        depth_interval_high_m,
        depth_fit_samples: 0,
        polygon,
        shape_type: fit.shape_type.into(),
        shape_source: fit.source.into(),
        orientation_deg: fit.orientation_deg,
        width_m: fit.width_m,
        length_m: fit.length_m,
        roundness: fit.roundness,
        aspect_ratio: fit.aspect_ratio,
        shape_fit_error: fit.fit_error,
        shape_confidence: fit.confidence,
        core_polygon: ms_blob_outline(blob, resid, gw, gh, peak_abs * 0.50),
        peak_x_m: ext.cell_to_m(peak_gx as f32, peak_gy as f32, gw, gh).0,
        peak_y_m: ext.cell_to_m(peak_gx as f32, peak_gy as f32, gw, gh).1,
        footprint_area_m2: foot_area_m2 * x_meters * y_meters,
        footprint_perimeter_m: foot_perim_m
            * ((x_meters * x_meters + y_meters * y_meters) * 0.5).sqrt(),
        contour_threshold_sigma: contour_sigma,
        template_kind: tpl.best.into(),
        template_score: tpl.score,
        template_scores: tpl
            .scores
            .into_iter()
            .map(|(key, score)| (key.to_string(), score))
            .collect(),
    }
}

pub fn analyze_legacy_dik(content: &str) -> Result<LegacyDikResult, String> {
    analyze_legacy_dik_with_options(content, None, None, LegacyDepthParams::default())
}

/// Legacy dik JSON analizini cihazın ardışık tarama adım/geçiş sayısına göre yap.
/// `None` veya `Some(0)` JSON içindeki segmentleri, yoksa tek otomatik segmenti kullanır.
pub fn analyze_legacy_dik_with_steps(
    content: &str,
    requested_steps: Option<u32>,
) -> Result<LegacyDikResult, String> {
    analyze_legacy_dik_with_options(content, requested_steps, None, LegacyDepthParams::default())
}

/// Legacy dik JSON analizini kullanıcı tanımlı yatay adım açıklığıyla yap.
/// Açıklık girildiğinde, koordinatlarda ölçülen tarama genişliğinden adım sayısı
/// hesaplanır ve bu sayı manuel adım sayısına göre önceliklidir.
///
/// Önemli: JSON'da fiziksel `segment_ranges` varsa median leveling **yalnızca**
/// bu geçişler üzerinde yapılır. Matris/adım sayısı ve adım açıklığı yalnızca
/// UI adım etiketlerini üretir — derinliği değiştirmez. Segment yoksa eski
/// davranış korunur (adım sayısı leveling'i de böler).
pub fn analyze_legacy_dik_with_step_spacing(
    content: &str,
    requested_steps: Option<u32>,
    requested_spacing_m: Option<f32>,
) -> Result<LegacyDikResult, String> {
    analyze_legacy_dik_with_options(
        content,
        requested_steps,
        requested_spacing_m,
        LegacyDepthParams::default(),
    )
}

/// Adım + derinlik proxy parametreleriyle Legacy dik analizi.
pub fn analyze_legacy_dik_with_options(
    content: &str,
    requested_steps: Option<u32>,
    requested_spacing_m: Option<f32>,
    depth_params: LegacyDepthParams,
) -> Result<LegacyDikResult, String> {
    let mut params = depth_params.clamped();
    params.sensor_height_m = 0.50;
    let (outer, meta, mut table, ix, iy, iz, ixm, iym) = parse_outer_and_table(content)?;
    let spacing = requested_spacing_m
        .filter(|value| value.is_finite() && *value > 0.0);
    let has_json_passes = !outer.segment_ranges.is_empty();

    // Leveling geçişleri: JSON segmentleri varsa asla matris/adım ile ezme.
    let level_step_override = if has_json_passes {
        None
    } else if let Some(requested) = requested_steps.filter(|steps| *steps > 0) {
        Some(requested)
    } else if let Some(spacing_m) = spacing {
        Some(estimate_step_count_from_spacing(&table, ixm, iym, spacing_m).max(1))
    } else {
        requested_steps.filter(|steps| *steps > 0)
    };
    let level_segments =
        resolve_scan_segments(table.data.len(), level_step_override, &outer.segment_ranges)?;

    // UI adım listesi: matris / açıklık burada etkili (etiket + 3D halkalar).
    let (display_segments, scan_step_input_m) =
        if let Some(requested) = requested_steps.filter(|steps| *steps > 0) {
            (
                resolve_scan_segments(table.data.len(), Some(requested), &outer.segment_ranges)?,
                0.0,
            )
        } else if let Some(spacing_m) = spacing {
            let inferred_steps = estimate_step_count_from_spacing(&table, ixm, iym, spacing_m);
            (
                resolve_scan_segments(
                    table.data.len(),
                    Some(inferred_steps.max(1)),
                    &outer.segment_ranges,
                )?,
                spacing_m,
            )
        } else {
            (level_segments.clone(), 0.0)
        };

    zero_order_median_level_xy(&mut table.data, ix, iy, &level_segments)?;
    let scan_steps = scan_step_metrics(&table, &display_segments, ixm, iym);
    let scan_step_spacing_m = average_step_spacing(&scan_steps);
    let raw_samples = samples_from_table(&table, ix, iy, iz, ixm, iym)?;
    let x_m = meta.x_meters;
    let y_m = meta.y_meters;
    let raw_n = raw_samples.len();
    let tol = (x_m.min(y_m) * 0.04).clamp(0.05, 0.25);
    let (samples, unique_n, pass_est) = coalesce_repeat_samples(&raw_samples, tol);

    let ext = Extent::from_samples(&samples, x_m, y_m);
    let (gw, gh, grid, counts) = build_grid(&samples, ext);
    let (resid, med, sigma) = residual_field(&grid, &counts);
    // UI ızgarası (gridValues/gridCoverage) ölçülen çözünürlükte kalsın —
    // enterpolasyon yalnızca analiz boru hattında kullanılır.
    let ui_resid = resid.clone();
    let ui_counts = counts.clone();
    // Geçişler arası interpolasyon: zayıf ekseni (geçiş aralığı) yoğunlaştır,
    // kalan iç boşlukları IDW ile doldur. Kontür doğruluğu artar. Yoğun
    // boyutlar yalnızca analizde kullanılır (gw_d/gh_d); sonuçtaki grid_w/h
    // ölçülen çözünürlükte kalır.
    let (gw_d, gh_d, resid, counts, interp_factor, _interp_filled) =
        interpolate_pass_gaps(&resid, &counts, gw, gh, ext.span_x(), ext.span_y());
    let blobs_raw = extract_blobs(&resid, &counts, gw_d, gh_d, sigma);
    let merge_d = (ext.span_x().min(ext.span_y()) * 0.28).clamp(0.35, 1.6);
    let blobs = merge_proximate_blobs(blobs_raw, &resid, gw_d, gh_d, ext, merge_d);

    let mut anomalies = Vec::new();
    let mut candidates = Vec::new();
    for (i, blob) in blobs.iter().enumerate() {
        let anomaly = blob_to_shape(blob, &resid, gw_d, gh_d, ext, sigma, false, params);
        anomalies.push(anomaly);
        if i < 10 && blob.max_abs >= sigma * 0.95 {
            let cand = blob_to_shape(blob, &resid, gw_d, gh_d, ext, sigma, true, params);
            candidates.push(cand);
        }
    }

    // Metal: güçlü pozitif bloblar (en fazla 5, örtüşmeyen)
    let mut metals = metals_from_positive_blobs(
        &blobs, &resid, &counts, &samples, ext, gw_d, gh_d, sigma, params,
    );
    if metals.is_empty() {
        if let Some(metal) =
            metal_from_peak_measured(&resid, &counts, &samples, ext, gw_d, gh_d, sigma, params)
        {
            metals.push(metal);
        }
    }

    // Kompakt invert: her metal için ayrı proxy (CAD değil)
    let mut invert_proxies = Vec::new();
    for metal in metals.iter() {
        if let Some(mut proxy) = super::invert::fit_compact_dipole(
            &ui_resid,
            &ui_counts,
            gw,
            gh,
            ext.x0,
            ext.y0,
            ext.span_x(),
            ext.span_y(),
            metal.cx,
            metal.cy,
            params.sensor_height_m,
        ) {
            proxy.detection_id = None; // JS cx/cy ile bağlar
            invert_proxies.push(proxy);
        }
    }

    let fingerprint = if let Some(m) = metals.first() {
        let zc = 0.5 * (m.depth_top_m + m.depth_bottom_m);
        let method = if m.depth_label.contains("dipole") {
            "dipole"
        } else if m.depth_label.contains("bipolar") {
            "bipolar"
        } else if m.depth_label.contains("peters") {
            "peters"
        } else {
            "est"
        };
        format!(
            "n{unique_n}|c({:.3},{:.3})|σ{:.2}|r{:.2}|z{zc:.2}|{method}|d{:.2}-{:.2}",
            m.cx, m.cy, m.peak_sigma, m.rx, m.depth_top_m, m.depth_bottom_m
        )
    } else {
        format!("n{unique_n}|nometal|med{med:.1}|sig{sigma:.1}")
    };

    let preview_w = 32u32.min(gw_d).max(4);
    let preview_h = 32u32.min(gh_d).max(4);
    let mut residual_preview = Vec::with_capacity((preview_w * preview_h) as usize);
    for py in 0..preview_h {
        for px in 0..preview_w {
            let gx =
                ((px as f32 / (preview_w - 1).max(1) as f32) * (gw_d - 1) as f32).round() as u32;
            let gy =
                ((py as f32 / (preview_h - 1).max(1) as f32) * (gh_d - 1) as f32).round() as u32;
            residual_preview.push(resid[(gy * gw_d + gx) as usize]);
        }
    }

    let scan_step_count = display_segments.len() as u32;
    let level_pass_count = level_segments.len() as u32;
    let interp_txt = if interp_factor > 1 {
        format!(" · IDW ×{interp_factor}")
    } else {
        String::new()
    };
    let pass_note = if has_json_passes && level_pass_count != scan_step_count {
        format!(" · leveling {level_pass_count} geçiş")
    } else {
        String::new()
    };
    let msg = format!(
        "Dik çekim · median-level · {raw_n}→{unique_n} · {scan_step_count} adım/geçiş{pass_note} · ~{pass_est} tekrar{interp_txt} · {} metal · {:.1}×{:.1} m · {fingerprint}",
        metals.len(),
        x_m,
        y_m
    );

    Ok(LegacyDikResult {
        ok: true,
        message: msg,
        view_mode: "top".into(),
        meta,
        point_count: samples.len(),
        grid_w: gw,
        grid_h: gh,
        map_size_m: x_m.max(y_m),
        map_depth_m: y_m,
        mag_median: med,
        mag_sigma: sigma,
        anomalies,
        candidates,
        metals,
        pass_estimate: pass_est,
        scan_step_count,
        scan_segment_count: scan_step_count,
        scan_steps,
        scan_step_input_m,
        scan_step_spacing_m,
        unique_points: unique_n,
        raw_point_count: raw_n,
        fingerprint,
        residual_preview,
        grid_values: ui_resid,
        grid_coverage: ui_counts,
        grid_origin_x_m: ext.x0,
        grid_origin_y_m: ext.y0,
        grid_width_m: ext.span_x(),
        grid_depth_m: ext.span_y(),
        invert_proxies,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::level::{cell_f64, zero_order_median_level_xy};

    fn mini_json() -> String {
        let rows: Vec<String> = (0..40)
            .map(|i| {
                let xm = if i < 20 { 0.0 } else { 2.0 };
                let ym = (i % 20) as f32 * 0.25;
                let bump = if (8..12).contains(&(i % 20)) {
                    200_000.0
                } else {
                    0.0
                };
                let b = 500_000.0 + bump;
                format!("[{},{},{},{},{},{}]", i as f32 * 0.1, b, b, b, xm, ym)
            })
            .collect();
        let data = rows.join(",");
        let scan = format!(
            "{{\"columns\":[\"time\",\"x\",\"y\",\"z\",\"x_coords\",\"y_coords\"],\"data\":[{data}],\"index\":[]}}"
        );
        let scan_escaped = serde_json::to_string(&scan).unwrap();
        format!(
            r#"{{
              "version":"1.0",
              "metadata":{{"device_code":"Legacy3DMagDevice","x_meters":4.0,"y_meters":5.0,"date":"2025-01-01"}},
              "scan":{scan_escaped},
              "segment_ranges":[[0,20],[20,40]]
            }}"#
        )
    }

    fn mini_json_rtl() -> String {
        // Yüksek X satırları önce — kayıt sırası sağdan; Adım 1 yine sol olmalı.
        let rows: Vec<String> = (0..40)
            .map(|i| {
                let xm = if i < 20 { 2.0 } else { 0.0 };
                let ym = (i % 20) as f32 * 0.25;
                let bump = if (8..12).contains(&(i % 20)) && xm < 1.0 {
                    200_000.0
                } else {
                    0.0
                };
                let b = 500_000.0 + bump;
                format!("[{},{},{},{},{},{}]", i as f32 * 0.1, b, b, b, xm, ym)
            })
            .collect();
        let data = rows.join(",");
        let scan = format!(
            "{{\"columns\":[\"time\",\"x\",\"y\",\"z\",\"x_coords\",\"y_coords\"],\"data\":[{data}],\"index\":[]}}"
        );
        let scan_escaped = serde_json::to_string(&scan).unwrap();
        format!(
            r#"{{
              "version":"1.0",
              "metadata":{{"device_code":"Legacy3DMagDevice","x_meters":4.0,"y_meters":5.0,"date":"2025-01-01"}},
              "scan":{scan_escaped},
              "segment_ranges":[[0,20],[20,40]]
            }}"#
        )
    }

    #[test]
    fn scan_steps_keep_source_physical_order() {
        let rtl = analyze_legacy_dik(&mini_json_rtl()).expect("analyze rtl");
        assert!(rtl.scan_steps.len() >= 2, "expected at least 2 steps");
        // Adım numarası koordinata göre değil, JSON içindeki fiziksel tarama sırasına göre.
        // Bu fixture sağdan sola kayıtlıdır; sıra korunmalı ve ilk nokta sağda kalmalıdır.
        assert!(
            rtl.scan_steps[0].x_center_m > rtl.scan_steps[rtl.scan_steps.len() - 1].x_center_m,
            "kaynak sırası korunmalı: first={:?} last={:?}",
            rtl.scan_steps[0].x_center_m,
            rtl.scan_steps[rtl.scan_steps.len() - 1].x_center_m
        );
        assert_eq!(rtl.scan_steps[0].index, 1);
        assert!(rtl.scan_steps[0].x_center_m > 1.0);
        // Bump yalnız sol geçişte; metal X ≈ 0.
        if let Some(m) = rtl.metals.first() {
            assert!(
                m.cx < 1.0,
                "metal should stay on left pass, got ({}, {})",
                m.cx,
                m.cy
            );
        }
    }

    #[test]
    fn detect_legacy_signature() {
        let j = mini_json();
        assert!(looks_like_legacy_dik(&j, Some("scan.json")));
        assert!(!looks_like_legacy_dik("x,y,z,magnetic\n1,2,3,4", Some("a.csv")));
        assert!(
            !looks_like_legacy_dik(r#"{"rows":[[1,2,3]],"hello":true}"#, Some("rows.json")),
            "rastgele rows JSON kabul edilmemeli"
        );
    }

    #[test]
    fn analyze_produces_shapes() {
        let r = analyze_legacy_dik(&mini_json()).expect("analyze");
        assert!(r.ok);
        assert_eq!(r.view_mode, "top");
        assert!(r.point_count >= 40);
        assert!(r.grid_w >= 4 && r.grid_h >= 8);
        assert!(
            !r.anomalies.is_empty() || !r.candidates.is_empty() || !r.metals.is_empty(),
            "expected at least one shape"
        );
        assert!(r.mag_sigma > 0.0);
        assert_eq!(r.grid_values.len(), (r.grid_w * r.grid_h) as usize);
        assert_eq!(r.grid_coverage.len(), (r.grid_w * r.grid_h) as usize);
        assert!(r.grid_coverage.iter().any(|count| *count > 0));
        assert!(r.grid_width_m > 0.0 && r.grid_depth_m > 0.0);
        for shape in r.anomalies.iter().chain(r.candidates.iter()).chain(r.metals.iter()) {
            assert!(shape.depth_fit_error.is_finite());
            assert!(shape.depth_uncertainty_m > 0.0);
            assert!(shape.depth_interval_low_m < shape.depth_interval_high_m);
            assert!(shape.depth_interval_low_m >= 0.08);
            assert!(shape.depth_interval_high_m <= 10.0);
            assert!(!shape.shape_type.is_empty());
            assert!(shape.shape_fit_error.is_finite());
            assert!((0.0..=1.0).contains(&shape.roundness));
            assert!(shape.width_m > 0.0 && shape.length_m > 0.0);
            assert!((0.0..=1.0).contains(&shape.shape_confidence));
        }
        if let Some(m) = r.metals.first() {
            // mini_json bump at x=0 line, y≈2–3
            assert!(
                m.cy > 1.0 && m.cy < 4.0,
                "metal center should follow bump, got ({}, {}) fp={}",
                m.cx,
                m.cy,
                r.fingerprint
            );
            assert!(
                m.rx < 1.2,
                "local radius should stay compact, got {}",
                m.rx
            );
        }
    }

    #[test]
    fn different_files_different_fingerprint() {
        let a = analyze_legacy_dik(&mini_json()).expect("a");
        // Tek segment, tepe açıkça (3.5, 4.0)
        let rows: Vec<String> = (0..30)
            .map(|i| {
                let xm = (i % 6) as f32 * 0.7;
                let ym = (i / 6) as f32 * 1.0;
                let bump = if (xm - 3.5).abs() < 0.4 && (ym - 4.0).abs() < 0.6 {
                    400_000.0
                } else {
                    0.0
                };
                let b = 500_000.0 + bump;
                format!("[{},{},{},{},{},{}]", i as f32 * 0.1, b, b, b, xm, ym)
            })
            .collect();
        let data = rows.join(",");
        let scan = format!(
            "{{\"columns\":[\"time\",\"x\",\"y\",\"z\",\"x_coords\",\"y_coords\"],\"data\":[{data}],\"index\":[]}}"
        );
        let scan_escaped = serde_json::to_string(&scan).unwrap();
        let j2 = format!(
            r#"{{"version":"1.0","metadata":{{"device_code":"Legacy3DMagDevice","x_meters":4.0,"y_meters":5.0}},"scan":{scan_escaped},"segment_ranges":[[0,30]]}}"#
        );
        let b = analyze_legacy_dik(&j2).expect("b");
        assert!(
            !a.fingerprint.contains("nometal"),
            "a should find metal: {}",
            a.fingerprint
        );
        assert!(
            !b.fingerprint.contains("nometal"),
            "b should find metal: {}",
            b.fingerprint
        );
        assert_ne!(
            a.fingerprint, b.fingerprint,
            "different anomaly locations must differ: {} vs {}",
            a.fingerprint, b.fingerprint
        );
        if let (Some(ma), Some(mb)) = (a.metals.first(), b.metals.first()) {
            assert!(
                (ma.cx - mb.cx).abs() > 0.4 || (ma.cy - mb.cy).abs() > 0.4,
                "centers should differ: ({},{}) vs ({},{})",
                ma.cx, ma.cy, mb.cx, mb.cy
            );
        }
    }

    #[test]
    fn manual_step_count_overrides_json_segments() {
        let result = analyze_legacy_dik_with_steps(&mini_json(), Some(4)).expect("analyze");
        assert_eq!(result.scan_step_count, 4);
        assert_eq!(result.scan_segment_count, 4);
        assert_eq!(result.scan_steps.len(), 4);
        assert!(result.scan_steps.iter().all(|step| step.point_count > 0));
        assert!(result.scan_step_spacing_m > 0.0);
        assert!(result.message.contains("4 adım/geçiş"));
        assert!(result.message.contains("leveling 2 geçiş"));
    }

    #[test]
    fn matrix_steps_do_not_change_metal_depth_when_json_passes_exist() {
        let auto = analyze_legacy_dik(&mini_json()).expect("auto");
        let matrix = analyze_legacy_dik_with_steps(&mini_json(), Some(8)).expect("matrix");
        assert_eq!(auto.scan_step_count, 2);
        assert_eq!(matrix.scan_step_count, 8);
        let (Some(a), Some(b)) = (auto.metals.first(), matrix.metals.first()) else {
            panic!("expected metal on both runs");
        };
        assert!(
            (a.depth_top_m - b.depth_top_m).abs() < 0.05
                && (a.depth_bottom_m - b.depth_bottom_m).abs() < 0.05,
            "depth drifted: auto {:.2}-{:.2} vs matrix {:.2}-{:.2}",
            a.depth_top_m,
            a.depth_bottom_m,
            b.depth_top_m,
            b.depth_bottom_m
        );
        assert_eq!(a.depth_method, b.depth_method);
    }

    #[test]
    fn bakir_tava_matrix_keeps_json_pass_depth() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("examples")
            .join("bakir_tava_6-3.json");
        if !path.is_file() {
            return;
        }
        let content = std::fs::read_to_string(&path).expect("read bakir");
        let auto = analyze_legacy_dik(&content).expect("auto");
        let matrix = analyze_legacy_dik_with_steps(&content, Some(18)).expect("6x3");
        assert_eq!(auto.scan_step_count, 3);
        assert_eq!(matrix.scan_step_count, 18);
        assert!(matrix.message.contains("leveling 3 geçiş"));
        let (Some(a), Some(b)) = (auto.metals.first(), matrix.metals.first()) else {
            panic!("expected metal");
        };
        let mid_a = 0.5 * (a.depth_top_m + a.depth_bottom_m);
        let mid_b = 0.5 * (b.depth_top_m + b.depth_bottom_m);
        assert!(
            (mid_a - mid_b).abs() < 0.08,
            "bakır depth drifted: auto {mid_a:.2} vs matrix {mid_b:.2}"
        );
        assert_eq!(a.depth_method, "bipolar");
        // Yumuşatılmış bipolar + 0.40 m cihaz ofseti (~2.9 m).
        assert!(
            (2.7..=3.5).contains(&mid_b),
            "expected softened+offset ~2.9 m bipolar depth, got {mid_b:.2}"
        );
        assert!(
            !auto.invert_proxies.is_empty(),
            "expected compact invert proxy on bakır"
        );
        let p = &auto.invert_proxies[0];
        assert_eq!(p.method, "compact-dipole");
        assert!(p.disclaimer.contains("CAD"));
        assert!(p.depth_m.is_finite() && p.depth_m > 0.2);
        assert!(p.misfit_rms.is_finite());
        assert!(p.polygon.len() >= 8);
    }

    #[test]
    fn depth_params_defaults_and_clamp() {
        let d = LegacyDepthParams::default();
        assert!((d.sensor_height_m - 0.50).abs() < 1e-6);
        assert!((d.bipolar_sep_factor - 1.85).abs() < 1e-6);
        assert!((d.dipole_blend - 0.30).abs() < 1e-6);
        let raw = serde_json::json!({});
        let parsed: LegacyDepthParams = serde_json::from_value(raw).expect("empty object");
        assert_eq!(parsed, LegacyDepthParams::default());
        let clamped = LegacyDepthParams {
            sensor_height_m: 9.0,
            bipolar_sep_factor: 0.1,
            dipole_blend: 2.0,
        }
        .clamped();
        assert!((clamped.sensor_height_m - 0.50).abs() < 1e-6);
        assert!((clamped.bipolar_sep_factor - 0.5).abs() < 1e-6);
        assert!((clamped.dipole_blend - 1.0).abs() < 1e-6);
    }

    #[test]
    fn bakir_sensor_height_is_fixed_at_half_meter() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("examples")
            .join("bakir_tava_6-3.json");
        if !path.is_file() {
            return;
        }
        let content = std::fs::read_to_string(&path).expect("read bakir");
        let with_h = analyze_legacy_dik_with_options(
            &content,
            None,
            None,
            LegacyDepthParams {
                sensor_height_m: 0.50,
                ..LegacyDepthParams::default()
            },
        )
        .expect("h=0.50");
        let without_h = analyze_legacy_dik_with_options(
            &content,
            None,
            None,
            LegacyDepthParams {
                sensor_height_m: 0.0,
                ..LegacyDepthParams::default()
            },
        )
        .expect("h=0 is clamped to 0.50");
        let (Some(a), Some(b)) = (with_h.metals.first(), without_h.metals.first()) else {
            panic!("expected metal");
        };
        let mid_a = 0.5 * (a.depth_top_m + a.depth_bottom_m);
        let mid_b = 0.5 * (b.depth_top_m + b.depth_bottom_m);
        let delta = mid_a - mid_b;
        assert!(
            delta.abs() < 0.001,
            "fixed 0.50 m boundary must ignore zero override: {mid_a:.3} vs {mid_b:.3}"
        );
    }

    #[test]
    fn manual_step_spacing_controls_analysis_segments() {
        let result = analyze_legacy_dik_with_step_spacing(&mini_json(), None, Some(1.0))
            .expect("analyze with spacing");
        assert!((result.scan_step_input_m - 1.0).abs() < 1e-6);
        assert_eq!(result.scan_step_count, 3);
        assert_eq!(result.scan_steps.len(), 3);
        assert!(result.scan_step_spacing_m > 0.0);
    }

    #[test]
    fn explicit_step_count_wins_over_spacing() {
        let result = analyze_legacy_dik_with_step_spacing(&mini_json(), Some(12), Some(1.0))
            .expect("analyze with explicit count");
        assert_eq!(result.scan_step_count, 12);
        assert_eq!(result.scan_segment_count, 12);
        assert_eq!(result.scan_steps.len(), 12);
        assert_eq!(result.scan_step_input_m, 0.0);
    }
    #[test]
    fn analyze_records_format_without_scan_wrapper() {
        let json = r#"{
          "metadata": {"deviceCode":"Legacy3DMagDevice", "xMeters":4.0, "yMeters":4.0},
          "columns": ["bx", "by", "bz", "pos_x", "pos_y"],
          "data": [
            {"bx":100,"by":100,"bz":100,"pos_x":0,"pos_y":0},
            {"bx":100,"by":100,"bz":100,"pos_x":0,"pos_y":1},
            {"bx":100,"by":100,"bz":100,"pos_x":1,"pos_y":0},
            {"bx":100,"by":100,"bz":100,"pos_x":1,"pos_y":1},
            {"bx":900,"by":900,"bz":900,"pos_x":0.5,"pos_y":0.5}
          ]
        }"#;
        let result = analyze_legacy_dik(json).expect("records format should analyze");
        assert!(result.ok);
        assert_eq!(result.point_count, 5);
        assert!(result.grid_width_m > 0.0 && result.grid_depth_m > 0.0);
    }

    #[test]
    fn analyze_split_format_with_numeric_rows() {
        let json = r#"{
          "meta": {"device": "Legacy3DMagDevice", "width_m": 3.0, "depth_m": 3.0},
          "columns": ["x", "y", "z", "x_coord", "y_coord"],
          "data": [[100,100,100,0,0],[100,100,100,0,1],[100,100,100,1,0],[100,100,100,1,1],[700,700,700,0.5,0.5]]
        }"#;
        let result = analyze_legacy_dik(json).expect("root split format should analyze");
        assert!(result.ok);
        assert_eq!(result.point_count, 5);
    }
    #[test]
    fn analyze_example_file_if_present() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("examples")
            .join("legacy_dik_sample.json");
        if !path.is_file() {
            return;
        }
        let content = std::fs::read_to_string(&path).expect("read sample");
        assert!(looks_like_legacy_dik(&content, Some("legacy_dik_sample.json")));
        let r = analyze_legacy_dik(&content).expect("analyze sample");
        assert!(r.ok);
        assert_eq!(r.meta.x_meters, 4.0);
        assert_eq!(r.meta.y_meters, 5.0);
        assert!(r.point_count >= 10);
    }

    #[test]
    fn analyze_golden_records_fixture() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("examples")
            .join("legacy_dik_records_fixture.json");
        let content = std::fs::read_to_string(&path).expect("records fixture");
        assert!(looks_like_legacy_dik(&content, Some("legacy_dik_records_fixture.json")));
        let r = analyze_legacy_dik(&content).expect("analyze records fixture");
        assert!(r.ok);
        assert_eq!(r.point_count, 8);
    }

    #[test]
    fn analyze_golden_root_split_fixture() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("examples")
            .join("legacy_dik_root_split_fixture.json");
        let content = std::fs::read_to_string(&path).expect("root split fixture");
        assert!(looks_like_legacy_dik(&content, Some("legacy_dik_root_split_fixture.json")));
        let r = analyze_legacy_dik(&content).expect("analyze root split fixture");
        assert!(r.ok);
        assert_eq!(r.point_count, 8);
    }

    #[test]
    fn ambiguous_magnetic_position_columns_error() {
        // Bx yok; x hem manyetik hem konum olarak çözülmeye çalışılırsa çakışma.
        // Burada x_coords yok ve bx yok → konum hatası (çakışmadan önce).
        let json = r#"{
          "metadata": {"device_code":"Legacy3DMagDevice","x_meters":2.0,"y_meters":2.0},
          "columns": ["x","y","z"],
          "data": [[1,1,1],[2,2,2]]
        }"#;
        let err = analyze_legacy_dik(json).expect_err("konum kolonu olmadan hata");
        assert!(err.contains("konum"), "got: {err}");
    }

    #[test]
    fn shape_classifier_recognizes_circle_rectangle_and_irregular() {
        let circle = classify_shape(
            &[
                [0.5, 0.0], [0.85, 0.15], [1.0, 0.5], [0.85, 0.85],
                [0.5, 1.0], [0.15, 0.85], [0.0, 0.5], [0.15, 0.15],
            ],
            1.0,
            1.0,
            "anomaly",
            false,
            None,
        );
        assert_eq!(circle.shape_type, "circle");
        assert!(circle.roundness > 0.75);

        let rectangle = classify_shape(
            &[[0.0, 0.0], [1.0, 0.0], [1.0, 0.4], [0.0, 0.4]],
            2.0,
            0.8,
            "anomaly",
            false,
            None,
        );
        assert_eq!(rectangle.shape_type, "rectangle");
        assert!(rectangle.aspect_ratio > 2.0);

        let irregular = classify_shape(
            &[[0.0, 0.0], [0.8, 0.1], [0.55, 0.45], [1.0, 0.8], [0.2, 1.0], [0.0, 0.5]],
            1.0,
            1.0,
            "anomaly",
            false,
            None,
        );
        assert!(matches!(irregular.shape_type, "polygon" | "irregular"));
        assert!(irregular.fit_error >= 0.0);
    }

    #[test]
    fn degenerate_contour_falls_back_to_fitted_shape() {
        // Tek hücre genişliğindeki blob → doğrusal (sıfır alanlı) kontür.
        // Eskiden bu, her anomaliyi "irregular + RMS 1.00 + %4" tabanına düşürüyordu.
        let collinear = classify_shape(
            &[[0.0, 0.5], [0.5, 0.5], [1.0, 0.5]],
            0.6,  // rx → width 1.2
            0.35, // ry → length 0.7 → aspect ~1.71
            "anomaly",
            false,
            None,
        );
        assert_eq!(collinear.shape_type, "ellipse");
        assert_eq!(collinear.source, "inferred");
        assert!(collinear.fit_error < 0.45);
        assert!(collinear.confidence > 0.30);

        // 2 noktalı kontür + yuvarlak rx/ry → tahmini daire.
        let two_point = classify_shape(&[[0.2, 0.2], [0.8, 0.8]], 0.5, 0.5, "anomaly", false, None);
        assert_eq!(two_point.shape_type, "circle");
        assert_eq!(two_point.source, "inferred");

        // Uzun ince dejenere kontür → tahmini kapsül.
        let thin = classify_shape(
            &[[0.0, 0.5], [0.4, 0.5], [0.8, 0.5]],
            1.2,  // width 2.4
            0.25, // length 0.5 → aspect 4.8
            "anomaly",
            false,
            None,
        );
        assert_eq!(thin.shape_type, "capsule");
        assert_eq!(thin.source, "inferred");
    }

    #[test]
    fn upsample_catmull_rom_preserves_flat_and_linear() {
        let flat = vec![3.0f32; 5];
        let up = upsample_catmull_rom(&flat, 5, 4);
        assert_eq!(up.len(), 17);
        assert!(up.iter().all(|&v| (v - 3.0).abs() < 1e-5));

        // Lineer veri Catmull-Rom altında birebir doğrusal kalmalı (iç bölge);
        // uç örneklemede p0/p3 kenetlenmesi t=1'de bile knot değerini verir.
        let lin: Vec<f32> = (0..5).map(|i| i as f32 * 2.0).collect();
        let up = upsample_catmull_rom(&lin, 5, 4);
        for i in 4..=12 {
            let expect = i as f32 * 0.5;
            assert!((up[i] - expect).abs() < 1e-4, "i={i} v={} expect={expect}", up[i]);
        }
        // Uçlar tam knot değerlerinde kalmalı.
        assert!((up[0] - 0.0).abs() < 1e-5 && (up[16] - 8.0).abs() < 1e-5);
        // Monotonik kalmalı.
        assert!(up.windows(2).all(|w| w[0] <= w[1] + 1e-6));
    }

    #[test]
    fn marching_squares_finds_closed_loop_on_gaussian() {
        let n = 33usize;
        let mut field = vec![0.0f32; n * n];
        let (cx, cy, r0) = (16.0f32, 16.0f32, 6.0f32);
        for y in 0..n {
            for x in 0..n {
                let d2 = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)) / (r0 * r0);
                field[y * n + x] = 10.0 * (-0.5 * d2).exp();
            }
        }
        let iso = 10.0 * (-0.5f32).exp(); // tam r0 yarıçapındaki eşdeğer halka
        let loop_pts = marching_squares_largest_loop(&field, n, n, iso)
            .expect("kapalı kontür bulunmalı");
        assert!(loop_pts.len() >= 12, "nokta sayısı={}", loop_pts.len());
        let (area, perim) = polygon_area_perimeter(&loop_pts);
        let expect_area = std::f32::consts::PI * r0 * r0;
        assert!(
            (area - expect_area).abs() / expect_area < 0.15,
            "alan={area} beklenen={expect_area}"
        );
        assert!(perim > 0.0);
        // Kapalı döngü: son nokta ilk noktaya eşit olmalı.
        let first = loop_pts[0];
        let last = loop_pts[loop_pts.len() - 1];
        assert!((first[0] - last[0]).hypot(first[1] - last[1]) < 1e-4);
    }

    #[test]
    fn ms_blob_outline_survives_single_cell_wide_blob() {
        // Orijinal hata: 1 hücre genişliğindeki blob 2-4 noktalı doğrusal kontür
        // üretiyordu (alan 0) → her şey "Düzensiz %4". Artık gerçek kapalı
        // kontür dönmeli ve sınıflandırma ölçüme dayanmalı.
        let (gw, gh) = (24u32, 24u32);
        let mut resid = vec![0.0f32; (gw * gh) as usize];
        let mut cells = Vec::new();
        for y in 7..=17u32 {
            let gx = 12u32;
            let v = 10.0 - (y as f32 - 12.0).abs() * 1.5;
            resid[(y * gw + gx) as usize] = v.max(0.5);
            cells.push((gx, y));
        }
        let blob = Blob {
            cells,
            sum_a: 0.0,
            max_abs: 10.0,
            polarity: 1.0,
        };
        let poly = ms_blob_outline(&blob, &resid, gw, gh, 10.0 * 0.70);
        assert!(poly.len() >= 4, "kontür çok kısa: {}", poly.len());
        let (area, perim) = polygon_area_perimeter(&poly);
        assert!(area > 0.0, "tek hücre genişliği blob alanı 0 kaldı");
        assert!(perim > 0.0);

        let fit = classify_shape(&poly, 0.3, 1.2, "anomaly", false, None);
        assert_ne!(fit.source, "inferred");
        assert!(fit.fit_error < 1.0);
    }

    #[test]
    fn weighted_moment_ellipse_recovers_axis_ratio() {
        let (gw, gh) = (30u32, 30u32);
        let ext = Extent {
            x0: 0.0,
            x1: 30.0,
            y0: 0.0,
            y1: 30.0,
        };
        let mut resid = vec![0.0f32; (gw * gh) as usize];
        let mut cells = Vec::new();
        for y in 0..gh {
            for x in 0..gw {
                let dx = (x as f32 - 15.0) / 4.0;
                let dy = (y as f32 - 15.0) / 1.5;
                let v = 10.0 * (-0.5 * (dx * dx + dy * dy)).exp();
                if v > 0.05 {
                    resid[(y * gw + x) as usize] = v;
                    cells.push((x, y));
                }
            }
        }
        let blob = Blob {
            cells,
            sum_a: 0.0,
            max_abs: 10.0,
            polarity: 1.0,
        };
        let me = weighted_moment_ellipse(&blob, &resid, gw, gh, ext).expect("elips");
        let aspect = me.a / me.b.max(1e-6);
        let expect = 4.0 / 1.5;
        assert!(
            (aspect - expect).abs() / expect < 0.2,
            "aspect={aspect} beklenen~{expect}"
        );
    }

    #[test]
    fn contour_rms_to_ellipse_near_zero_for_exact_ellipse() {
        let ext = Extent {
            x0: 0.0,
            x1: 10.0,
            y0: 0.0,
            y1: 10.0,
        };
        let me = MomentEllipse {
            cx: 5.0,
            cy: 5.0,
            a: 2.0,
            b: 1.0,
            angle_rad: 0.6,
        };
        let poly: Vec<[f32; 2]> = (0..48)
            .map(|i| {
                let phi = i as f32 / 48.0 * std::f32::consts::TAU;
                let u = me.a * phi.cos();
                let v = me.b * phi.sin();
                let px = me.cx + u * me.angle_rad.cos() - v * me.angle_rad.sin();
                let py = me.cy + u * me.angle_rad.sin() + v * me.angle_rad.cos();
                [px / ext.span_x(), py / ext.span_y()]
            })
            .collect();
        let rms = contour_rms_to_ellipse(&poly, ext, &me).expect("rms");
        assert!(rms < 0.02, "rms={rms}");
    }

    /// Şekil Motoru v2 görsel doğrulama fikstürü: sentetik düşük çözünürlüklü
    /// taramayı gerçek boru hattından (residual_field → extract_blobs →
    /// blob_to_shape/ms_blob_outline → classify_shape) geçirip poligonları
    /// `dev/contour-fixture.js` dosyasına yazar. `dev/contour-verify.html`
    /// bu fikstürü 2D haritada çizer (kontür kalitesi göz denetimi).
    #[test]
    fn dump_contour_verification_fixture() {
        let gw: u32 = 120;
        let gh: u32 = 56;
        let spacing = 0.5f32;
        let n = (gw * gh) as usize;
        let mut grid = vec![0.0f32; n];
        let counts = vec![1u32; n];
        // Deterministik hafif gürültü (sigma 0 olsun diye) — LCG
        let mut seed = 0x2545F4914F6CDD1Du64;
        let mut noise = || {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((seed >> 33) as f32 / u32::MAX as f32 - 0.5) * 1.4
        };
        let peak = |gx: f32, gy: f32, cx: f32, cy: f32, sx: f32, sy: f32, amp: f32| {
            let dx = (gx - cx) / sx;
            let dy = (gy - cy) / sy;
            amp * (-0.5 * (dx * dx + dy * dy)).exp()
        };
        for gy in 0..gh {
            for gx in 0..gw {
                let (x, y) = (gx as f32, gy as f32);
                // A: izole yuvarlak tepe (1-3 hücre — kullanıcının düşük çöz.
                // vakası)
                let a = peak(x, y, 18.0, 28.0, 1.1, 1.1, 9.0);
                // B: 1 hücre genişliğinde dikey hat (orijinal bug vakası)
                let b = peak(x, y, 45.0, 28.0, 0.35, 2.4, 8.0);
                // C: yumuşak kenarlı plato (dikdörtgen adayı)
                let c = 6.0 * (-0.5 * ((x - 78.0) / 5.0).powi(2).max(0.0)).exp()
                    * (-0.5 * ((y - 16.0) / 2.5).powi(2).max(0.0)).exp();
                // D: yatay sırt (kapsül adayı)
                let d = peak(x, y, 96.0, 44.0, 6.5, 0.9, 7.0);
                grid[(gy * gw + gx) as usize] = a + b + c + d + noise();
            }
        }
        let ext = Extent {
            x0: 0.0,
            x1: (gw - 1) as f32 * spacing,
            y0: 0.0,
            y1: (gh - 1) as f32 * spacing,
        };
        let (resid, med, sigma) = residual_field(&grid, &counts);
        let blobs = extract_blobs(&resid, &counts, gw, gh, sigma);
        assert!(!blobs.is_empty(), "sentetik taramada blob bulunamadı");

        let mut anomalies_json = Vec::new();
        let mut saw_strong = 0usize;
        for blob in &blobs {
            let s = blob_to_shape(blob, &resid, gw, gh, ext, sigma, false, LegacyDepthParams::default());
            if s.strength >= 3.0 {
                saw_strong += 1;
                let (area_norm, _) = polygon_area_perimeter(&s.polygon);
                assert!(
                    s.polygon.len() >= 8,
                    "{} kontürü çok kısa: {} nokta",
                    s.label,
                    s.polygon.len()
                );
                assert!(
                    area_norm > 1e-6,
                    "{} kontür alanı sıfır (dejenere kaldı)",
                    s.label
                );
                assert_eq!(s.shape_source, "grid-contour");
            }
            anomalies_json.push(serde_json::json!({
                "label": s.label,
                "kind": s.kind,
                "cx": s.cx,
                "cy": s.cy,
                "rx": s.rx,
                "ry": s.ry,
                "strength": s.strength,
                "polarity": s.polarity,
                "shapeType": s.shape_type,
                "source": s.shape_source,
                "fitError": s.shape_fit_error,
                "confidence": s.shape_confidence,
                "roundness": s.roundness,
                "aspectRatio": s.aspect_ratio,
                "polygon": s.polygon,
                "corePolygon": s.core_polygon,
                "templateKind": s.template_kind,
                "templateScore": s.template_score,
                "templateScores": s.template_scores,
            }));
        }
        assert!(saw_strong >= 3, "beklenen güçlü anomaliler: {saw_strong}");

        let fixture = serde_json::json!({
            "grid": {
                "w": gw,
                "h": gh,
                "spacingM": spacing,
                "sigma": sigma,
                "median": med,
                "values": resid,
            },
            "anomalies": anomalies_json,
        });
        let dev_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("dev");
        let _ = std::fs::create_dir_all(&dev_dir);
        let json_str = serde_json::to_string(&fixture).expect("fixture json");
        let js = format!("window.CONTOUR_FIXTURE = {};\n", json_str);
        let path = dev_dir.join("contour-fixture.js");
        std::fs::write(&path, js).expect("fixture dosyası yazılamadı");
        // Preview sunucuları komşu dosyaları servis etmediği için fikstürü
        // HTML'in içine gömen bağımsız sayfa da üret.
        let template_path = dev_dir.join("contour-verify.html");
        if let Ok(template) = std::fs::read_to_string(&template_path) {
            let marker = r#"<script src="./contour-fixture.js"></script>"#;
            let inline = format!(
                r#"<script>window.CONTOUR_FIXTURE = {};</script>"#,
                json_str
            );
            let standalone = dev_dir.join("contour-verify-standalone.html");
            let _ = std::fs::write(&standalone, template.replace(marker, &inline));
            println!("doğrulama sayfası → {}", standalone.display());
        }
        println!("fixture → {}", path.display());
    }

    #[test]
    fn interpolate_pass_gaps_densifies_weak_axis_and_preserves_positions() {
        // 8 sütun × 5 satır; x hücre 0.5 m, y hücre 2.0 m → y zayıf eksen, k=4.
        // Alan ızgara indekslerinde lineer: v = gx + 10·gy → enterpolasyon tam.
        let (gw, gh) = (8u32, 5u32);
        let span_x = (gw - 1) as f32 * 0.5;
        let span_y = (gh - 1) as f32 * 2.0;
        let resid: Vec<f32> = (0..(gw * gh) as usize)
            .map(|i| {
                let gx = (i % gw as usize) as f32;
                let gy = (i / gw as usize) as f32;
                gx + 10.0 * gy
            })
            .collect();
        let counts = vec![1u32; (gw * gh) as usize];
        let (gw2, gh2, r2, c2, k, filled) =
            interpolate_pass_gaps(&resid, &counts, gw, gh, span_x, span_y);
        assert_eq!(k, 4, "geçiş aralığı/adım oranı 4 → k=4");
        assert_eq!(gw2, gw);
        assert_eq!(gh2 as usize, 4 * (gh as usize - 1) + 1);
        assert_eq!(filled, 0, "delik yokken doldurma olmamalı");
        for y2 in 0..gh2 as usize {
            for x2 in 0..gw2 as usize {
                let v = r2[y2 * gw2 as usize + x2];
                let expect = x2 as f32 + 10.0 * (y2 as f32 / k as f32);
                assert!((v - expect).abs() < 1e-4, "({x2},{y2}) v={v} expect={expect}");
                assert!(c2[y2 * gw2 as usize + x2] > 0);
            }
        }
    }

    #[test]
    fn interpolate_pass_gaps_fills_interior_holes_with_idw() {
        // Tekdüzen ızgara (yoğunlaştırma yok) — merkez hücre boş → IDW doldurur.
        let (gw, gh) = (9u32, 9u32);
        let span = 8.0f32;
        let mut resid = vec![10.0f32; (gw * gh) as usize];
        let mut counts = vec![1u32; (gw * gh) as usize];
        let center = 4 * gw as usize + 4;
        resid[center] = 0.0;
        counts[center] = 0;
        let (gw2, gh2, r2, c2, k, filled) =
            interpolate_pass_gaps(&resid, &counts, gw, gh, span, span);
        assert_eq!(k, 0, "simetrik ızgarada yoğunlaştırma olmamalı");
        assert_eq!(gw2, gw);
        assert_eq!(gh2, gh);
        assert_eq!(filled, 1);
        assert!((r2[center] - 10.0).abs() < 1e-3, "merkez={}", r2[center]);
        assert_eq!(c2[center], 1);
    }

    #[test]
    fn legacy_shape_defaults_deserialize_old_archive() {
        let raw = r#"{
            "kind":"anomaly","label":"old","cx":1.0,"cy":2.0,"rx":0.4,"ry":0.6,
            "polarity":1.0,"strength":2.0,"confidence":0.5,"depthTopM":0.5,"depthBottomM":1.5
        }"#;
        let shape: LegacyShape = serde_json::from_str(raw).expect("old shape");
        assert_eq!(shape.shape_type, "irregular");
        assert_eq!(shape.shape_fit_error, 1.0);
        assert!(shape.polygon.is_empty());
    }

    #[test]
    fn median_f64_even_odd() {
        assert!((median_f64(&[3.0, 1.0, 2.0]) - 2.0).abs() < 1e-12);
        assert!((median_f64(&[4.0, 1.0, 2.0, 3.0]) - 2.5).abs() < 1e-12);
        assert_eq!(median_f64(&[]), 0.0);
    }

    #[test]
    fn zero_order_leveling_removes_line_bias() {
        // Line A: Bx~100, Line B: Bx~1100 (heading stripe) — same true residual pattern
        let mut data: Vec<Vec<serde_json::Value>> = (0..20)
            .map(|i| {
                let bias = if i < 10 { 100.0 } else { 1100.0 };
                let anomaly = if i == 5 || i == 15 { 50.0 } else { 0.0 };
                serde_json::json!([i as f64 * 0.1, bias + anomaly, bias, 500.0, 0.0, i as f64])
                    .as_array()
                    .unwrap()
                    .clone()
            })
            .collect();
        let stats =
            zero_order_median_level_xy(&mut data, 1, 2, &[[0, 10], [10, 20]]).expect("level");
        assert!((stats.reference_median_x - 100.0).abs() < 1e-6);
        // Second line medians should now match first (~100)
        let mut line2_x: Vec<f64> = data[10..20]
            .iter()
            .map(|r| cell_f64(&r[1]).unwrap())
            .collect();
        // Exclude anomaly at i=15 for median check of background
        line2_x.remove(5);
        let m2 = median_f64(&line2_x);
        assert!(
            (m2 - 100.0).abs() < 1e-6,
            "leveled line2 median {m2} should match ref 100"
        );
        // z untouched
        assert!((cell_f64(&data[0][3]).unwrap() - 500.0).abs() < 1e-9);
        // anomaly preserved relative to line
        let a0 = cell_f64(&data[5][1]).unwrap() - 100.0;
        let a1 = cell_f64(&data[15][1]).unwrap() - 100.0;
        assert!((a0 - 50.0).abs() < 1e-6);
        assert!((a1 - 50.0).abs() < 1e-6);
    }

    #[test]
    fn level_command_roundtrip() {
        let r = level_legacy_mag_json(&mini_json()).expect("level");
        assert!(r.ok);
        assert_eq!(r.data.len(), 40);
        assert!(r.stats.segment_count >= 2);
        assert!(!r.leveled_json.is_empty());
        let again = analyze_legacy_dik(&r.leveled_json).expect("re-analyze");
        assert!(again.ok);
    }

    #[test]
    fn dipole_depth_recovers_known_z() {
        // Sentetik dikey-dipol: z=1.5 m, A=1 — residual ≈ A·g(ρ,z)
        let z_true = 1.5f32;
        let a = 8.0e4f32;
        let mut pts = Vec::new();
        for i in 0..24 {
            let rho = i as f32 * 0.12;
            let f = a * dipole_kernel(rho, z_true);
            if f > 0.0 {
                pts.push((rho, f));
            }
        }
        // half-width ≈ 0.766·z → rh ≈ 1.15
        let est = estimate_depth_dipole(&pts, 1.15);
        assert_eq!(est.method, "dipole");
        assert!(
            (est.center_m - z_true).abs() / z_true < 0.2,
            "recovered z={} vs true {z_true} (rms={})",
            est.center_m,
            est.rms
        );
        assert!(est.rms < 0.2);
        assert!(est.uncertainty_m > 0.0);
        assert!(est.interval_low_m < z_true && est.interval_high_m > z_true);
        assert!(est.fit_samples >= 5);
    }

    #[test]
    fn peters_fallback_when_too_few_points() {
        let est = estimate_depth_dipole(&[(0.0, 10.0)], 0.766);
        assert_eq!(est.method, "peters");
        assert!((est.center_m - 1.0).abs() < 0.15);
        assert_eq!(est.rms, 1.0);
        assert!(est.uncertainty_m >= 0.35);
        assert!(est.interval_low_m < est.center_m && est.interval_high_m > est.center_m);
        assert_eq!(est.fit_samples, 0);
    }

    #[test]
    fn depth_quality_fields_survive_json_roundtrip() {
        let result = analyze_legacy_dik(&mini_json()).expect("analyze");
        let metal = result.metals.first().expect("synthetic metal");
        let encoded = serde_json::to_string(metal).expect("serialize shape");
        assert!(encoded.contains("depthFitError"));
        assert!(encoded.contains("depthIntervalLowM"));
        assert!(encoded.contains("depthIntervalHighM"));
        let decoded: LegacyShape = serde_json::from_str(&encoded).expect("deserialize shape");
        assert_eq!(decoded.depth_method, metal.depth_method);
        assert!((decoded.depth_fit_error - metal.depth_fit_error).abs() < 1e-6);
        assert!((decoded.depth_interval_low_m - metal.depth_interval_low_m).abs() < 1e-6);
        assert!((decoded.depth_interval_high_m - metal.depth_interval_high_m).abs() < 1e-6);
    }

    #[test]
    fn magnitude_and_residual() {
        let samples = vec![
            Sample {
                x_m: 0.0,
                y_m: 0.0,
                bx: 3.0,
                by: 4.0,
                bz: 0.0,
            },
            Sample {
                x_m: 1.0,
                y_m: 0.0,
                bx: 0.0,
                by: 0.0,
                bz: 10.0,
            },
        ];
        assert!((magnitude(&samples[0]) - 5.0).abs() < 1e-5);
        let (_gw, _gh, grid, counts) = build_grid(&samples, Extent::from_samples(&samples, 4.0, 5.0));
        let (resid, _med, sig) = residual_field(&grid, &counts);
        assert_eq!(resid.len(), grid.len());
        assert!(sig >= 1.0);
    }
}
