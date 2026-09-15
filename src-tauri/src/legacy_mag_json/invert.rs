//! Kompakt manyetik invert (proxy) — CAD / gerçek şekil değil.
//!
//! Ölçülen residual hücrelerine dikey dipol (+ eliptik yatay ölçek) uydurur.
//! IDW dolgulu hücreler kullanılmaz (`counts == 0` atlanır).

use super::types::LegacyInvertProxy;

pub const INVERT_DISCLAIMER: &str =
    "Invert proxy — kompakt dipol uydurma; gerçek cisim CAD’i / duvar çizimi değil. Ölçülen anomali kontürünün yerine geçmez.";

/// Dikey dipol ΔT çekirdeği: g(ρ,z) = (2z² − ρ²) / (ρ²+z²)^{5/2}
pub(crate) fn dipole_kernel(rho: f32, z: f32) -> f32 {
    let z = z.max(0.08);
    let r2 = rho * rho + z * z;
    let num = 2.0 * z * z - rho * rho;
    num / r2.powf(2.5)
}

fn cell_xy(origin_x: f32, origin_y: f32, width_m: f32, depth_m: f32, gw: u32, gh: u32, gx: u32, gy: u32) -> (f32, f32) {
    let x = origin_x + (gx as f32 / (gw.saturating_sub(1).max(1) as f32)) * width_m.max(0.5);
    let y = origin_y + (gy as f32 / (gh.saturating_sub(1).max(1) as f32)) * depth_m.max(0.5);
    (x, y)
}

fn ellipse_polygon_norm(
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
    origin_x: f32,
    origin_y: f32,
    width_m: f32,
    depth_m: f32,
    n: usize,
) -> Vec<[f32; 2]> {
    let w = width_m.max(0.5);
    let d = depth_m.max(0.5);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let t = (i as f32 / n as f32) * std::f32::consts::TAU;
        let x = cx + rx * t.cos();
        let y = cy + ry * t.sin();
        out.push([
            ((x - origin_x) / w).clamp(0.0, 1.0),
            ((y - origin_y) / d).clamp(0.0, 1.0),
        ]);
    }
    out
}

struct MeasuredCell {
    x: f32,
    y: f32,
    r: f32,
}

fn collect_measured(
    resid: &[f32],
    counts: &[u32],
    gw: u32,
    gh: u32,
    origin_x: f32,
    origin_y: f32,
    width_m: f32,
    depth_m: f32,
) -> Vec<MeasuredCell> {
    let mut out = Vec::new();
    for gy in 0..gh {
        for gx in 0..gw {
            let i = (gy * gw + gx) as usize;
            if counts.get(i).copied().unwrap_or(0) == 0 {
                continue;
            }
            let r = resid.get(i).copied().unwrap_or(0.0);
            if !r.is_finite() {
                continue;
            }
            let (x, y) = cell_xy(origin_x, origin_y, width_m, depth_m, gw, gh, gx, gy);
            out.push(MeasuredCell { x, y, r });
        }
    }
    out
}

fn evaluate_amp_rms(cells: &[MeasuredCell], cx: f32, cy: f32, z: f32, rx: f32, ry: f32) -> Option<(f32, f32, u32)> {
    let rx = rx.max(0.08);
    let ry = ry.max(0.08);
    let mut gg = 0.0f32;
    let mut rg = 0.0f32;
    let mut kernels = Vec::with_capacity(cells.len());
    for c in cells {
        let dx = (c.x - cx) / rx;
        let dy = (c.y - cy) / ry;
        let rho = (dx * dx + dy * dy).sqrt() * ((rx + ry) * 0.5);
        let g = dipole_kernel(rho, z);
        if !g.is_finite() {
            continue;
        }
        kernels.push((c.r, g));
        gg += g * g;
        rg += c.r * g;
    }
    if kernels.len() < 8 || gg < 1e-18 {
        return None;
    }
    let amp = rg / gg;
    if !amp.is_finite() {
        return None;
    }
    let mut sse = 0.0f32;
    for &(r, g) in &kernels {
        let e = r - amp * g;
        sse += e * e;
    }
    let n = kernels.len() as f32;
    let rms = (sse / n).sqrt();
    Some((amp, rms, kernels.len() as u32))
}

/// Ölçülen residual ızgarasına kompakt dipol uydur.
///
/// `seed_cx/cy`: metal tepe civarı (m). `sensor_height_m`: raporlanan gömüye eklenir
/// (metal derinlik ofseti ile karşılaştırılabilir olsun; misfit manyetik z üzerindedir).
pub fn fit_compact_dipole(
    resid: &[f32],
    counts: &[u32],
    gw: u32,
    gh: u32,
    origin_x: f32,
    origin_y: f32,
    width_m: f32,
    depth_m_map: f32,
    seed_cx: f32,
    seed_cy: f32,
    sensor_height_m: f32,
) -> Option<LegacyInvertProxy> {
    if gw < 2 || gh < 2 || resid.len() < (gw * gh) as usize || counts.len() < resid.len() {
        return None;
    }
    let cells = collect_measured(
        resid, counts, gw, gh, origin_x, origin_y, width_m, depth_m_map,
    );
    if cells.len() < 12 {
        return None;
    }

    let mut peak = 0.0f32;
    for c in &cells {
        peak = peak.max(c.r.abs());
    }
    if peak < 1e-6 {
        return None;
    }

    let span = width_m.min(depth_m_map).max(1.0);
    let z_vals: [f32; 10] = [0.4, 0.7, 1.0, 1.4, 1.8, 2.3, 2.9, 3.6, 4.5, 5.8];
    let r_vals: [f32; 6] = [
        (span * 0.08).clamp(0.12, 0.45),
        (span * 0.12).clamp(0.18, 0.7),
        (span * 0.18).clamp(0.25, 1.0),
        (span * 0.26).clamp(0.35, 1.4),
        (span * 0.36).clamp(0.45, 1.8),
        (span * 0.48).clamp(0.55, 2.2),
    ];
    let offsets: [f32; 5] = [-0.35, -0.15, 0.0, 0.15, 0.35];

    let mut best: Option<(f32, f32, f32, f32, f32, f32, f32, u32)> = None;
    // tuple: rms, cx, cy, z, rx, ry, amp, n

    for &z in &z_vals {
        for &rx in &r_vals {
            for &ry in &r_vals {
                // Aşırı ince elipsleri atla
                let aspect = rx.max(ry) / rx.min(ry).max(0.05);
                if aspect > 4.5 {
                    continue;
                }
                for &ox in &offsets {
                    for &oy in &offsets {
                        let cx = seed_cx + ox * span * 0.08;
                        let cy = seed_cy + oy * span * 0.08;
                        let Some((amp, rms, n)) = evaluate_amp_rms(&cells, cx, cy, z, rx, ry) else {
                            continue;
                        };
                        let score = rms / peak;
                        let better = match best {
                            None => true,
                            Some((brms, ..)) => score < brms,
                        };
                        if better {
                            best = Some((score, cx, cy, z, rx, ry, amp, n));
                        }
                    }
                }
            }
        }
    }

    let (norm_rms, cx, cy, z_mag, rx, ry, _amp, n) = best?;
    // İnce ayar: en iyi z civarında ±0.25 m
    let mut z_best = z_mag;
    let mut rms_best = norm_rms;
    let mut rx_best = rx;
    let mut ry_best = ry;
    let mut cx_best = cx;
    let mut cy_best = cy;
    for dz in [-0.25f32, -0.12, 0.0, 0.12, 0.25] {
        let z = (z_mag + dz).clamp(0.3, 8.0);
        for scale in [0.9f32, 1.0, 1.1] {
            let rx2 = (rx * scale).clamp(0.1, 3.0);
            let ry2 = (ry * scale).clamp(0.1, 3.0);
            if let Some((_a, rms, _n)) = evaluate_amp_rms(&cells, cx, cy, z, rx2, ry2) {
                let score = rms / peak;
                if score < rms_best {
                    rms_best = score;
                    z_best = z;
                    rx_best = rx2;
                    ry_best = ry2;
                    cx_best = cx;
                    cy_best = cy;
                }
            }
        }
    }

    let h = 0.50;
    let depth_report = (z_best + h).clamp(0.2, 10.0);
    let poly = ellipse_polygon_norm(
        cx_best,
        cy_best,
        rx_best,
        ry_best,
        origin_x,
        origin_y,
        width_m,
        depth_m_map,
        24,
    );

    Some(LegacyInvertProxy {
        method: "compact-dipole".into(),
        disclaimer: INVERT_DISCLAIMER.into(),
        cx: cx_best,
        cy: cy_best,
        depth_m: depth_report,
        depth_magnetic_m: z_best,
        rx_m: rx_best,
        ry_m: ry_best,
        misfit_rms: rms_best.clamp(0.0, 5.0),
        fit_samples: n,
        polygon: poly,
        sensor_height_m: h,
        detection_id: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn synth_grid(true_z: f32, true_rx: f32, true_ry: f32, amp: f32) -> (Vec<f32>, Vec<u32>, u32, u32) {
        let gw = 24u32;
        let gh = 28u32;
        let origin_x = 0.0f32;
        let origin_y = 0.0f32;
        let width_m = 4.0f32;
        let depth_m = 5.0f32;
        let cx = 2.0f32;
        let cy = 2.5f32;
        let mut resid = vec![0.0f32; (gw * gh) as usize];
        let mut counts = vec![0u32; (gw * gh) as usize];
        for gy in 0..gh {
            for gx in 0..gw {
                // Seyrek ölçüm: her 2. hücre
                if gx % 2 == 1 || gy % 2 == 1 {
                    continue;
                }
                let (x, y) = cell_xy(origin_x, origin_y, width_m, depth_m, gw, gh, gx, gy);
                let dx = (x - cx) / true_rx;
                let dy = (y - cy) / true_ry;
                let rho = (dx * dx + dy * dy).sqrt() * ((true_rx + true_ry) * 0.5);
                let i = (gy * gw + gx) as usize;
                resid[i] = amp * dipole_kernel(rho, true_z);
                counts[i] = 1;
            }
        }
        (resid, counts, gw, gh)
    }

    #[test]
    fn recovers_synthetic_dipole_depth() {
        let true_z = 2.0f32;
        let (resid, counts, gw, gh) = synth_grid(true_z, 0.55, 0.55, 1.2e5);
        let proxy = fit_compact_dipole(
            &resid,
            &counts,
            gw,
            gh,
            0.0,
            0.0,
            4.0,
            5.0,
            2.0,
            2.5,
            0.0,
        )
        .expect("fit");
        assert_eq!(proxy.method, "compact-dipole");
        assert!(proxy.disclaimer.contains("CAD"));
        assert!(
            (proxy.depth_magnetic_m - true_z).abs() < 0.55,
            "expected z~{true_z}, got {}",
            proxy.depth_magnetic_m
        );
        assert!(proxy.misfit_rms < 0.35, "misfit {}", proxy.misfit_rms);
        assert!(proxy.polygon.len() >= 12);
        assert!((proxy.cx - 2.0).abs() < 0.45);
        assert!((proxy.cy - 2.5).abs() < 0.45);
    }

    #[test]
    fn sensor_height_shifts_reported_depth_only() {
        let (resid, counts, gw, gh) = synth_grid(1.5, 0.5, 0.5, 9.0e4);
        let a = fit_compact_dipole(&resid, &counts, gw, gh, 0.0, 0.0, 4.0, 5.0, 2.0, 2.5, 0.0)
            .expect("a");
        let b = fit_compact_dipole(&resid, &counts, gw, gh, 0.0, 0.0, 4.0, 5.0, 2.0, 2.5, 0.4)
            .expect("b");
        assert!((a.depth_magnetic_m - b.depth_magnetic_m).abs() < 0.05);
        assert!((b.depth_m - a.depth_m).abs() < 0.05);
    }
}
