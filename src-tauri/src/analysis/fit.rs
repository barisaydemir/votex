//! Yapı ölçü ve yön uyum geçidi (Fit Pass).
//!
//! Konum (cx/cy, tünel uçları) korunur; metre ölçüleri ve bearing harita ayakizi
//! + alan/duvar desteğiyle hizalanır. Yeni yapı üretmez.

use crate::preprocess::WallCue;
use crate::surface::{Chamber, MetalBody, Tunnel, UndergroundStructures};

const WELL_TYPICAL_M: f32 = 7.5;
const ENDPOINT_NUDGE_MAX: f32 = 0.03;

#[derive(Debug, Clone, Default)]
pub struct FitSummary {
    pub adjusted_count: u32,
    pub mean_size_score: f32,
    pub mean_orient_score: f32,
}

/// extract_validated sonrası, enrich öncesi çağrılır.
pub fn fit_structures(
    signed: &[f32],
    w: u32,
    h: u32,
    map_width_m: f32,
    map_depth_m: f32,
    depth_range_m: f32,
    view_mode: &str,
    wall_cues: &[WallCue],
    structures: &mut UndergroundStructures,
) -> FitSummary {
    let side = view_mode.eq_ignore_ascii_case("side");
    let mut sum_size = 0.0f32;
    let mut sum_orient = 0.0f32;
    let mut n = 0u32;
    let mut adjusted = 0u32;

    for c in &mut structures.chambers {
        let (sz, or, adj) = if c.kind == "shaft" {
            fit_shaft(
                c,
                side,
                map_width_m,
                map_depth_m,
                depth_range_m,
                signed,
                w,
                h,
                wall_cues,
            )
        } else {
            fit_room(
                c,
                side,
                map_width_m,
                map_depth_m,
                depth_range_m,
                signed,
                w,
                h,
                wall_cues,
            )
        };
        sum_size += sz;
        sum_orient += or;
        n += 1;
        if adj {
            adjusted += 1;
        }
    }

    for t in &mut structures.tunnels {
        let (sz, or, adj) = fit_tunnel(
            t,
            side,
            map_width_m,
            map_depth_m,
            depth_range_m,
            signed,
            w,
            h,
            wall_cues,
        );
        sum_size += sz;
        sum_orient += or;
        n += 1;
        if adj {
            adjusted += 1;
        }
    }

    // Fit sonrası: tünel tabanı = oda tabanı; tavan yükselir (hacim büyür)
    crate::structures::align_tunnel_floors_to_rooms(
        &mut structures.tunnels,
        &structures.chambers,
        side,
        depth_range_m,
    );
    crate::structures::expand_volume_keep_floors(
        &mut structures.chambers,
        &mut structures.tunnels,
        depth_range_m,
    );

    // Host referansları için chambers/tunnels kopyası (metal fit host boyutuna bakar)
    let hosts_c: Vec<Chamber> = structures.chambers.clone();
    let hosts_t: Vec<Tunnel> = structures.tunnels.clone();

    for m in &mut structures.metals {
        let (sz, or, adj) = fit_metal(
            m,
            side,
            map_width_m,
            map_depth_m,
            depth_range_m,
            &hosts_c,
            &hosts_t,
        );
        sum_size += sz;
        sum_orient += or;
        n += 1;
        if adj {
            adjusted += 1;
        }
    }

    let inv = if n > 0 { 1.0 / n as f32 } else { 0.0 };
    FitSummary {
        adjusted_count: adjusted,
        mean_size_score: sum_size * inv,
        mean_orient_score: sum_orient * inv,
    }
}

fn soft_blend(old: f32, target: f32, t: f32) -> f32 {
    old * (1.0 - t) + target * t
}

fn angle_diff_deg(a: f32, b: f32) -> f32 {
    let mut d = (a - b).abs() % 360.0;
    if d > 180.0 {
        d = 360.0 - d;
    }
    // eksen 180° periyodik
    d.min(180.0 - d)
}

fn bearing_from_segment(x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let north = -dy;
    let east = dx;
    let mut deg = east.atan2(north).to_degrees();
    if deg < 0.0 {
        deg += 360.0;
    }
    deg
}

fn compass8(deg: f32) -> String {
    let d = ((deg % 360.0) + 360.0) % 360.0;
    let idx = ((d + 22.5) / 45.0).floor() as usize % 8;
    ["K", "KD", "D", "GD", "G", "GB", "B", "KB"][idx].to_string()
}

fn direction_labels(deg: f32) -> (String, String) {
    let heading = compass8(deg);
    let axis = deg % 180.0;
    let direction = format!("{}–{}", compass8(axis), compass8((axis + 180.0) % 360.0));
    (heading, direction)
}

fn sample_field_along(
    signed: &[f32],
    w: u32,
    h: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    negative: bool,
) -> f32 {
    let n = 24;
    let mut hit = 0u32;
    let dx = x1 - x0;
    let dy = y1 - y0;
    for i in 0..=n {
        let t = i as f32 / n as f32;
        let nx = (x0 + dx * t).clamp(0.0, 1.0);
        let ny = (y0 + dy * t).clamp(0.0, 1.0);
        let gx = (nx * (w - 1) as f32).round() as i32;
        let gy = (ny * (h - 1) as f32).round() as i32;
        if gx < 0 || gy < 0 || gx >= w as i32 || gy >= h as i32 {
            continue;
        }
        let v = signed[(gy as u32 * w + gx as u32) as usize];
        let ok = if negative { v <= -0.12 } else { v >= 0.12 };
        if ok {
            hit += 1;
        }
    }
    hit as f32 / (n + 1) as f32
}

fn wall_axis_support(cues: &[WallCue], cx: f32, cy: f32, ux: f32, uy: f32, rad: f32) -> f32 {
    if cues.is_empty() {
        return 0.35;
    }
    let mut aligned = 0.0f32;
    let mut n = 0.0f32;
    for c in cues {
        let dx = c.x - cx;
        let dy = c.y - cy;
        let dist = (dx * dx + dy * dy).sqrt();
        if dist > rad * 1.8 || dist < 1e-4 {
            continue;
        }
        let along = (dx * ux + dy * uy).abs() / dist;
        aligned += along * c.strength.max(0.2);
        n += 1.0;
    }
    if n < 1.0 {
        0.35
    } else {
        (aligned / n).clamp(0.0, 1.0)
    }
}

fn well_physical_diam(rx: f32, ry: f32, map_w_m: f32, map_d_m: f32) -> f32 {
    let footprint = (rx * 2.0 * map_w_m).min(ry * 2.0 * map_d_m).max(0.4);
    if footprint <= 2.8 {
        footprint.clamp(0.55, 2.8)
    } else {
        (footprint * 0.28).clamp(0.8, 2.8)
    }
}

fn footprint_wh_m(rx: f32, ry: f32, map_w_m: f32, map_d_m: f32, side: bool, _depth_range_m: f32) -> (f32, f32) {
    // Ayakizi her zaman harita en-boyu (yan şerit sıkıştırması yok)
    let wx = (rx * 2.0 * map_w_m).max(0.35);
    let wz = (ry * 2.0 * map_d_m).max(0.35);
    let _ = side;
    (wx, wz)
}

fn write_fit_geom(
    g: &mut crate::surface::GeometryAnalysis,
    size_score: f32,
    orient_score: f32,
    adjusted: bool,
    method: &str,
    suspect_orient: bool,
) {
    g.size_score = size_score;
    g.orient_score = orient_score;
    g.fit_adjusted = adjusted;
    g.fit_method = method.into();
    if suspect_orient {
        if !g.label.contains("yön şüpheli") {
            if g.label.is_empty() {
                g.label = "yön şüpheli".into();
            } else {
                g.label = format!("{} · yön şüpheli", g.label);
            }
        }
    }
}

fn fit_shaft(
    c: &mut Chamber,
    side: bool,
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    signed: &[f32],
    w: u32,
    h: u32,
    walls: &[WallCue],
) -> (f32, f32, bool) {
    let mut adjusted = false;
    let (fw, _) = footprint_wh_m(c.rx, c.ry, map_w_m, map_d_m, side, depth_range_m);
    let diam_target = well_physical_diam(c.rx, c.ry, map_w_m, map_d_m);

    let new_w = soft_blend(c.width_m, diam_target, 0.65);
    let new_l = soft_blend(c.length_m, diam_target, 0.65);
    if (new_w - c.width_m).abs() > 0.08 || (new_l - c.length_m).abs() > 0.08 {
        adjusted = true;
    }
    c.width_m = new_w;
    c.length_m = new_l;

    if !side {
        let well_cap = depth_range_m.max(WELL_TYPICAL_M + 1.0);
        let cover = c.top_from_surface_m.clamp(0.04, 0.35);
        let bottom = WELL_TYPICAL_M.clamp(cover + 5.5, well_cap);
        if (c.top_from_surface_m - cover).abs() > 0.05
            || (c.bottom_from_surface_m - bottom).abs() > 0.15
        {
            adjusted = true;
        }
        c.top_from_surface_m = cover;
        c.bottom_from_surface_m = bottom;
        c.height_m = (bottom - cover).max(5.5);
        c.depth = ((cover + c.height_m * 0.5) / well_cap).clamp(0.05, 0.98);
        c.height = (c.height_m / well_cap).clamp(0.08, 0.95);
        c.bearing_deg = 0.0;
    } else {
        // Yan: dikey tutarlılık
        let h = (c.bottom_from_surface_m - c.top_from_surface_m).max(0.5);
        if (c.height_m - h).abs() > 0.08 {
            adjusted = true;
            c.height_m = h;
        }
        c.bottom_from_surface_m = (c.top_from_surface_m + c.height_m).min(depth_range_m);
    }

    let depth_ok = (c.height_m - (c.bottom_from_surface_m - c.top_from_surface_m))
        .abs()
        .min(1.0);
    let size_score = (1.0 - (c.width_m - diam_target).abs() / fw.max(1.0)).clamp(0.2, 1.0)
        * 0.5
        + (1.0 - depth_ok) * 0.5;

    let hl = c.rx.max(c.ry).max(0.04);
    let field = sample_field_along(
        signed,
        w,
        h,
        c.cx,
        (c.cy - hl).clamp(0.0, 1.0),
        c.cx,
        (c.cy + hl).clamp(0.0, 1.0),
        true,
    );
    let wall_s = wall_axis_support(walls, c.cx, c.cy, 0.0, 1.0, c.rx.max(c.ry) + 0.05);
    let orient_score = (0.45 * field + 0.30 * wall_s + 0.25 * 1.0).clamp(0.0, 1.0);

    write_fit_geom(
        &mut c.geometry,
        size_score,
        orient_score,
        adjusted,
        "fit_shaft",
        orient_score < 0.35,
    );
    (size_score, orient_score, adjusted)
}

fn fit_room(
    c: &mut Chamber,
    side: bool,
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    signed: &[f32],
    w: u32,
    h: u32,
    walls: &[WallCue],
) -> (f32, f32, bool) {
    let mut adjusted = false;
    // Yan oda: Z ince kesit (ry×map_d şişirmesini fit geri getirmesin)
    let (fw, fl) = if side {
        let wx = (c.rx * 2.0 * map_w_m).max(0.35);
        let thin = (c.height_m * 0.55).clamp(0.7, 1.8);
        (wx, thin)
    } else {
        footprint_wh_m(c.rx, c.ry, map_w_m, map_d_m, side, depth_range_m)
    };
    let max_w = map_w_m * 0.95;
    let max_l = if side { 1.85 } else { map_d_m * 0.95 };
    let tw = fw.clamp(0.35, max_w);
    let tl = fl.clamp(0.35, max_l);
    let nw = soft_blend(c.width_m, tw, 0.55).clamp(0.35, max_w);
    let nl = soft_blend(c.length_m, tl, 0.55).clamp(0.35, max_l);
    if (nw - c.width_m).abs() > 0.12 || (nl - c.length_m).abs() > 0.12 {
        adjusted = true;
    }
    c.width_m = nw;
    c.length_m = nl;
    if side {
        c.bearing_deg = 0.0;
    }

    let span_h = (c.bottom_from_surface_m - c.top_from_surface_m).max(0.4);
    if (c.height_m - span_h).abs() > 0.08 {
        adjusted = true;
        c.height_m = span_h;
    }
    c.bottom_from_surface_m =
        (c.top_from_surface_m + c.height_m).min(depth_range_m);

    // Yön: bbox uzun ekseni
    let axis_deg = if side {
        // yan: X–derinlik düzlemi eğimi yaklaşık
        let dx = c.rx.max(1e-3);
        let dy = c.ry.max(1e-3);
        dy.atan2(dx).to_degrees()
    } else if c.rx >= c.ry {
        90.0 // doğu–batı (X)
    } else {
        0.0 // kuzey–güney
    };
    let declared = c.bearing_deg;
    let dth = angle_diff_deg(declared, axis_deg);
    let field = {
        let ux = if side || c.rx >= c.ry { 1.0 } else { 0.0 };
        let uy = if side || c.rx < c.ry { 1.0 } else { 0.0 };
        sample_field_along(
            signed,
            w,
            h,
            (c.cx - ux * c.rx).clamp(0.0, 1.0),
            (c.cy - uy * c.ry).clamp(0.0, 1.0),
            (c.cx + ux * c.rx).clamp(0.0, 1.0),
            (c.cy + uy * c.ry).clamp(0.0, 1.0),
            true,
        )
    };
    let wall_s = wall_axis_support(
        walls,
        c.cx,
        c.cy,
        if c.rx >= c.ry { 1.0 } else { 0.0 },
        if c.rx >= c.ry { 0.0 } else { 1.0 },
        c.rx.max(c.ry) + 0.06,
    );
    let axis_vs_decl = (1.0 - dth / 90.0).clamp(0.0, 1.0);
    let orient_score =
        (0.45 * field + 0.30 * wall_s + 0.25 * axis_vs_decl).clamp(0.0, 1.0);

    if orient_score >= 0.35 && orient_score < 0.55 && dth > 18.0 {
        c.bearing_deg = soft_blend(declared, axis_deg, 0.55);
        adjusted = true;
    } else if orient_score >= 0.55 && dth > 25.0 {
        c.bearing_deg = soft_blend(declared, axis_deg, 0.35);
        adjusted = true;
    }

    let size_score = {
        let span = tw.max(tl).max(1.0);
        let wo = 1.0 - (c.width_m - tw).abs() / span;
        let lo = 1.0 - (c.length_m - tl).abs() / span;
        let depth_ok =
            1.0 - (c.height_m - (c.bottom_from_surface_m - c.top_from_surface_m)).abs().min(1.0);
        ((wo + lo) * 0.35 + depth_ok * 0.3).clamp(0.15, 1.0)
    };

    write_fit_geom(
        &mut c.geometry,
        size_score,
        orient_score,
        adjusted,
        "fit_room",
        orient_score < 0.35,
    );
    (size_score, orient_score, adjusted)
}

fn fit_tunnel(
    t: &mut Tunnel,
    side: bool,
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    signed: &[f32],
    w: u32,
    h: u32,
    walls: &[WallCue],
) -> (f32, f32, bool) {
    let mut adjusted = false;
    let mx = (t.x0 + t.x1) * 0.5;
    let my = (t.y0 + t.y1) * 0.5;
    let dx = t.x1 - t.x0;
    let dy = t.y1 - t.y0;
    let len_n = (dx * dx + dy * dy).sqrt().max(1e-4);
    let ux = dx / len_n;
    let uy = dy / len_n;

    // Yükseklik = floor − crown (yüzey aralığını açma)
    let crown = t.crown_from_surface_m.clamp(0.05, depth_range_m - 0.4);
    let floor = t
        .floor_from_surface_m
        .clamp(crown + 0.4, depth_range_m);
    let h_target = (floor - crown).max(0.4);
    if (t.height_m - h_target).abs() > 0.05
        || (t.crown_from_surface_m - crown).abs() > 0.05
        || (t.floor_from_surface_m - floor).abs() > 0.05
    {
        adjusted = true;
    }
    t.crown_from_surface_m = crown;
    t.floor_from_surface_m = floor;
    t.height_m = h_target;
    t.depth = ((crown + h_target * 0.5) / depth_range_m).clamp(0.05, 0.98);

    // Genişlik: enine ayakizi tahmini (radius × map) + mevcut
    let cross_m = if side {
        (t.radius * 2.0 * map_w_m).clamp(0.55, 2.8)
    } else {
        (t.radius * 2.0 * map_w_m.min(map_d_m)).clamp(0.6, 4.0)
    };
    let w_target = soft_blend(t.width_m, cross_m.max(t.height_m * 0.85), 0.45)
        .clamp(0.55, if side { 2.8 } else { 4.0 });
    if (w_target - t.width_m).abs() > 0.1 {
        adjusted = true;
    }
    t.width_m = w_target;

    let field = sample_field_along(signed, w, h, t.x0, t.y0, t.x1, t.y1, true);
    let wall_s = wall_axis_support(walls, mx, my, ux, uy, 0.12);
    let seg_bearing = bearing_from_segment(t.x0, t.y0, t.x1, t.y1);
    let axis_vs_decl = (1.0 - angle_diff_deg(t.bearing_deg, seg_bearing) / 90.0).clamp(0.0, 1.0);
    let orient_score =
        (0.45 * field + 0.30 * wall_s + 0.25 * axis_vs_decl).clamp(0.0, 1.0);

    // Düşük yön skoru: uçları eksen boyunca mikro yasla (konum merkezi korunur)
    if orient_score >= 0.35 && orient_score < 0.55 && field > 0.2 {
        let nudge = ENDPOINT_NUDGE_MAX * (0.55 - orient_score);
        // Alan desteği daha iyi olan yönde hafif uzat/kısalt — merkezi sabitle
        let cx = mx;
        let cy = my;
        let half = len_n * 0.5;
        let new_half = (half + nudge).clamp(0.03, 0.48);
        t.x0 = (cx - ux * new_half).clamp(0.02, 0.98);
        t.y0 = (cy - uy * new_half).clamp(0.02, 0.98);
        t.x1 = (cx + ux * new_half).clamp(0.02, 0.98);
        t.y1 = (cy + uy * new_half).clamp(0.02, 0.98);
        adjusted = true;
    }

    let (bearing, heading, direction) = {
        let deg = bearing_from_segment(t.x0, t.y0, t.x1, t.y1);
        let (heading, direction) = direction_labels(deg);
        (deg, heading, direction)
    };
    if angle_diff_deg(t.bearing_deg, bearing) > 8.0 {
        adjusted = true;
    }
    t.bearing_deg = bearing;
    t.heading = heading;
    t.direction = direction;

    let size_score = {
        let depth_ok =
            1.0 - (t.height_m - (t.floor_from_surface_m - t.crown_from_surface_m)).abs().min(1.0);
        let w_ok = (1.0 - (t.width_m - w_target).abs() / 3.0).clamp(0.2, 1.0);
        (depth_ok * 0.65 + w_ok * 0.35).clamp(0.2, 1.0)
    };

    write_fit_geom(
        &mut t.geometry,
        size_score,
        orient_score,
        adjusted,
        "fit_tunnel",
        orient_score < 0.35,
    );
    (size_score, orient_score, adjusted)
}

fn fit_metal(
    m: &mut MetalBody,
    side: bool,
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    chambers: &[Chamber],
    tunnels: &[Tunnel],
) -> (f32, f32, bool) {
    let mut adjusted = false;
    let (fw, fl) = footprint_wh_m(m.rx, m.ry, map_w_m, map_d_m, side, depth_range_m);

    let mut tw = soft_blend(m.width_m, fw, 0.5).max(0.35);
    let mut tl = soft_blend(m.length_m, fl, 0.5).max(0.3);
    let mut plume = if side {
        soft_blend(
            m.plume_height_m,
            (0.2 + (1.0 - m.intensity) * 0.95).clamp(0.18, depth_range_m * 0.28),
            0.4,
        )
        .clamp(0.18, depth_range_m * 0.32)
    } else {
        soft_blend(m.plume_height_m, (fw.max(fl) * 0.3).clamp(0.2, 1.8), 0.4)
    };

    // Host içine sığdır — yayma yok
    if m.inside_chamber && !m.host_kind.is_empty() {
        if let Some(c) = chambers.iter().find(|c| {
            c.kind == m.host_kind
                && ((c.cx - m.cx).powi(2) + (c.cy - m.cy).powi(2)).sqrt() < 0.25
        }) {
            tw = tw.min(c.width_m * 0.92).max(0.35);
            tl = tl.min(c.length_m.max(c.width_m) * 0.92).max(0.3);
            plume = plume.min(c.height_m * 0.85).max(0.2);
            if m.host_kind == "tunnel" {
                if let Some(t) = tunnels.iter().min_by(|a, b| {
                    let da = point_seg(m.cx, m.cy, a.x0, a.y0, a.x1, a.y1);
                    let db = point_seg(m.cx, m.cy, b.x0, b.y0, b.x1, b.y1);
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                }) {
                    m.bearing_deg = t.bearing_deg;
                    tw = tw.min(t.width_m).max(0.35);
                    plume = plume.min(t.height_m * 0.7).max(0.2);
                }
            }
        } else if m.host_kind == "tunnel" {
            if let Some(t) = tunnels.iter().min_by(|a, b| {
                let da = point_seg(m.cx, m.cy, a.x0, a.y0, a.x1, a.y1);
                let db = point_seg(m.cx, m.cy, b.x0, b.y0, b.x1, b.y1);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            }) {
                m.bearing_deg = t.bearing_deg;
                tw = tw.min(t.width_m).max(0.35);
                tl = tl.min(t.width_m * 1.2).max(0.3);
                plume = plume.min(t.height_m * 0.7).max(0.2);
            }
        }
    }

    if (tw - m.width_m).abs() > 0.1
        || (tl - m.length_m).abs() > 0.1
        || (plume - m.plume_height_m).abs() > 0.1
    {
        adjusted = true;
    }
    m.width_m = tw;
    m.length_m = tl;
    m.plume_height_m = plume;
    m.size_m = tw.min(tl);
    m.spread_m = tw.max(tl).max(plume) * 0.5;

    let size_score = (1.0 - (m.width_m - fw).abs() / fw.max(1.0)).clamp(0.2, 1.0) * 0.5
        + (1.0 - (m.length_m - fl).abs() / fl.max(1.0)).clamp(0.2, 1.0) * 0.5;
    let orient_score = if m.bearing_deg.abs() > 1.0 { 0.7 } else { 0.55 };

    write_fit_geom(
        &mut m.geometry,
        size_score,
        orient_score,
        adjusted,
        "fit_metal",
        false,
    );
    (size_score, orient_score, adjusted)
}

fn point_seg(px: f32, py: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len2 = dx * dx + dy * dy;
    if len2 < 1e-8 {
        return ((px - x0).powi(2) + (py - y0).powi(2)).sqrt();
    }
    let t = ((px - x0) * dx + (py - y0) * dy) / len2;
    let t = t.clamp(0.0, 1.0);
    let qx = x0 + dx * t;
    let qy = y0 + dy * t;
    ((px - qx).powi(2) + (py - qy).powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surface::Evidence;

    fn empty_tunnel() -> Tunnel {
        Tunnel {
            x0: 0.2,
            y0: 0.5,
            x1: 0.8,
            y1: 0.5,
            radius: 0.03,
            depth: 0.4,
            bearing_deg: 90.0,
            direction: "D–B".into(),
            heading: "D".into(),
            width_m: 1.5,
            floor_from_surface_m: 4.0,
            crown_from_surface_m: 1.5,
            height_m: 1.0, // bilerek tutarsız
            confidence: 0.8,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        }
    }

    #[test]
    fn tunnel_height_matches_floor_minus_crown() {
        let mut t = empty_tunnel();
        let signed = vec![0.0f32; 64];
        let (sz, _or, adj) = fit_tunnel(&mut t, false, 24.0, 24.0, 10.0, &signed, 8, 8, &[]);
        assert!(adj);
        assert!((t.height_m - (t.floor_from_surface_m - t.crown_from_surface_m)).abs() < 0.05);
        assert!(sz > 0.4);
    }

    #[test]
    fn shaft_top_typical_depth() {
        let mut c = Chamber {
            kind: "shaft".into(),
            cx: 0.5,
            cy: 0.5,
            rx: 0.06,
            ry: 0.06,
            depth: 0.4,
            height: 0.3,
            intensity: 0.8,
            width_m: 4.0,
            length_m: 4.0,
            top_from_surface_m: 0.5,
            bottom_from_surface_m: 3.0,
            height_m: 2.5,
            bearing_deg: 12.0,
            confidence: 0.9,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        };
        let signed = vec![0.0f32; 64];
        let (_sz, _or, adj) = fit_shaft(&mut c, false, 24.0, 24.0, 10.0, &signed, 8, 8, &[]);
        assert!(adj);
        assert!(c.top_from_surface_m <= 0.35);
        assert!((c.bottom_from_surface_m - WELL_TYPICAL_M).abs() < 0.6);
        assert!((c.height_m - (c.bottom_from_surface_m - c.top_from_surface_m)).abs() < 0.05);
        assert!(c.width_m <= 2.85);
    }

    #[test]
    fn fit_preserves_tunnel_midpoint() {
        let mut t = empty_tunnel();
        let mx0 = (t.x0 + t.x1) * 0.5;
        let my0 = (t.y0 + t.y1) * 0.5;
        let signed = vec![-0.5f32; 64];
        let _ = fit_tunnel(&mut t, false, 24.0, 24.0, 10.0, &signed, 8, 8, &[]);
        let mx1 = (t.x0 + t.x1) * 0.5;
        let my1 = (t.y0 + t.y1) * 0.5;
        assert!((mx1 - mx0).abs() < 0.04);
        assert!((my1 - my0).abs() < 0.04);
    }

    #[test]
    fn diagonal_void_raises_orient_score() {
        // 16×16 alan: diyagonal negatif koridor
        let w = 16u32;
        let h = 16u32;
        let mut signed = vec![0.0f32; (w * h) as usize];
        for i in 0..16 {
            let x = i;
            let y = i;
            signed[(y * w + x) as usize] = -0.8;
            if x + 1 < w {
                signed[(y * w + x + 1) as usize] = -0.5;
            }
        }
        let mut t = Tunnel {
            x0: 0.15,
            y0: 0.15,
            x1: 0.85,
            y1: 0.85,
            radius: 0.04,
            depth: 0.4,
            bearing_deg: 45.0,
            direction: "KD–GB".into(),
            heading: "KD".into(),
            width_m: 1.2,
            floor_from_surface_m: 3.5,
            crown_from_surface_m: 1.2,
            height_m: 1.0,
            confidence: 0.8,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        };
        let (_sz, or, _) = fit_tunnel(&mut t, false, 24.0, 24.0, 10.0, &signed, w, h, &[]);
        assert!(
            or >= 0.35,
            "diagonal corridor should get decent orient_score, got {or}"
        );
        assert!((t.height_m - (t.floor_from_surface_m - t.crown_from_surface_m)).abs() < 0.05);
    }
}
