//! L5 metal host kararı — legacy `validate::attach_metal_to_structure` erişim modeliyle
//! hizalı: dik modda elips (lim 1.55), yan modda kutu plan kesişimi + soft-pull.
//! Corridor profili yalnızca soft-pull erişimini +0.04 genişletir (kırmızı odaya
//! daha kolay oturur); plan kesişimi her profilde aynıdır (legacy'de corridor yoktur).

use crate::decide::RoomSlot;
use crate::schema::{BlobDto, LinkDecision, MetalDecision};

pub fn decide_metals(
    metals: &[BlobDto],
    rooms: &[RoomSlot],
    links: &[LinkDecision],
    min_conf: f32,
    corridor: bool,
    side: bool,
    map_w_m: f32,
) -> Vec<MetalDecision> {
    let mut out = Vec::new();
    for m in metals {
        let snr = if m.snr > 0.0 {
            m.snr
        } else {
            m.intensity / 0.06
        };
        if snr < 1.4 {
            out.push(drop(m, 0.0));
            continue;
        }
        let aspect = m
            .aspect
            .max((m.rx / m.ry.max(1e-3)).max(m.ry / m.rx.max(1e-3)));
        let mut score_metal = 0.35 + m.intensity * 0.45 + m.fill_ratio * 0.2;
        if aspect > 2.4 {
            score_metal -= 0.2;
        }
        let score_noise = (1.1 - m.intensity).max(0.0) * 0.5;
        let margin = score_metal - score_noise;
        if margin < 0.12 || score_metal < min_conf {
            out.push(drop(m, score_metal.clamp(0.0, 1.0)));
            continue;
        }

        // --- Host seçimi: legacy attach_metal_to_structure ile birebir hizalı ---
        // 1) Plan kesişimi (structure_metal_plan_hit): dik → elips, yan → kutu.
        let mut best_chamber: Option<(f32, &RoomSlot)> = None;
        for r in rooms {
            if !plan_hit(m, r, side) {
                continue;
            }
            let score = if side {
                (m.cx - r.cx).abs() / r.rx.max(1e-4)
            } else {
                let dx = (m.cx - r.cx) / (r.rx + m.rx * 0.5).max(1e-4);
                let dy = (m.cy - r.cy) / (r.ry + m.ry * 0.5).max(1e-4);
                (dx * dx + dy * dy).sqrt()
            };
            if best_chamber.map(|(bd, _)| score < bd).unwrap_or(true) {
                best_chamber = Some((score, r));
            }
        }

        // 2) Tünel kesişimi — link segmentine nokta uzaklığı (legacy point_to_segment).
        //    VPE link'i segment olarak oda uçlarından çözülür (tunnels_from_vpe_links
        //    ile aynı geometri: radius 0.025, yan genişlik a.width_m.min(b.width_m)*0.55).
        let mut best_tunnel: Option<(f32, &LinkDecision)> = None;
        for link in links {
            let (Some(a), Some(b)) = (
                room_by_id(rooms, &link.a_id),
                room_by_id(rooms, &link.b_id),
            ) else {
                continue;
            };
            let dist = point_to_segment(m.cx, m.cy, a.cx, a.cy, b.cx, b.cy);
            if dist <= tunnel_reach(m, a, b, side, map_w_m) {
                if best_tunnel.map(|(bd, _)| dist < bd).unwrap_or(true) {
                    best_tunnel = Some((dist, link));
                }
            }
        }

        // 3) Soft pull — plan kesişimi yoksa en yakın yapıya yumuşak çekim (legacy aynı).
        if best_chamber.is_none() && best_tunnel.is_none() {
            if let Some(r) = nearest_room(m, rooms, side) {
                let reach_x = (r.rx + m.rx).max(0.06)
                    + if side { 0.18 } else { 0.14 }
                    + if corridor { 0.04 } else { 0.0 };
                let y_ok = !side || (m.cy - r.cy).abs() <= (r.ry + m.ry).max(0.04) + 0.12;
                if (m.cx - r.cx).abs() <= reach_x && y_ok {
                    best_chamber = Some(((m.cx - r.cx).abs(), r));
                }
            }
            if let Some((dist, t)) = nearest_tunnel(m, links, rooms) {
                if dist <= if side { 0.28 } else { 0.2 } {
                    best_tunnel = Some((dist, t));
                }
            }
        }

        // 4) Host seçimi: legacy prefer_tunnel kuralı. (Legacy'nin üçüncü dalı
        //    shaft+elong'dur; VPE room_slots'ları şaft içermez, o yüzden yok.)
        let elong = (m.rx / m.ry.max(1e-3)).max(m.ry / m.rx.max(1e-3));
        let prefer_tunnel = best_tunnel.is_some()
            && (best_chamber.is_none()
                || (elong >= 1.6
                    && best_tunnel.map(|(d, _)| d).unwrap_or(1.0)
                        <= best_chamber.map(|(d, _)| d).unwrap_or(1.0) * 1.2));

        let host: Option<(String, String)> = if prefer_tunnel {
            best_tunnel.map(|(_, l)| ("tunnel".into(), format!("{}+{}", l.a_id, l.b_id)))
        } else if let Some((_, r)) = best_chamber {
            Some(("room".into(), r.id.clone()))
        } else if let Some((_, l)) = best_tunnel {
            Some(("tunnel".into(), format!("{}+{}", l.a_id, l.b_id)))
        } else {
            None
        };

        out.push(if let Some((kind, hid)) = host {
            MetalDecision {
                id: m.id.clone(),
                action: "attach".into(),
                host_kind: Some(kind),
                host_id: Some(hid),
                conf: score_metal.clamp(0.0, 1.0),
            }
        } else {
            drop(m, score_metal.clamp(0.0, 1.0))
        });
    }
    out
}

fn drop(m: &BlobDto, conf: f32) -> MetalDecision {
    MetalDecision {
        id: m.id.clone(),
        action: "drop".into(),
        host_kind: None,
        host_id: None,
        conf,
    }
}

/// Legacy `structure_metal_plan_hit`: dik → elips (lim 1.55, şaft 1.85 — VPE'de şaft
/// oda yok), yan → kutu (reach_x 1.75, reach_y 2.1 çarpanları + sabitler).
fn plan_hit(m: &BlobDto, r: &RoomSlot, side: bool) -> bool {
    if side {
        let reach_x = (r.rx + m.rx).max(0.04) * 1.75 + 0.1;
        let reach_y = (r.ry + m.ry).max(0.03) * 2.1 + 0.06;
        (m.cx - r.cx).abs() <= reach_x && (m.cy - r.cy).abs() <= reach_y
    } else {
        let dx = (m.cx - r.cx) / (r.rx + m.rx * 0.5).max(1e-4);
        let dy = (m.cy - r.cy) / (r.ry + m.ry * 0.5).max(1e-4);
        dx * dx + dy * dy <= 1.55 * 1.55
    }
}

/// Legacy tünel erişimi: dik → half_w.max(radius*3.5).max(m.rx); yan → genişlik tabanlı
/// (t.width_m = a.width_m.min(b.width_m)*0.55, clamp(0.55, 2.2)), clamp(0.1, 0.38).
fn tunnel_reach(m: &BlobDto, a: &RoomSlot, b: &RoomSlot, side: bool, map_w_m: f32) -> f32 {
    let half_w = (2.8 / map_w_m.max(1.0)).max(0.03);
    if side {
        let width_m = (a.width_m.min(b.width_m) * 0.55).clamp(0.55, 2.2);
        (width_m / map_w_m.max(1.0) * 1.1)
            .max(half_w)
            .max(m.rx * 1.6)
            .clamp(0.1, 0.38)
    } else {
        half_w.max(0.025 * 3.5).max(m.rx)
    }
}

/// Legacy `validate::point_to_segment` ile bit düzeyinde aynı (eşik 1e-12,
/// dejenere segmentte uç nokta uzaklığı).
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

fn room_by_id<'a>(rooms: &'a [RoomSlot], id: &str) -> Option<&'a RoomSlot> {
    rooms.iter().find(|r| r.id == id)
}

/// Legacy soft-pull oda seçimi: yan → |dx| + |dy|*0.85, dik → |dx|.
fn nearest_room<'a>(m: &BlobDto, rooms: &'a [RoomSlot], side: bool) -> Option<&'a RoomSlot> {
    rooms
        .iter()
        .min_by(|a, b| {
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
        })
}

/// Legacy soft-pull tünel seçimi: segment uzaklığı en küçük link.
fn nearest_tunnel<'a>(
    m: &BlobDto,
    links: &'a [LinkDecision],
    rooms: &'a [RoomSlot],
) -> Option<(f32, &'a LinkDecision)> {
    let mut best: Option<(f32, &LinkDecision)> = None;
    for l in links {
        let (Some(a), Some(b)) = (
            room_by_id(rooms, &l.a_id),
            room_by_id(rooms, &l.b_id),
        ) else {
            continue;
        };
        let dist = point_to_segment(m.cx, m.cy, a.cx, a.cy, b.cx, b.cy);
        if best.map(|(bd, _)| dist < bd).unwrap_or(true) {
            best = Some((dist, l));
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::BlobDto;

    fn room(id: &str, cx: f32, cy: f32) -> RoomSlot {
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

    fn metal(cx: f32, cy: f32) -> BlobDto {
        BlobDto {
            id: "m0".into(),
            cx,
            cy,
            rx: 0.02,
            ry: 0.02,
            intensity: 0.7,
            fill_ratio: 0.55,
            aspect: 1.0,
            ..Default::default()
        }
    }

    /// Dik: elips kesişimi (0.09*1.55 = 0.1395) içi + soft-pull bandı (0.24) içi attach;
    /// soft-pull dışı (0.26) standard drop, corridor (+0.04) attach.
    #[test]
    fn top_ellipse_and_soft_pull_reach() {
        let r = room("r0", 0.5, 0.5);
        let inside = decide_metals(&[metal(0.63, 0.5)], &[r.clone()], &[], 0.35, false, false, 24.0);
        assert_eq!(inside[0].action, "attach", "0.13 elips içi");
        let soft = decide_metals(&[metal(0.65, 0.5)], &[r.clone()], &[], 0.35, false, false, 24.0);
        assert_eq!(soft[0].action, "attach", "0.15 elips dışı ama soft-pull içi");
        let out = decide_metals(&[metal(0.76, 0.5)], &[r.clone()], &[], 0.35, false, false, 24.0);
        assert_eq!(out[0].action, "drop", "0.26 soft-pull (0.24) dışı");
        let corr = decide_metals(&[metal(0.76, 0.5)], &[r.clone()], &[], 0.35, true, false, 24.0);
        assert_eq!(corr[0].action, "attach", "corridor soft-pull 0.28 >= 0.26");
        assert_eq!(corr[0].host_kind.as_deref(), Some("room"));
        assert_eq!(corr[0].host_id.as_deref(), Some("r0"));
    }

    /// Yan: plan kutusu (reach_x 0.275) içi + plan dışı ama soft-pull (0.28) içi attach;
    /// 0.30 her iki erişim dışı → drop.
    #[test]
    fn side_box_and_soft_pull_reach() {
        let r = room("r0", 0.5, 0.5);
        let inside = decide_metals(&[metal(0.75, 0.5)], &[r.clone()], &[], 0.35, false, true, 24.0);
        assert_eq!(inside[0].action, "attach", "0.25 plan kutusu içi");
        let soft = decide_metals(&[metal(0.777, 0.5)], &[r.clone()], &[], 0.35, false, true, 24.0);
        assert_eq!(soft[0].action, "attach", "0.277 plan dışı ama soft-pull 0.28 içi");
        let out = decide_metals(&[metal(0.80, 0.5)], &[r.clone()], &[], 0.35, false, true, 24.0);
        assert_eq!(out[0].action, "drop", "0.30 her iki erişim dışı");
    }
}
