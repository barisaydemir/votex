//! L5 oda–oda bağlantı.

use crate::decide::RoomSlot;
use crate::schema::{LinkDecision, PairPath};

pub fn link_rooms(
    rooms: &[RoomSlot],
    side: bool,
    depth_range_m: f32,
    min_confidence: f32,
    corridor: bool,
    through_red: bool,
    pair_paths: &[PairPath],
) -> Vec<LinkDecision> {
    let mut out = Vec::new();
    let d_min = if side { 0.04 } else { 0.1 };
    let d_max = if side {
        if corridor {
            0.78
        } else {
            0.72
        }
    } else {
        0.45
    };
    // Parite notu (link zinciri denetimi): legacy link_chambers_with_path eşiği
    // `if side || through_red { 0.12 } else { 0.58 }` — kırmızı dolgu path'i kesmez,
    // dik + through_red'de de gevşetilir. Port bu dalı kaçırıyordu (yalnızca side'a
    // bakıyordu): dik + through_red'de 0.58 istiyordu → 0.12..0.58 arası path'li
    // odalar bağlanmıyordu. Corridor yalnızca yanda daha da gevşetir (VPE'ye özgü).
    let path_need = if side || through_red {
        if corridor && side {
            0.08
        } else {
            0.12
        }
    } else {
        0.58
    };

    for i in 0..rooms.len() {
        let mut best: Option<(usize, f32, f32, bool)> = None;
        for j in 0..rooms.len() {
            if i == j {
                continue;
            }
            let a = &rooms[i];
            let b = &rooms[j];
            let dx = a.cx - b.cx;
            let dy = a.cy - b.cy;
            let d = (dx * dx + dy * dy).sqrt();
            if d < d_min || d > d_max {
                continue;
            }
            if side {
                let ya = (a.top + a.bottom) * 0.5;
                let yb = (b.top + b.bottom) * 0.5;
                if (ya - yb).abs() > depth_range_m * 0.55 {
                    continue;
                }
            }
            let path = pair_path_lookup(pair_paths, &a.id, &b.id).unwrap_or(0.0);
            let geo_link = if side {
                let x_gap = (a.cx - b.cx).abs() - a.rx - b.rx;
                let y_ov = (a.cy - b.cy).abs() <= (a.ry + b.ry).max(0.05) + if corridor { 0.2 } else { 0.16 };
                let floors_ok = (a.bottom - b.bottom).abs() <= depth_range_m * if corridor { 0.55 } else { 0.5 };
                let close = d <= if corridor { 0.55 } else { 0.48 } && floors_ok;
                let adjacent = x_gap <= if corridor { 0.38 } else { 0.34 }
                    && x_gap >= -0.12
                    && y_ov
                    && floors_ok
                    && d <= if corridor { 0.7 } else { 0.65 };
                close || adjacent
            } else {
                false
            };
            if path < path_need && !geo_link {
                continue;
            }
            let score_d = if geo_link && path < path_need { d * 0.9 } else { d };
            if best.map(|(_, bd, _, _)| score_d < bd).unwrap_or(true) {
                best = Some((j, score_d, path.max(if geo_link { 0.55 } else { 0.0 }), geo_link));
            }
        }
        if let Some((j, _d, path, geo_link)) = best {
            if i > j {
                continue;
            }
            let a = &rooms[i];
            let b = &rooms[j];
            let conf = (0.35 + path * 0.5 + if geo_link { 0.12 } else { 0.0 }).clamp(0.0, 1.0);
            if conf < (min_confidence - if side { 0.14 } else { 0.0 }).max(0.22) {
                continue;
            }
            let already = out.iter().any(|t: &LinkDecision| {
                (t.a_id == a.id && t.b_id == b.id) || (t.a_id == b.id && t.b_id == a.id)
            });
            if already {
                continue;
            }
            out.push(LinkDecision {
                a_id: a.id.clone(),
                b_id: b.id.clone(),
                conf,
                method: if geo_link {
                    "side_geo_link".into()
                } else if corridor {
                    "corridor".into()
                } else {
                    "path_link".into()
                },
            });
        }
    }
    out
}

fn pair_path_lookup(paths: &[PairPath], a: &str, b: &str) -> Option<f32> {
    paths.iter().find_map(|p| {
        if (p.a_id == a && p.b_id == b) || (p.a_id == b && p.b_id == a) {
            Some(p.path_s)
        } else {
            None
        }
    })
}
