//! Deep geometry analysis — landmark-free symmetry & regularity.

mod fit;
mod regularity;
mod symmetry;

pub use crate::surface::{GeometryAnalysis, SiteGeometryReport};
pub use fit::fit_structures;

use crate::surface::{Chamber, MetalBody, Tunnel, UndergroundStructures};
use regularity::{elongation_wh, label_for, label_metal_placement, rectangularity};
use symmetry::{axial_corridor, bilateral_symmetry, radial_symmetry};

fn merge_fit_fields(prev: &GeometryAnalysis, mut g: GeometryAnalysis) -> GeometryAnalysis {
    g.size_score = prev.size_score;
    g.orient_score = prev.orient_score;
    g.fit_adjusted = prev.fit_adjusted;
    g.fit_method = prev.fit_method.clone();
    if prev.label.contains("yön şüpheli") && !g.label.contains("yön şüpheli") {
        if g.label.is_empty() {
            g.label = "yön şüpheli".into();
        } else {
            g.label = format!("{} · yön şüpheli", g.label);
        }
    }
    g
}

/// Enrich validated structures with geometry / symmetry scores.
/// Fit skorları (önceki `fit_structures` geçidi) korunur.
pub fn enrich_structures(
    signed: &[f32],
    w: u32,
    h: u32,
    structures: &mut UndergroundStructures,
) -> SiteGeometryReport {
    let mut sum_sym = 0.0f32;
    let mut sum_rect = 0.0f32;
    let mut sum_size = 0.0f32;
    let mut sum_orient = 0.0f32;
    let mut n = 0u32;
    let mut high = 0u32;
    let mut fit_adj = 0u32;

    for c in &mut structures.chambers {
        let prev = c.geometry.clone();
        let g = merge_fit_fields(&prev, analyze_chamber(signed, w, h, c));
        if g.symmetry_index >= 0.75 {
            high += 1;
        }
        if g.fit_adjusted {
            fit_adj += 1;
        }
        sum_sym += g.symmetry_index;
        sum_rect += g.rectangularity;
        sum_size += g.size_score;
        sum_orient += g.orient_score;
        n += 1;
        c.geometry = g;
    }

    for t in &mut structures.tunnels {
        let prev = t.geometry.clone();
        let g = merge_fit_fields(&prev, analyze_tunnel(signed, w, h, t));
        if g.symmetry_index >= 0.75 {
            high += 1;
        }
        if g.fit_adjusted {
            fit_adj += 1;
        }
        sum_sym += g.symmetry_index;
        sum_rect += g.rectangularity;
        sum_size += g.size_score;
        sum_orient += g.orient_score;
        n += 1;
        t.geometry = g;
    }

    // Metal: yapı değildir; oda/şaft/tünel içinde veya bağımsız anomalidir
    for m in &mut structures.metals {
        let prev = m.geometry.clone();
        let g = merge_fit_fields(&prev, analyze_metal(m));
        if g.symmetry_index >= 0.75 {
            high += 1;
        }
        if g.fit_adjusted {
            fit_adj += 1;
        }
        sum_sym += g.symmetry_index;
        sum_rect += g.rectangularity;
        sum_size += g.size_score;
        sum_orient += g.orient_score;
        n += 1;
        m.geometry = g;
    }

    let inv = if n > 0 { 1.0 / n as f32 } else { 0.0 };
    let prior = &structures.geometry_report;
    let report = SiteGeometryReport {
        mean_symmetry: sum_sym * inv,
        mean_rectangularity: sum_rect * inv,
        analyzed_count: n,
        high_symmetry_count: high,
        fit_adjusted_count: if fit_adj > 0 {
            fit_adj
        } else {
            prior.fit_adjusted_count
        },
        mean_size_score: if sum_size > 0.0 {
            sum_size * inv
        } else {
            prior.mean_size_score
        },
        mean_orient_score: if sum_orient > 0.0 {
            sum_orient * inv
        } else {
            prior.mean_orient_score
        },
        prob_engine_online: prior.prob_engine_online,
        prob_engine_label: prior.prob_engine_label.clone(),
        prob_used_legacy: prior.prob_used_legacy,
    };
    structures.geometry_report = report.clone();
    report
}

fn analyze_chamber(signed: &[f32], w: u32, h: u32, c: &Chamber) -> GeometryAnalysis {
    let aspect = elongation_wh(c.width_m, c.length_m);
    let fill_proxy = (c.intensity * 0.5 + (1.0 / aspect) * 0.35 + 0.2).clamp(0.15, 0.95);
    let rectangularity = rectangularity(fill_proxy);
    let elongation = aspect;

    if c.kind == "shaft" {
        let (score, residual, axis) =
            radial_symmetry(signed, w, h, c.cx, c.cy, c.rx, c.ry);
        let method = "radial";
        return GeometryAnalysis {
            symmetry_index: score,
            symmetry_axis_deg: axis,
            rectangularity,
            elongation,
            mirror_residual: residual,
            method: method.into(),
            label: label_for(method, score),
            ..Default::default()
        };
    }

    let (score, residual, axis) =
        bilateral_symmetry(signed, w, h, c.cx, c.cy, c.rx, c.ry);
    let blended = (score * 0.85 + rectangularity * 0.15).clamp(0.0, 1.0);
    let method = "bilateral";
    GeometryAnalysis {
        symmetry_index: blended,
        symmetry_axis_deg: axis,
        rectangularity,
        elongation,
        mirror_residual: residual,
        method: method.into(),
        label: label_for(method, blended),
        ..Default::default()
    }
}

fn analyze_tunnel(signed: &[f32], w: u32, h: u32, t: &Tunnel) -> GeometryAnalysis {
    let (score, residual, axis) =
        axial_corridor(signed, w, h, t.x0, t.y0, t.x1, t.y1);
    let path = t.evidence.path_support.clamp(0.0, 1.0);
    let blended = (score * 0.7 + path * 0.3).clamp(0.0, 1.0);
    let elongation = {
        let dx = t.x1 - t.x0;
        let dy = t.y1 - t.y0;
        let len = (dx * dx + dy * dy).sqrt().max(1e-3);
        (len / (t.width_m / 24.0).max(0.02)).clamp(1.0, 20.0)
    };
    let method = "axial";
    GeometryAnalysis {
        symmetry_index: blended,
        symmetry_axis_deg: axis,
        rectangularity: score,
        elongation,
        mirror_residual: residual,
        method: method.into(),
        label: label_for(method, blended),
        ..Default::default()
    }
}

/// Kırmızı ipucu: metal / oksitlenme / yüzey çıkışı / alan yayılımı.
fn analyze_metal(m: &MetalBody) -> GeometryAnalysis {
    let elongation = elongation_wh(m.width_m, m.length_m.max(m.plume_height_m.max(0.1)));
    let strength = m.field_strength.max(m.intensity).clamp(0.0, 1.0);
    let spread = m.spread_ratio.clamp(0.0, 1.0);
    let score = if m.inside_chamber {
        (strength * 0.55 + spread * 0.45).clamp(0.0, 1.0)
    } else {
        (strength * 0.7 + (m.spread_m / 4.0).clamp(0.0, 1.0) * 0.3).clamp(0.0, 1.0)
    };

    let host = if m.inside_chamber && !m.host_kind.is_empty() {
        m.host_kind.as_str()
    } else {
        ""
    };
    let cue = if m.cue_kind.is_empty() {
        "field"
    } else {
        m.cue_kind.as_str()
    };
    let guess = m.metal_guess.as_str();
    // Önceki yorum (boşluk içi / beyaz fışkırma) varsa koru, host ekle
    let mut label = if !m.geometry.label.is_empty() && m.geometry.label.contains("varsayım") {
        m.geometry.label.clone()
    } else {
        label_metal_placement(cue, host, guess, score)
    };
    if !host.is_empty() && !label.contains("içi") {
        let host_bit = match host {
            "room" => " · oda içi",
            "tomb" => " · mezar içi",
            "shaft" => " · kuyu içi",
            "tunnel" => " · tünel içi",
            _ => "",
        };
        label.push_str(host_bit);
    }

    GeometryAnalysis {
        symmetry_index: score,
        symmetry_axis_deg: m.bearing_deg,
        rectangularity: spread,
        elongation,
        mirror_residual: 1.0 - score,
        method: format!("red_{cue}"),
        label,
        ..Default::default()
    }
}
