//! Cross-structure validation: links, dedupe, metal attach.

use crate::surface::{Chamber, Evidence, MetalBody, Tunnel};

use super::compass::compass_from_segment;
use super::path::{path_corridor_support, path_void_support};
use super::types_local::{Blob, VoidClass};

/// Bağlı / yakın tünel tabanını oda tabanıyla aynı derinliğe getir.
pub fn align_tunnel_floors_to_rooms(
    tunnels: &mut [Tunnel],
    chambers: &[Chamber],
    side: bool,
    depth_range_m: f32,
) {
    let rooms: Vec<&Chamber> = chambers
        .iter()
        .filter(|c| c.kind == "room" || c.kind == "tomb")
        .collect();
    if rooms.is_empty() || tunnels.is_empty() {
        return;
    }

    for t in tunnels.iter_mut() {
        let Some(room) = nearest_room_for_tunnel(t, &rooms, side) else {
            continue;
        };
        let floor = room
            .bottom_from_surface_m
            .clamp(0.5, depth_range_m);
        // Taban = oda tabanı; tavanı 0.28'e çekme — sinyal gömüsü kalsın
        let crown = t
            .crown_from_surface_m
            .clamp(0.05, (floor - 0.9).max(0.05));
        t.floor_from_surface_m = floor;
        t.crown_from_surface_m = crown;
        t.height_m = (t.floor_from_surface_m - t.crown_from_surface_m).max(0.9);
        t.depth = ((t.crown_from_surface_m + t.height_m * 0.5) / depth_range_m).clamp(0.05, 0.98);
        if t.geometry.label.is_empty() || !t.geometry.label.contains("taban hizası") {
            if t.geometry.label.is_empty() {
                t.geometry.label = "oda taban hizası".into();
            } else {
                t.geometry.label = format!("{} · oda taban hizası", t.geometry.label);
            }
        }
    }
}

fn nearest_room_for_tunnel<'a>(
    t: &Tunnel,
    rooms: &[&'a Chamber],
    side: bool,
) -> Option<&'a Chamber> {
    let tmx = (t.x0 + t.x1) * 0.5;
    let tmy = (t.y0 + t.y1) * 0.5;
    let mut best: Option<(f32, &&Chamber)> = None;
    for c in rooms {
        let d = if side {
            // Yan: uçlar veya orta X odaya yakın
            let dx_mid = (tmx - c.cx).abs();
            let dx0 = (t.x0 - c.cx).abs();
            let dx1 = (t.x1 - c.cx).abs();
            let dx = dx_mid.min(dx0).min(dx1);
            let reach = c.rx.max(0.05) + 0.14;
            if dx > reach {
                continue;
            }
            dx
        } else {
            let d0 = ((t.x0 - c.cx).powi(2) + (t.y0 - c.cy).powi(2)).sqrt();
            let d1 = ((t.x1 - c.cx).powi(2) + (t.y1 - c.cy).powi(2)).sqrt();
            let dm = ((tmx - c.cx).powi(2) + (tmy - c.cy).powi(2)).sqrt();
            let d = d0.min(d1).min(dm);
            let reach = c.rx.max(c.ry).max(0.06) + 0.16;
            if d > reach {
                continue;
            }
            d
        };
        if best.map(|(bd, _)| d < bd).unwrap_or(true) {
            best = Some((d, c));
        }
    }
    best.map(|(_, c)| *c)
}

pub fn link_chambers_with_path(
    signed: &[f32],
    w: u32,
    h: u32,
    chambers: &[Chamber],
    thr: f32,
    depth_range_m: f32,
    min_confidence: f32,
    side: bool,
    through_red: bool,
) -> (Vec<Tunnel>, u32) {
    let mut out = Vec::new();
    let mut rejected = 0u32;
    let rooms: Vec<&Chamber> = chambers
        .iter()
        .filter(|c| c.kind == "room" || c.kind == "tomb")
        .collect();

    let d_min = if side { 0.04 } else { 0.1 };
    let d_max = if side { 0.72 } else { 0.45 };
    // Yan / through_red: kırmızı dolgu path'i kesmez — eşik düşük
    let path_need = if side || through_red { 0.12 } else { 0.58 };

    for i in 0..rooms.len() {
        let mut best: Option<(usize, f32, f32, bool)> = None;
        for j in 0..rooms.len() {
            if i == j {
                continue;
            }
            let a = rooms[i];
            let b = rooms[j];
            let dx = a.cx - b.cx;
            let dy = a.cy - b.cy;
            let d = (dx * dx + dy * dy).sqrt();
            if d < d_min || d > d_max {
                continue;
            }
            // Yan: aynı derinlik bandında bağlı odalar
            if side {
                let ya = (a.top_from_surface_m + a.bottom_from_surface_m) * 0.5;
                let yb = (b.top_from_surface_m + b.bottom_from_surface_m) * 0.5;
                if (ya - yb).abs() > depth_range_m * 0.55 {
                    continue;
                }
            }
            // through_red veya yan: kırmızı/nötr path sayılır
            let path = if side || through_red {
                path_corridor_support(signed, w, h, a.cx, a.cy, b.cx, b.cy, thr)
            } else {
                path_void_support(signed, w, h, a.cx, a.cy, b.cx, b.cy, thr)
            };
            // Yan: yakın odalar — kırmızı arada olsa bile her zaman bağla
            let geo_link = if side {
                let x_gap = (a.cx - b.cx).abs() - a.rx - b.rx;
                let y_ov = (a.cy - b.cy).abs() <= (a.ry + b.ry).max(0.05) + 0.16;
                let floors_ok = (a.bottom_from_surface_m - b.bottom_from_surface_m).abs()
                    <= depth_range_m * 0.5;
                let close = d <= 0.48 && floors_ok;
                let adjacent = x_gap <= 0.34 && x_gap >= -0.12 && y_ov && floors_ok && d <= 0.65;
                close || adjacent
            } else {
                false
            };
            if path < path_need && !geo_link {
                continue;
            }
            let score_d = if geo_link && path < path_need {
                d * 0.9
            } else {
                d
            };
            if best.map(|(_, bd, _, _)| score_d < bd).unwrap_or(true) {
                best = Some((j, score_d, path.max(if geo_link { 0.55 } else { 0.0 }), geo_link));
            }
        }
        if let Some((j, _d, path, geo_link)) = best {
            if i > j {
                continue;
            }
            let a = rooms[i];
            let b = rooms[j];
            let already = out.iter().any(|t: &Tunnel| {
                let mid_ok = {
                    let tmx = (t.x0 + t.x1) * 0.5;
                    let tmy = (t.y0 + t.y1) * 0.5;
                    let amx = (a.cx + b.cx) * 0.5;
                    let amy = (a.cy + b.cy) * 0.5;
                    ((tmx - amx).powi(2) + (tmy - amy).powi(2)).sqrt() < 0.08
                };
                mid_ok
                    || ((t.x0 - a.cx).abs() < 1e-3 && (t.y0 - a.cy).abs() < 1e-3)
                    || ((t.x0 - b.cx).abs() < 1e-3 && (t.y0 - b.cy).abs() < 1e-3)
            });
            if already {
                continue;
            }
            let conf = (0.35 + path * 0.5 + if geo_link { 0.12 } else { 0.0 }).clamp(0.0, 1.0);
            if conf < (min_confidence - if side { 0.14 } else { 0.0 }).max(0.22) {
                rejected += 1;
                continue;
            }
            let max_d = depth_range_m;
            let (cover, height_m, width_m, floor) = if side {
                // Bağlantı: taban her iki odanın tabanıyla aynı (daha derin olan)
                let floor = a
                    .bottom_from_surface_m
                    .max(b.bottom_from_surface_m)
                    .clamp(0.5, max_d);
                let cover = ((a.top_from_surface_m + b.top_from_surface_m) * 0.5)
                    .min(floor - 0.7)
                    .clamp(0.05, floor - 0.7);
                let height_m = (floor - cover).clamp(0.7, 4.2);
                let width_m = ((a.width_m.min(b.width_m)) * 0.55).clamp(0.55, 2.2);
                (cover, height_m, width_m, floor)
            } else {
                let cover = ((a.top_from_surface_m + b.top_from_surface_m) * 0.5)
                    .clamp(0.3, (max_d - 2.0).max(0.3));
                let height_m = ((a.height_m + b.height_m) * 0.35).clamp(1.6, 2.8);
                let width_m = (height_m * 0.95).clamp(1.5, 2.6);
                let floor = a
                    .bottom_from_surface_m
                    .max(b.bottom_from_surface_m)
                    .max(cover + height_m)
                    .min(max_d);
                let cover = (floor - height_m).max(0.1);
                (cover, floor - cover, width_m, floor)
            };
            let (bearing_deg, heading, direction) =
                compass_from_segment(a.cx, a.cy, b.cx, b.cy);
            let mut geom = crate::surface::GeometryAnalysis::default();
            geom.label = if geo_link {
                "bağlantı · yan oda geometri".into()
            } else {
                "bağlantı · oda taban hizası".into()
            };
            geom.method = if geo_link {
                "side_geo_link".into()
            } else {
                "path_link".into()
            };
            out.push(Tunnel {
                x0: a.cx,
                y0: a.cy,
                x1: b.cx,
                y1: b.cy,
                radius: 0.025,
                depth: ((cover + height_m * 0.5) / max_d).clamp(0.05, 0.95),
                bearing_deg,
                direction,
                heading,
                width_m,
                floor_from_surface_m: floor,
                crown_from_surface_m: cover,
                height_m,
                confidence: conf,
                tier: 0,
                depth_estimate_m: 0.0,
                evidence: Evidence {
                    snr: (a.intensity + b.intensity) * 0.5 / 0.08,
                    path_support: path,
                    class_margin: path - path_need,
                    wall_support: if geo_link { 0.35 } else { 0.0 },
                    reasons: vec![
                        if geo_link {
                            "vpe/geo_link".into()
                        } else {
                            "path_link".into()
                        },
                        format!("conf:{:.0}%", conf * 100.0),
                    ],
                },
                geometry: geom,
                outline: Vec::new(),
            });
        }
    }
    (out, rejected)
}

/// Kırmızı kendi başına yapı değildir — tünel/oda üretmez.
/// Yapı mavi+zarftan gelir; kırmızı sonra yapı içine oturur.
pub fn promote_side_red_corridors(
    _metals: &[MetalBody],
    _tunnels: &mut Vec<Tunnel>,
    _chambers: &[Chamber],
    _map_w_m: f32,
    _map_d_m: f32,
    _depth_range_m: f32,
    _min_conf: f32,
) {
    // no-op: kırmızı asla yapı kaynağı değil
}

/// Yan: hizalı kısa tünel parçalarını tek koridora birleştir.
pub fn merge_collinear_tunnels(mut tunnels: Vec<Tunnel>) -> Vec<Tunnel> {
    if tunnels.len() < 2 {
        return tunnels;
    }
    tunnels.sort_by(|a, b| {
        let am = (a.x0 + a.x1) * 0.5;
        let bm = (b.x0 + b.x1) * 0.5;
        am.partial_cmp(&bm).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut out: Vec<Tunnel> = Vec::new();
    for t in tunnels {
        let mut merged = false;
        for slot in &mut out {
            let _smx = (slot.x0 + slot.x1) * 0.5;
            let smy = (slot.y0 + slot.y1) * 0.5;
            let _tmx = (t.x0 + t.x1) * 0.5;
            let tmy = (t.y0 + t.y1) * 0.5;
            let dy = (smy - tmy).abs();
            if dy > 0.12 {
                continue;
            }
            let s0 = slot.x0.min(slot.x1);
            let s1 = slot.x0.max(slot.x1);
            let t0 = t.x0.min(t.x1);
            let t1 = t.x0.max(t.x1);
            let gap = (t0 - s1).max(s0 - t1).max(0.0);
            let overlap = (s1.min(t1) - s0.max(t0)).max(0.0);
            // Biraz daha geniş boşluk: bitişik kırmızı koridor kutuları birleşsin
            if gap > 0.18 && overlap < 0.02 {
                continue;
            }
            let x0 = s0.min(t0);
            let x1 = s1.max(t1);
            let y = (smy + tmy) * 0.5;
            slot.x0 = x0;
            slot.x1 = x1;
            slot.y0 = y;
            slot.y1 = y;
            slot.width_m = slot.width_m.max(t.width_m);
            slot.height_m = ((slot.height_m + t.height_m) * 0.5).max(slot.height_m.min(t.height_m));
            slot.crown_from_surface_m =
                slot.crown_from_surface_m.min(t.crown_from_surface_m);
            slot.floor_from_surface_m =
                slot.floor_from_surface_m.max(t.floor_from_surface_m);
            slot.height_m = (slot.floor_from_surface_m - slot.crown_from_surface_m).max(0.35);
            slot.confidence = slot.confidence.max(t.confidence);
            let (bearing, heading, direction) = compass_from_segment(x0, y, x1, y);
            slot.bearing_deg = bearing;
            slot.heading = heading;
            slot.direction = direction;
            if slot.geometry.label.is_empty() {
                slot.geometry.label = "birleşik koridor".into();
            }
            merged = true;
            break;
        }
        if !merged {
            out.push(t);
        }
    }
    out
}

pub fn dedupe_voids(
    mut items: Vec<(Blob, VoidClass, f32, f32, f32, Vec<String>)>,
) -> Vec<(Blob, VoidClass, f32, f32, f32, Vec<String>)> {
    items.sort_by(|a, b| {
        let aw = a.2 + if a.1 == VoidClass::Tunnel { 0.06 } else { 0.0 };
        let bw = b.2 + if b.1 == VoidClass::Tunnel { 0.06 } else { 0.0 };
        bw.partial_cmp(&aw).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut keep = Vec::new();
    for item in items {
        let overlaps = keep.iter().any(|(ob, oc, _, _, _, _): &(Blob, VoidClass, _, _, _, _)| {
            let dx = (item.0.cx - ob.cx) / (item.0.rx + ob.rx).max(1e-3);
            let dy = (item.0.cy - ob.cy) / (item.0.ry + ob.ry).max(1e-3);
            let close = dx * dx + dy * dy < 0.55;
            if !close {
                return false;
            }
            let a_tun = item.1 == VoidClass::Tunnel;
            let b_tun = *oc == VoidClass::Tunnel;
            if a_tun != b_tun {
                let aspect_a = (item.0.rx / item.0.ry.max(1e-3)).max(item.0.ry / item.0.rx.max(1e-3));
                let aspect_b = (ob.rx / ob.ry.max(1e-3)).max(ob.ry / ob.rx.max(1e-3));
                if (aspect_a >= 1.9) != (aspect_b >= 1.9) {
                    return false;
                }
            }
            true
        });
        if !overlaps {
            keep.push(item);
        }
    }
    keep
}

fn field_spread_ratio(intensity: f32) -> f32 {
    (0.35 + intensity.clamp(0.0, 1.0) * 0.5).clamp(0.35, 0.85)
}

/// Metal = ani renk geçişi / pozitif alan; kendi başına yapı değildir.
/// Önce oda/tünel/şaft bulunur; kırmızı yalnız yapı İÇİNE oturtulur.
pub fn attach_metal_to_structure(
    m: &mut MetalBody,
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    side: bool,
    depth_range_m: f32,
    map_w_m: f32,
    map_d_m: f32,
) {
    m.inside_chamber = false;
    m.host_kind.clear();
    m.plume_height_m = 0.0;
    m.field_strength = m.intensity.clamp(0.0, 1.0);

    let spread = field_spread_ratio(m.intensity);

    // --- 1) Oda / mezar / şaft kesişimi ---
    let mut best_chamber: Option<(f32, &Chamber)> = None;
    for c in chambers {
        let hit = structure_metal_plan_hit(m, c, side);
        if !hit {
            continue;
        }
        let dx = (m.cx - c.cx).abs() / c.rx.max(1e-4);
        let score = if side {
            dx
        } else {
            let dy = (m.cy - c.cy).abs() / c.ry.max(1e-4);
            (dx * dx + dy * dy).sqrt()
        };
        if best_chamber.map(|(bd, _)| score < bd).unwrap_or(true) {
            best_chamber = Some((score, c));
        }
    }

    // --- 2) Tünel kesişimi ---
    let mut best_tunnel: Option<(f32, &Tunnel)> = None;
    {
        let half_w = (2.8 / map_w_m.max(1.0)).max(0.03);
        for t in tunnels {
            let dist = point_to_segment(m.cx, m.cy, t.x0, t.y0, t.x1, t.y1);
            let lim = if side {
                (t.width_m / map_w_m.max(1.0) * 1.1)
                    .max(half_w)
                    .max(m.rx * 1.6)
                    .clamp(0.1, 0.38)
            } else {
                half_w.max(t.radius * 3.5).max(m.rx)
            };
            if dist <= lim {
                if best_tunnel.map(|(bd, _)| dist < bd).unwrap_or(true) {
                    best_tunnel = Some((dist, t));
                }
            }
        }
    }

    // --- 3) Yakın yapıya yumuşak çekim (yan: X+Y — ters taraf lobunu çekme) ---
    if best_chamber.is_none() && best_tunnel.is_none() {
        if let Some(c) = chambers.iter().min_by(|a, b| {
            let da = if side {
                (m.cx - a.cx).abs() + (m.cy - a.cy).abs() * 0.85
            } else {
                (m.cx - a.cx).abs()
            };
            let db = if side {
                (m.cx - b.cx).abs() + (m.cy - b.cy).abs() * 0.85
            } else {
                (m.cx - b.cx).abs()
            };
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        }) {
            let reach_x = (c.rx + m.rx).max(0.06) + if side { 0.18 } else { 0.14 };
            let y_ok = !side || (m.cy - c.cy).abs() <= (c.ry + m.ry).max(0.04) + 0.12;
            if (m.cx - c.cx).abs() <= reach_x && y_ok {
                best_chamber = Some(((m.cx - c.cx).abs(), c));
            }
        }
        if let Some(t) = tunnels.iter().min_by(|a, b| {
            let da = point_to_segment(m.cx, m.cy, a.x0, a.y0, a.x1, a.y1);
            let db = point_to_segment(m.cx, m.cy, b.x0, b.y0, b.x1, b.y1);
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        }) {
            let dist = point_to_segment(m.cx, m.cy, t.x0, t.y0, t.x1, t.y1);
            if dist <= if side { 0.28 } else { 0.2 } {
                best_tunnel = Some((dist, t));
            }
        }
    }

    // Host seçimi: şaft/oda/tünel — hangisi yakınsa içine; kırmızı yapı değil
    let elong = (m.rx / m.ry.max(1e-3)).max(m.ry / m.rx.max(1e-3));
    let prefer_tunnel = best_tunnel.is_some()
        && (best_chamber.is_none()
            || (elong >= 1.6
                && best_tunnel.map(|(d, _)| d).unwrap_or(1.0)
                    <= best_chamber.map(|(d, _)| d).unwrap_or(1.0) * 1.2)
            || best_chamber
                .map(|(_, c)| c.kind == "shaft" && elong >= 1.8)
                .unwrap_or(false));

    if prefer_tunnel {
        if let Some((_, t)) = best_tunnel {
            attach_metal_into_tunnel(m, t, side, depth_range_m, map_w_m, map_d_m, spread);
            stamp_intersect_label(m, "tünel içi");
            return;
        }
    }

    if let Some((_, c)) = best_chamber {
        attach_metal_into_chamber(m, c, side, depth_range_m, spread);
        stamp_intersect_label(m, &format!("{} içi", c.kind));
        return;
    }

    if let Some((_, t)) = best_tunnel {
        attach_metal_into_tunnel(m, t, side, depth_range_m, map_w_m, map_d_m, spread);
        stamp_intersect_label(m, "tünel içi");
        return;
    }

    // Host yok → yapı sayma; çizilmeyecek kadar küçült / işaretle
    m.inside_chamber = false;
    m.host_kind.clear();
    m.spread_ratio = 0.0;
    m.spread_m = 0.15;
    m.plume_height_m = 0.12;
    m.width_m = 0.2;
    m.length_m = 0.2;
    m.size_m = 0.2;
    m.field_strength = m.intensity.clamp(0.0, 1.0);
    m.geometry.method = "red_orphan_not_structure".into();
    m.geometry.label = "kırmızı (yapı değil · host yok)".into();
}

fn stamp_intersect_label(m: &mut MetalBody, kind: &str) {
    if m.geometry.label.is_empty() {
        m.geometry.label = format!("yapı × kırmızı · {kind}");
    } else if !m.geometry.label.contains("kesişim") {
        m.geometry.label = format!("{} · {kind}", m.geometry.label);
    }
    if m.geometry.method.is_empty() || m.geometry.method.starts_with("red_") {
        m.geometry.method = "structure_intersect".into();
    }
}

fn structure_metal_plan_hit(m: &MetalBody, c: &Chamber, side: bool) -> bool {
    if side {
        // Yan: X+Y örtüşmesi — karşı lob (ters taraf) dipol kırmızısını yapıya yapıştırma
        let reach_x = (c.rx + m.rx).max(0.04) * 1.75 + 0.1;
        let reach_y = (c.ry + m.ry).max(0.03) * 2.1 + 0.06;
        (m.cx - c.cx).abs() <= reach_x && (m.cy - c.cy).abs() <= reach_y
    } else {
        let dx = (m.cx - c.cx) / (c.rx + m.rx * 0.5).max(1e-4);
        let dy = (m.cy - c.cy) / (c.ry + m.ry * 0.5).max(1e-4);
        let lim = if c.kind == "shaft" { 1.85 } else { 1.55 };
        dx * dx + dy * dy <= lim * lim
    }
}

fn attach_metal_into_chamber(
    m: &mut MetalBody,
    c: &Chamber,
    side: bool,
    depth_range_m: f32,
    spread: f32,
) {
    m.inside_chamber = true;
    m.host_kind = c.kind.clone();
    m.spread_ratio = spread;
    m.field_strength = m.intensity.clamp(0.0, 1.0);

    let top = c.top_from_surface_m;
    let bot = c.bottom_from_surface_m;
    let mid = (top + bot) * 0.5;
    // Derinlik her zaman yapı bandına oturt (görüntü Y değil)
    m.depth_from_surface_m = mid.clamp(top + 0.08, (bot - 0.05).max(top + 0.15));

    if side {
        // Plan konum = haritadaki kırmızı ayakizi (merkeze çekme — boyanın altına otursun)
        m.width_m = m.width_m.min(c.width_m * 0.88).clamp(0.3, c.width_m.max(0.4));
        m.length_m = m
            .length_m
            .min(c.length_m.max(0.5) * 0.9)
            .clamp(0.25, c.length_m.max(0.5).min(1.8));
        m.plume_height_m = (c.height_m * 0.48).clamp(0.35, c.height_m * 0.75);
        m.spread_m = m.width_m.max(m.length_m).max(m.plume_height_m) * 0.45;
    } else if c.kind == "shaft" {
        let diam = (c.width_m.min(c.length_m) * spread).clamp(0.4, c.width_m);
        m.width_m = diam;
        m.length_m = diam;
        m.spread_m = diam * 0.5;
        m.plume_height_m = (c.height_m * (0.4 + spread * 0.35)).clamp(1.2, c.height_m);
        m.depth_from_surface_m = mid.clamp(top + 0.15, bot);
    } else {
        m.width_m = (c.width_m * spread).clamp(0.45, c.width_m.max(0.5));
        m.length_m = (c.length_m * spread).clamp(0.45, c.length_m.max(0.5));
        m.spread_m = m.width_m.max(m.length_m) * 0.5;
        m.plume_height_m = (c.height_m * 0.4).clamp(0.4, c.height_m * 0.65);
        m.depth_from_surface_m =
            (bot - m.plume_height_m * 0.3).clamp(top + 0.15, bot);
    }
    m.size_m = m.width_m.min(m.length_m);
    m.depth = (m.depth_from_surface_m / depth_range_m).clamp(0.02, 0.95);
}

fn attach_metal_into_tunnel(
    m: &mut MetalBody,
    t: &Tunnel,
    side: bool,
    depth_range_m: f32,
    map_w_m: f32,
    map_d_m: f32,
    spread: f32,
) {
    m.inside_chamber = true;
    m.host_kind = "tunnel".into();
    m.spread_ratio = spread;
    m.field_strength = m.intensity.clamp(0.0, 1.0);
    let seg_len = {
        let dx = (t.x1 - t.x0) * map_w_m;
        let dy = (t.y1 - t.y0) * map_d_m;
        (dx * dx + dy * dy).sqrt().max(1.0)
    };
    let crown = t.crown_from_surface_m;
    let floor = t.floor_from_surface_m;
    if side {
        // Tünel içi kırmızı anomali — koridoru dolduran büyük kutu değil
        let w_hi = (t.width_m * 0.7).max(0.35);
        let l_hi = (seg_len * 0.4).max(0.45);
        m.width_m = (m.width_m * 0.5).clamp(0.25, w_hi);
        m.length_m = (m.length_m * 0.55).clamp(0.25, l_hi);
        m.spread_m = m.width_m.max(m.length_m) * 0.5;
        m.plume_height_m = (t.height_m * 0.42).clamp(0.3, t.height_m.max(0.35));
        m.bearing_deg = t.bearing_deg;
        // Plan konum = haritadaki kırmızı (eksen ortasına çekme)
        let mid = (crown + floor) * 0.5;
        m.depth_from_surface_m = mid.clamp(crown + 0.05, floor);
    } else {
        m.length_m = (seg_len * (0.35 + spread * 0.4)).clamp(1.0, seg_len);
        m.width_m = (t.width_m * 0.6).clamp(0.4, t.width_m);
        m.spread_m = m.length_m * 0.5;
        m.plume_height_m = (t.height_m * 0.4).clamp(0.35, t.height_m * 0.6);
        m.bearing_deg = t.bearing_deg;
        m.depth_from_surface_m = ((crown + floor) * 0.55).clamp(crown + 0.1, floor);
    }
    m.size_m = m.width_m.min(m.length_m);
    m.depth = (m.depth_from_surface_m / depth_range_m).clamp(0.02, 0.95);
}

fn point_to_segment(px: f32, py: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len2 = dx * dx + dy * dy;
    if len2 < 1e-12 {
        return ((px - x0).powi(2) + (py - y0).powi(2)).sqrt();
    }
    let t = (((px - x0) * dx + (py - y0) * dy) / len2).clamp(0.0, 1.0);
    let qx = x0 + t * dx;
    let qy = y0 + t * dy;
    ((px - qx).powi(2) + (py - qy).powi(2)).sqrt()
}

pub fn dedupe_metals(metals: Vec<MetalBody>, _chambers: &[Chamber]) -> Vec<MetalBody> {
    let mut metals = metals;
    metals.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut keep = Vec::new();
    for m in metals {
        let overlaps = keep.iter().any(|o: &MetalBody| {
            let dx = (m.cx - o.cx) / (m.rx + o.rx).max(1e-3);
            let dy = (m.cy - o.cy) / (m.ry + o.ry).max(1e-3);
            dx * dx + dy * dy < 0.4
        });
        if !overlaps {
            keep.push(m);
        }
    }
    keep
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surface::Evidence;

    fn sample_metal(cx: f32, cy: f32, rx: f32, ry: f32) -> MetalBody {
        MetalBody {
            cx,
            cy,
            rx,
            ry,
            depth: cy,
            intensity: 0.7,
            width_m: rx * 2.0 * 24.0,
            length_m: ry * 2.0 * 10.0,
            size_m: 1.0,
            depth_from_surface_m: cy * 3.0,
            inside_chamber: false,
            host_kind: String::new(),
            spread_m: 1.0,
            spread_ratio: 1.0,
            field_strength: 0.7,
            bearing_deg: 0.0,
            plume_height_m: 0.8,
            cue_kind: "metal".into(),
            metal_guess: "iron".into(),
            confidence: 0.7,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
        }
    }

    #[test]
    fn side_adjacent_rooms_get_geo_link_tunnel() {
        let a = Chamber {
            kind: "room".into(),
            cx: 0.35,
            cy: 0.42,
            rx: 0.08,
            ry: 0.07,
            depth: 0.3,
            height: 0.2,
            intensity: 0.7,
            width_m: 3.0,
            length_m: 1.2,
            top_from_surface_m: 0.3,
            bottom_from_surface_m: 2.3,
            height_m: 2.0,
            bearing_deg: 0.0,
            confidence: 0.9,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        };
        let mut b = a.clone();
        b.cx = 0.55;
        b.cy = 0.43;
        // Zayıf void path (çoğu sıfır) — geo_link yine bağlasın
        let signed = vec![0.0f32; 64];
        let (tunnels, _) =
            link_chambers_with_path(&signed, 8, 8, &[a, b], 0.2, 10.0, 0.45, true, true);
        assert!(
            !tunnels.is_empty(),
            "yan yana odalar path zayıfken de tünelle bağlanmalı"
        );
        assert!(tunnels[0].geometry.method.contains("geo") || tunnels[0].confidence >= 0.4);
    }

    #[test]
    fn side_link_across_red_corridor_counts_path() {
        // 8x8 grid: solda/sağda mavi, ortada kırmızı dolgu
        let mut signed = vec![0.0f32; 64];
        for y in 3..5 {
            for x in 0..3 {
                signed[y * 8 + x] = -0.5;
            }
            for x in 3..5 {
                signed[y * 8 + x] = 0.6; // kırmızı — path'i KESMEMELİ
            }
            for x in 5..8 {
                signed[y * 8 + x] = -0.5;
            }
        }
        let a = Chamber {
            kind: "room".into(),
            cx: 0.18,
            cy: 0.45,
            rx: 0.1,
            ry: 0.08,
            depth: 0.3,
            height: 0.2,
            intensity: 0.7,
            width_m: 2.5,
            length_m: 1.2,
            top_from_surface_m: 0.4,
            bottom_from_surface_m: 2.4,
            height_m: 2.0,
            bearing_deg: 0.0,
            confidence: 0.9,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        };
        let mut b = a.clone();
        b.cx = 0.82;
        let (tunnels, _) =
            link_chambers_with_path(&signed, 8, 8, &[a, b], 0.2, 10.0, 0.45, true, true);
        assert!(
            !tunnels.is_empty(),
            "kırmızı dolgulu koridorda oda-oda tüneli çizilmeli"
        );
    }

    #[test]
    fn side_red_boxes_do_not_become_giant_tunnels() {
        let metals = vec![
            sample_metal(0.55, 0.55, 0.06, 0.05),
            sample_metal(0.68, 0.56, 0.055, 0.048),
            sample_metal(0.80, 0.54, 0.06, 0.05),
        ];
        let mut tunnels = Vec::new();
        promote_side_red_corridors(&metals, &mut tunnels, &[], 24.0, 10.0, 10.0, 0.35);
        assert!(
            tunnels.is_empty(),
            "kırmızı yapı değildir — tünel üretmemeli, got {}",
            tunnels.len()
        );
    }

    #[test]
    fn side_red_attaches_inside_room_not_as_structure() {
        let room = Chamber {
            kind: "room".into(),
            cx: 0.45,
            cy: 0.4,
            rx: 0.1,
            ry: 0.08,
            depth: 0.3,
            height: 0.2,
            intensity: 0.7,
            width_m: 3.5,
            length_m: 1.4,
            top_from_surface_m: 0.35,
            bottom_from_surface_m: 2.5,
            height_m: 2.15,
            bearing_deg: 0.0,
            confidence: 0.85,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        };
        let mut tunnels = Vec::new();
        let metals = vec![sample_metal(0.48, 0.42, 0.05, 0.04)];
        promote_side_red_corridors(&metals, &mut tunnels, &[room.clone()], 24.0, 10.0, 10.0, 0.35);
        assert!(tunnels.is_empty(), "kırmızıdan tünel üretilmemeli");
        let mut m = metals[0].clone();
        let cx0 = m.cx;
        let cy0 = m.cy;
        attach_metal_to_structure(&mut m, &[room.clone()], &[], true, 10.0, 24.0, 10.0);
        assert!(m.inside_chamber, "kırmızı oda içine oturmalı");
        assert_eq!(m.host_kind, "room");
        assert!(
            (m.cx - cx0).abs() < 1e-4 && (m.cy - cy0).abs() < 1e-4,
            "plan konum haritadaki kırmızıda kalmalı, moved to ({}, {})",
            m.cx,
            m.cy
        );
    }

    #[test]
    fn side_red_intersects_room_and_snaps_depth() {
        let room = Chamber {
            kind: "room".into(),
            cx: 0.5,
            cy: 0.4,
            rx: 0.12,
            ry: 0.1,
            depth: 0.3,
            height: 0.2,
            intensity: 0.7,
            width_m: 4.0,
            length_m: 1.5,
            top_from_surface_m: 0.8,
            bottom_from_surface_m: 2.6,
            height_m: 1.8,
            bearing_deg: 0.0,
            confidence: 0.8,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        };
        let mut m = sample_metal(0.52, 0.7, 0.08, 0.06);
        m.depth_from_surface_m = 8.0; // yanlış bağımsız derinlik
        attach_metal_to_structure(&mut m, &[room], &[], true, 10.0, 24.0, 10.0);
        assert!(m.inside_chamber, "kırmızı odaya kesişmeli");
        assert_eq!(m.host_kind, "room");
        assert!(
            m.depth_from_surface_m >= 0.8 && m.depth_from_surface_m <= 2.6,
            "derinlik oda bandına oturmalı, got {}",
            m.depth_from_surface_m
        );
    }

    #[test]
    fn tunnel_floor_aligns_to_nearby_room_floor() {
        let room = Chamber {
            kind: "room".into(),
            cx: 0.62,
            cy: 0.4,
            rx: 0.1,
            ry: 0.12,
            depth: 0.4,
            height: 0.25,
            intensity: 0.7,
            width_m: 3.5,
            length_m: 1.4,
            top_from_surface_m: 0.6,
            bottom_from_surface_m: 2.4,
            height_m: 1.8,
            bearing_deg: 0.0,
            confidence: 0.8,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        };
        let mut tunnels = vec![Tunnel {
            x0: 0.35,
            y0: 0.4,
            x1: 0.55,
            y1: 0.4,
            radius: 0.02,
            depth: 0.2,
            bearing_deg: 90.0,
            direction: "D-B".into(),
            heading: "D".into(),
            width_m: 1.2,
            floor_from_surface_m: 1.2,
            crown_from_surface_m: 0.4,
            height_m: 0.8,
            confidence: 0.7,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        }];
        align_tunnel_floors_to_rooms(&mut tunnels, &[room], true, 10.0);
        assert!(
            (tunnels[0].floor_from_surface_m - 2.4).abs() < 0.05,
            "tunnel floor should match room floor 2.4, got {}",
            tunnels[0].floor_from_surface_m
        );
        assert!(
            tunnels[0].height_m > 1.5,
            "raised crown should grow volume, h={}",
            tunnels[0].height_m
        );
        assert!(
            tunnels[0].crown_from_surface_m <= 0.65,
            "crown toward surface, got {}",
            tunnels[0].crown_from_surface_m
        );
    }
}

/// Corridor/standard profili (votex_prob `link_rooms` / `decide_metals`) ile legacy
/// `link_chambers_with_path` / `attach_metal_to_structure` karşılaştırma testleri.
///
/// Parite iddiası: VPE **standard** profili legacy ile bit düzeyinde aynıdır (legacy =
/// VPE çevrimdışıyken devreye giren yedek motor). Corridor profili legacy'de yoktur —
/// tek farkı belgelenmiş genişletmelerdir: d_max 0.72→0.78, path_need 0.12→0.08,
/// geo_link toleransları (+0.16→+0.2, 0.48→0.55, 0.34→0.38, 0.65→0.7) ve metal
/// host yarıçapı +0.04→+0.08. Bu testler o genişletmeleri tam değerleriyle sabitler.
#[cfg(test)]
mod parity_tests {
    use super::*;
    use std::collections::HashMap;
    use votex_prob::decide::{link::link_rooms, metal::decide_metals, RoomSlot};
    use votex_prob::schema::{BlobDto, LinkDecision, PairPath};

    const THR: f32 = 0.2;

    fn chamber(cx: f32, cy: f32) -> Chamber {
        Chamber {
            kind: "room".into(),
            cx,
            cy,
            rx: 0.08,
            ry: 0.07,
            depth: 0.3,
            height: 0.2,
            intensity: 0.7,
            width_m: 3.0,
            length_m: 1.2,
            top_from_surface_m: 0.5,
            bottom_from_surface_m: 3.0,
            height_m: 2.5,
            bearing_deg: 0.0,
            confidence: 0.9,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        }
    }

    fn slot(id: &str, cx: f32, cy: f32) -> RoomSlot {
        RoomSlot {
            id: id.into(),
            cx,
            cy,
            rx: 0.08,
            ry: 0.07,
            width_m: 3.0,
            top: 0.5,
            bottom: 3.0,
            height_m: 2.5,
            intensity: 0.7,
        }
    }

    fn metal_dto(cx: f32, cy: f32) -> BlobDto {
        BlobDto {
            id: "m0".into(),
            cx,
            cy,
            rx: 0.02,
            ry: 0.02,
            intensity: 0.7,
            fill_ratio: 0.55,
            aspect: 1.0,
            path_s: 0.0,
            wall_s: 0.0,
            line_s: 0.0,
            near_red: false,
            snr: 10.0,
            axis_aspect: 1.0,
            half_len: 0.01,
        }
    }

    fn legacy_metal(cx: f32, cy: f32) -> MetalBody {
        MetalBody {
            cx,
            cy,
            rx: 0.02,
            ry: 0.02,
            depth: cy,
            intensity: 0.7,
            width_m: 0.96,
            length_m: 0.4,
            size_m: 0.4,
            depth_from_surface_m: cy * 3.0,
            inside_chamber: false,
            host_kind: String::new(),
            spread_m: 0.4,
            spread_ratio: 1.0,
            field_strength: 0.7,
            bearing_deg: 0.0,
            plume_height_m: 0.5,
            cue_kind: "metal".into(),
            metal_guess: "iron".into(),
            confidence: 0.7,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
        }
    }

    /// w×h alan; y0..y1 satırları mavi koridor. `red_gap` → ortada kırmızı dolgu
    /// (corridor path fonksiyonu kırmızıyı KESMEZ sayar — legacy yan moduyla aynı).
    fn field(w: u32, h: u32, y0: u32, y1: u32, red_gap: bool) -> Vec<f32> {
        let mut s = vec![0.0f32; (w * h) as usize];
        for y in y0..y1 {
            for x in 0..w {
                s[(y * w + x) as usize] = -0.6;
            }
        }
        if red_gap {
            for y in y0..y1 {
                for x in (w / 2 - 1)..=(w / 2 + 1) {
                    s[(y * w + x) as usize] = 0.6;
                }
            }
        }
        s
    }

    /// VPE link sonuçlarını (id → koordinat çözümlemesiyle) legacy tünel uçlarıyla
    /// aynı anahtar biçimine getir: (uçA, uçB, conf, method), uçlar x'e göre sıralı.
    fn vpe_keys(links: &[LinkDecision], slots: &[RoomSlot]) -> Vec<((f32, f32), (f32, f32), f32, String)> {
        let pos: HashMap<&str, (f32, f32)> = slots
            .iter()
            .map(|s| (s.id.as_str(), (s.cx, s.cy)))
            .collect();
        links
            .iter()
            .map(|l| {
                let a = pos[l.a_id.as_str()];
                let b = pos[l.b_id.as_str()];
                let (p, q) = if a.0 < b.0 { (a, b) } else { (b, a) };
                (p, q, l.conf, l.method.clone())
            })
            .collect()
    }

    fn legacy_keys(tunnels: &[Tunnel]) -> Vec<((f32, f32), (f32, f32), f32, String)> {
        tunnels
            .iter()
            .map(|t| {
                let a = (t.x0, t.y0);
                let b = (t.x1, t.y1);
                let (p, q) = if a.0 < b.0 { (a, b) } else { (b, a) };
                (p, q, t.confidence, t.geometry.method.clone())
            })
            .collect()
    }

    fn sort_keys(keys: &mut [((f32, f32), (f32, f32), f32, String)]) {
        keys.sort_by(|a, b| {
            (a.0 .0, a.0 .1, a.1 .0)
                .partial_cmp(&(b.0 .0, b.0 .1, b.1 .0))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    fn assert_same_links(
        legacy: &[((f32, f32), (f32, f32), f32, String)],
        vpe: &[((f32, f32), (f32, f32), f32, String)],
    ) {
        let mut l = legacy.to_vec();
        let mut v = vpe.to_vec();
        sort_keys(&mut l);
        sort_keys(&mut v);
        assert_eq!(l.len(), v.len(), "link sayısı: legacy={legacy:?} vpe={vpe:?}");
        for (a, b) in l.iter().zip(v.iter()) {
            assert!(
                (a.0 .0 - b.0 .0).abs() < 1e-4 && (a.0 .1 - b.0 .1).abs() < 1e-4,
                "uç A: {a:?} vs {b:?}"
            );
            assert!(
                (a.1 .0 - b.1 .0).abs() < 1e-4 && (a.1 .1 - b.1 .1).abs() < 1e-4,
                "uç B: {a:?} vs {b:?}"
            );
            assert!((a.2 - b.2).abs() < 1e-4, "conf: {a:?} vs {b:?}");
            assert_eq!(a.3, b.3, "method: {a:?} vs {b:?}");
        }
    }

    /// VPE standard (corridor=false) yan modda legacy ile bit düzeyinde aynı linkler.
    /// 3 oda: iki yakın çift geo_link (side_geo_link), uzak çift path_link.
    #[test]
    fn link_standard_matches_legacy_side() {
        let w = 16u32;
        let h = 8u32;
        let signed = field(w, h, 3, 5, false);
        let rooms = [
            chamber(0.25, 0.42),
            chamber(0.52, 0.43),
            chamber(0.80, 0.42),
        ];
        let (tunnels, _) =
            link_chambers_with_path(&signed, w, h, &rooms, THR, 10.0, 0.35, true, false);

        let slots: Vec<RoomSlot> = rooms
            .iter()
            .enumerate()
            .map(|(i, c)| slot(&format!("v{i}"), c.cx, c.cy))
            .collect();
        let mut pairs = Vec::new();
        for i in 0..slots.len() {
            for j in (i + 1)..slots.len() {
                let a = &slots[i];
                let b = &slots[j];
                let path = path_corridor_support(&signed, w, h, a.cx, a.cy, b.cx, b.cy, THR);
                pairs.push(PairPath {
                    a_id: a.id.clone(),
                    b_id: b.id.clone(),
                    path_s: path,
                });
            }
        }
        let links = link_rooms(&slots, true, 10.0, 0.35, false, false, &pairs);
        assert_same_links(&legacy_keys(&tunnels), &vpe_keys(&links, &slots));
    }

    /// VPE standard dik modda legacy ile aynı linkler (path_need 0.58, void path).
    #[test]
    fn link_standard_matches_legacy_top() {
        let w = 16u32;
        let h = 8u32;
        let signed = field(w, h, 3, 5, false);
        let rooms = [
            chamber(0.30, 0.36),
            chamber(0.52, 0.38),
            chamber(0.72, 0.35),
        ];
        let (tunnels, _) =
            link_chambers_with_path(&signed, w, h, &rooms, THR, 10.0, 0.35, false, false);

        let slots: Vec<RoomSlot> = rooms
            .iter()
            .enumerate()
            .map(|(i, c)| slot(&format!("v{i}"), c.cx, c.cy))
            .collect();
        let mut pairs = Vec::new();
        for i in 0..slots.len() {
            for j in (i + 1)..slots.len() {
                let a = &slots[i];
                let b = &slots[j];
                let path = path_void_support(&signed, w, h, a.cx, a.cy, b.cx, b.cy, THR);
                pairs.push(PairPath {
                    a_id: a.id.clone(),
                    b_id: b.id.clone(),
                    path_s: path,
                });
            }
        }
        let links = link_rooms(&slots, false, 10.0, 0.35, false, false, &pairs);
        assert_same_links(&legacy_keys(&tunnels), &vpe_keys(&links, &slots));
    }

    /// Corridor d_max 0.78 vs legacy 0.72: d≈0.75'te legacy (through_red dahil) reddeder,
    /// VPE standard reddeder, yalnızca corridor bağlar.
    #[test]
    fn corridor_extends_link_reach_beyond_legacy() {
        let w = 16u32;
        let h = 8u32;
        let signed = field(w, h, 3, 5, false);
        let rooms = [chamber(0.10, 0.50), chamber(0.85, 0.505)];
        let d = (0.75f32.powi(2) + 0.005f32.powi(2)).sqrt();
        assert!(d > 0.72 && d <= 0.78, "d={d} koridor aralığında olmalı");

        let (tunnels, _) =
            link_chambers_with_path(&signed, w, h, &rooms, THR, 10.0, 0.35, true, false);
        assert!(tunnels.is_empty(), "legacy side d_max 0.72 — 0.75'i reddetmeli");
        let (tunnels_tr, _) =
            link_chambers_with_path(&signed, w, h, &rooms, THR, 10.0, 0.35, true, true);
        assert!(tunnels_tr.is_empty(), "through_red d_max'i genişletmez");

        let slots: Vec<RoomSlot> = rooms
            .iter()
            .enumerate()
            .map(|(i, c)| slot(&format!("v{i}"), c.cx, c.cy))
            .collect();
        let path = path_corridor_support(&signed, w, h, 0.10, 0.50, 0.85, 0.505, THR);
        let pairs = vec![PairPath {
            a_id: "v0".into(),
            b_id: "v1".into(),
            path_s: path,
        }];
        let std_links = link_rooms(&slots, true, 10.0, 0.35, false, false, &pairs);
        assert!(std_links.is_empty(), "VPE standard da 0.72 ile reddeder");
        let corr_links = link_rooms(&slots, true, 10.0, 0.35, true, false, &pairs);
        assert_eq!(corr_links.len(), 1, "corridor 0.78 ile bağlar");
        assert_eq!(corr_links[0].a_id, "v0");
        assert_eq!(corr_links[0].b_id, "v1");
        assert_eq!(corr_links[0].method, "corridor");
        assert!((corr_links[0].conf - 0.85).abs() < 1e-4);
    }

    /// Corridor geo_link toleransları legacy'den geniş (adjacent x_gap 0.34→0.38):
    /// x_gap=0.36 + kırmızı dolgu — legacy path_link/conf 0.85 verirken corridor
    /// side_geo_link/conf 0.97 verir. Her ikisi de bağlar (yan modda path kırmızıyı sayar).
    #[test]
    fn corridor_geo_link_wider_than_legacy() {
        let w = 16u32;
        let h = 8u32;
        let signed = field(w, h, 3, 5, true);
        let rooms = [chamber(0.30, 0.42), chamber(0.82, 0.43)];
        let x_gap = 0.82 - 0.30 - 0.08 - 0.08;
        assert!(x_gap > 0.34 && x_gap <= 0.38, "x_gap={x_gap} corridor bandında");

        let (tunnels, _) =
            link_chambers_with_path(&signed, w, h, &rooms, THR, 10.0, 0.35, true, false);
        assert_eq!(tunnels.len(), 1, "legacy de bağlar (yan modda path kırmızıyı sayar)");
        assert_eq!(tunnels[0].geometry.method, "path_link");
        assert!((tunnels[0].confidence - 0.85).abs() < 1e-4);

        let slots: Vec<RoomSlot> = rooms
            .iter()
            .enumerate()
            .map(|(i, c)| slot(&format!("v{i}"), c.cx, c.cy))
            .collect();
        let path = path_corridor_support(&signed, w, h, 0.30, 0.42, 0.82, 0.43, THR);
        let pairs = vec![PairPath {
            a_id: "v0".into(),
            b_id: "v1".into(),
            path_s: path,
        }];
        let std_links = link_rooms(&slots, true, 10.0, 0.35, false, false, &pairs);
        assert_eq!(std_links.len(), 1, "VPE standard legacy ile aynı bağlar");
        assert_eq!(std_links[0].method, "path_link");
        assert!((std_links[0].conf - 0.85).abs() < 1e-4);
        let corr_links = link_rooms(&slots, true, 10.0, 0.35, true, false, &pairs);
        assert_eq!(corr_links.len(), 1);
        assert_eq!(corr_links[0].method, "side_geo_link");
        assert!((corr_links[0].conf - 0.97).abs() < 1e-4);
    }

    /// Metal soft-pull erişimi: standard (dik 0.14 + 0.10 taban = 0.24), corridor +0.04
    /// (0.28). dx 0.26 → standard drop, corridor attach — legacy'de corridor olmadığı için
    /// karşılaştırma legacy soft-pull (0.24) ile standard üzerinden yapılır.
    #[test]
    fn metal_host_reach_standard_vs_corridor() {
        let r = slot("r0", 0.5, 0.5);
        let m = metal_dto(0.76, 0.5); // merkezden 0.26
        let std_metal = decide_metals(&[m.clone()], &[r.clone()], &[], 0.35, false, false, 24.0);
        assert_eq!(std_metal[0].action, "drop", "standard soft-pull 0.24 < 0.26");
        let corr_metal = decide_metals(&[m.clone()], &[r.clone()], &[], 0.35, true, false, 24.0);
        assert_eq!(corr_metal[0].action, "attach", "corridor soft-pull 0.28 >= 0.26");
        assert_eq!(corr_metal[0].host_kind.as_deref(), Some("room"));
        assert_eq!(corr_metal[0].host_id.as_deref(), Some("r0"));
    }

    /// Kolay vaka uyumu: metal odanın içinde → hem legacy hem VPE standard host'a oturur
    /// (elips kesişimi 1.55: 0.02/0.09 = 0.22).
    #[test]
    fn metal_inside_room_attaches_in_both() {
        let c = chamber(0.5, 0.5);
        let mut m = legacy_metal(0.52, 0.5);
        attach_metal_to_structure(&mut m, &[c], &[], false, 10.0, 24.0, 10.0);
        assert_eq!(m.host_kind, "room", "legacy plan-hit içi metali host'a oturtur");

        let r = slot("r0", 0.5, 0.5);
        let md = metal_dto(0.52, 0.5);
        let vpe = decide_metals(&[md], &[r], &[], 0.35, false, false, 24.0);
        assert_eq!(vpe[0].action, "attach");
        assert_eq!(vpe[0].host_kind.as_deref(), Some("room"));
    }

    /// Sınır süpürmesi — dik mod: elips (0.1395) + soft-pull (0.24). Legacy ile VPE
    /// standard her mesafede AYNI kararı vermeli (attach ↔ host_kind dolu).
    #[test]
    fn metal_reach_matches_legacy_top() {
        let c = chamber(0.5, 0.5);
        let r = slot("r0", 0.5, 0.5);
        for dx in [0.05f32, 0.13, 0.15, 0.20, 0.26, 0.30] {
            let mut lm = legacy_metal(0.5 + dx, 0.5);
            attach_metal_to_structure(&mut lm, &[c.clone()], &[], false, 10.0, 24.0, 10.0);
            let legacy_attach = !lm.host_kind.is_empty();
            let vpe = decide_metals(
                &[metal_dto(0.5 + dx, 0.5)],
                &[r.clone()],
                &[],
                0.35,
                false,
                false,
                24.0,
            );
            assert_eq!(
                vpe[0].action == "attach",
                legacy_attach,
                "dx={dx}: legacy={legacy_attach} vpe={}",
                vpe[0].action
            );
        }
    }

    /// Sınır süpürmesi — yan mod: plan kutusu (0.275) + soft-pull (0.28).
    #[test]
    fn metal_reach_matches_legacy_side() {
        let c = chamber(0.5, 0.5);
        let r = slot("r0", 0.5, 0.5);
        for dx in [0.20f32, 0.27, 0.28, 0.30, 0.35] {
            let mut lm = legacy_metal(0.5 + dx, 0.5);
            attach_metal_to_structure(&mut lm, &[c.clone()], &[], true, 10.0, 24.0, 10.0);
            let legacy_attach = !lm.host_kind.is_empty();
            let vpe = decide_metals(
                &[metal_dto(0.5 + dx, 0.5)],
                &[r.clone()],
                &[],
                0.35,
                false,
                true,
                24.0,
            );
            assert_eq!(
                vpe[0].action == "attach",
                legacy_attach,
                "dx={dx}: legacy={legacy_attach} vpe={}",
                vpe[0].action
            );
        }
    }

    /// Küçük deterministik PRNG (xorshift64) — propertik karşılaştırma için.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            if self.0 == 0 {
                self.0 = 0x9E37_79B9_7F4A_7C15;
            }
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn unit(&mut self) -> f32 {
            ((self.next() >> 40) as f32) / (1u64 << 24) as f32
        }
        fn range(&mut self, lo: f32, hi: f32) -> f32 {
            lo + (hi - lo) * self.unit()
        }
    }

    /// VPE link geometrisiyle tutarlı legacy tüneli: genişlik = a.width_m.min(b.width_m)*0.55
    /// (tunnels_from_vpe_links ile aynı), radius 0.025.
    fn legacy_tunnel(a: &Chamber, b: &Chamber) -> Tunnel {
        Tunnel {
            x0: a.cx,
            y0: a.cy,
            x1: b.cx,
            y1: b.cy,
            radius: 0.025,
            depth: 0.3,
            bearing_deg: 0.0,
            direction: String::new(),
            heading: String::new(),
            width_m: (a.width_m.min(b.width_m) * 0.55).clamp(0.55, 2.2),
            floor_from_surface_m: 3.0,
            crown_from_surface_m: 0.5,
            height_m: 2.5,
            confidence: 0.8,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        }
    }

    /// Propertik karşılaştırma: binlerce rastgele oda/metal/tünel konfigürasyonunda VPE
    /// standard ile legacy AYNI kararı vermeli (attach/drop + host tipi). Deterministik
    /// seed — bir vaka tutarsa seed + konfigürasyon yazdırılıp birebir yeniden üretilir.
    ///
    /// Kapsam: yalnızca "room" odaları (VPE room_slots şaft içermez) ve VPE skor
    /// kapılarını (snr/margin/min_conf) her zaman geçen metaller — böylece karar yalnızca
    /// erişim modelinden gelir. Metal konumlarının %70'i rastgele bir odaya yakın üretilir
    /// (elips/kutu/soft-pull sınırları yoğun taranır), geri kalanı tamamen rastgele.
    #[test]
    fn metal_random_geometry_matches_legacy() {
        const SEED: u64 = 0x5EED_2026;
        const CASES: u64 = 3000;
        let mut rng = Rng(SEED);
        for side in [false, true] {
            for case in 0..CASES {
                let n_rooms = 1 + (rng.next() % 3) as usize;
                let mut chambers = Vec::new();
                let mut slots = Vec::new();
                for i in 0..n_rooms {
                    let cx = rng.range(0.15, 0.85);
                    let cy = rng.range(0.15, 0.85);
                    let rx = rng.range(0.04, 0.14);
                    let ry = rng.range(0.03, 0.12);
                    let width_m = (rx * 2.0 * 24.0).clamp(0.4, 24.0);
                    let mut c = chamber(cx, cy);
                    c.rx = rx;
                    c.ry = ry;
                    c.width_m = width_m;
                    c.length_m = (ry * 2.0 * 10.0).clamp(0.5, 10.0);
                    let mut s = slot(&format!("r{i}"), cx, cy);
                    s.rx = rx;
                    s.ry = ry;
                    s.width_m = width_m;
                    chambers.push(c);
                    slots.push(s);
                }

                let mut links: Vec<LinkDecision> = Vec::new();
                let mut legacy_tunnels: Vec<Tunnel> = Vec::new();
                if n_rooms >= 2 && rng.unit() < 0.35 {
                    let i = (rng.next() % n_rooms as u64) as usize;
                    let j = (i + 1 + (rng.next() % (n_rooms - 1) as u64) as usize) % n_rooms;
                    links.push(LinkDecision {
                        a_id: format!("r{i}"),
                        b_id: format!("r{j}"),
                        conf: 0.8,
                        method: "path_link".into(),
                    });
                    legacy_tunnels.push(legacy_tunnel(&chambers[i], &chambers[j]));
                }

                let n_metals = 1 + (rng.next() % 3) as usize;
                for _ in 0..n_metals {
                    let m_rx = rng.range(0.008, 0.05);
                    let m_ry = rng.range(0.008, 0.05);
                    let intensity = rng.range(0.5, 0.9);
                    let fill = rng.range(0.4, 0.8);
                    let (mx, my) = if rng.unit() < 0.7 {
                        let r = &slots[(rng.next() % n_rooms as u64) as usize];
                        (
                            (r.cx + rng.range(-0.35, 0.35)).clamp(0.0, 1.0),
                            (r.cy + rng.range(-0.35, 0.35)).clamp(0.0, 1.0),
                        )
                    } else {
                        (rng.range(0.05, 0.95), rng.range(0.05, 0.95))
                    };

                    let mut lm = legacy_metal(mx, my);
                    lm.rx = m_rx;
                    lm.ry = m_ry;
                    lm.intensity = intensity;
                    attach_metal_to_structure(
                        &mut lm,
                        &chambers,
                        &legacy_tunnels,
                        side,
                        10.0,
                        24.0,
                        10.0,
                    );
                    let legacy_attach = !lm.host_kind.is_empty();
                    let legacy_kind = lm.host_kind.clone();

                    let mut md = metal_dto(mx, my);
                    md.rx = m_rx;
                    md.ry = m_ry;
                    md.intensity = intensity;
                    md.fill_ratio = fill;
                    md.aspect = (m_rx / m_ry.max(1e-3)).max(m_ry / m_rx.max(1e-3));
                    let vpe = decide_metals(&[md], &slots, &links, 0.35, false, side, 24.0);
                    let vpe_attach = vpe[0].action == "attach";
                    let vpe_kind = vpe[0].host_kind.clone().unwrap_or_default();

                    if vpe_attach != legacy_attach || (vpe_attach && vpe_kind != legacy_kind) {
                        panic!(
                            "metal parite tutarsız — side={side} case={case} seed={SEED:#x}\n\
                             metal=({mx}, {my}) r=({m_rx}, {m_ry}) int={intensity} fill={fill}\n\
                             legacy={legacy_attach}/{legacy_kind} vpe={vpe_attach}/{vpe_kind}\n\
                             rooms={slots:?} links={links:?}"
                        );
                    }
                }
            }
        }
    }
}

