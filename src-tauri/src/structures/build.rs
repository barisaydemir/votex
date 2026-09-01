//! Build chamber / tunnel DTOs from validated blobs.
//!
//! Manyetik yüzey-çıkışı modeli (ters röntgen):
//! Cihaz yeryüzünden yükselen alanı okur. Güçlü boyama (mavi boşluk,
//! yeşil/sarı yapı ipucu, koyu–açık kontrast) yüzeye yakın demektir;
//! derin kaynak colormap'de zayıf kalır. Görüntü Y mutlak metre değildir.

use crate::preprocess::{GreenLineSeg, WallCue};
use crate::surface::{Chamber, Evidence, Tunnel};

use super::compass::{blob_orient_deg, compass_from_segment};
use super::path::{side_tunnel_endpoints, top_tunnel_endpoints};
use super::types_local::{Blob, VoidClass};

/// Sığ kapak alt sınırı (yüzeye yapışmadan tavan yükselir → hacim büyür).
pub const MIN_COVER_M: f32 = 0.28;
/// Eski ad — dışa açık; hacim büyütme ile uyumlu sığ kapak.
pub const TYPICAL_COVER_M: f32 = MIN_COVER_M;

/// Boyama / doluluk → yüzey çıkış gücü (0–1). Yüksek = yüzeye yakın.
pub fn surface_emergence(intensity: f32, fill: f32) -> f32 {
    (intensity * 0.74 + fill * 0.26).clamp(0.0, 1.0).powf(0.95)
}

/// Yapı ipucu (yeşil çizgi, duvar, sarı/beyaz kenar) yüzey olasılığını artırır.
pub fn emergence_with_cue(intensity: f32, fill: f32, structure_cue: f32) -> f32 {
    let base = surface_emergence(intensity, fill);
    (base + structure_cue.clamp(0.0, 1.0) * 0.2).clamp(0.0, 1.0)
}

/// Gömü: güçlü çıkış → sığ; zayıf → derin banda izin.
pub fn burial_from_intensity(intensity: f32, fill: f32, shallow: f32, deep: f32) -> f32 {
    burial_from_emergence(surface_emergence(intensity, fill), shallow, deep)
}

pub fn burial_from_emergence(emergence: f32, shallow: f32, deep: f32) -> f32 {
    let e = emergence.clamp(0.0, 1.0);
    let depth_frac = (1.0 - e).powf(1.4);
    (shallow + depth_frac * (deep - shallow)).clamp(shallow.min(deep), deep.max(shallow))
}

/// Kademeli derinlik — fizik (1/r^n) genlik→derinlik kestirimi.
///
/// Manyetik dipolün yüzey genliği `A ∝ 1/d^n` (dipol için n≈3). Bir referans
/// (tier-0 tipik) genlik `a_ref` ve buna karşılık gelen `cover_ref` derinliğinden
/// yola çıkarak, zayıf gözlenen genlik `a` için derinlik:
/// `d = cover_ref * (a_ref / a)^(1/n)`. Zayıf sinyal → daha derin band.
/// `deep_cap` ile kıskaçlanır (mevcut kıskacın altına inebilir).
pub fn depth_from_amplitude(a: f32, a_ref: f32, n: f32, cover_ref: f32, deep_cap: f32) -> f32 {
    let a = a.max(1e-3);
    let a_ref = a_ref.max(1e-3);
    // Zayıf sinyal (a < a_ref) → ratio > 1 → daha derin.
    let ratio = (a_ref / a).max(1.0);
    let d = cover_ref.max(0.1) * ratio.powf(1.0 / n.max(1.0));
    d.clamp(cover_ref.max(0.1), deep_cap.max(cover_ref))
}

/// Bir derin tier'ın genlik penceresi. `|signed|` bu banttaysa aday o tier'dir.
#[derive(Debug, Clone, Copy)]
pub struct TierBand {
    pub tier: u8,
    /// Alt sınır (dahil)
    pub lo: f32,
    /// Üst sınır (hariç) — tier-0 eşiğinin altında kalır
    pub hi: f32,
}

/// Derin tier genlik pencereleri (tier-0 hariç), `void_thr` ve `noise_std`'den türer.
/// tier1: `[0.6*thr, thr)`, tier2: `[max(1.4*noise, 0.35*thr), 0.6*thr)`.
/// Zayıflayan sinyal bantları → daha derin katmanlar.
pub fn deep_tier_bands(void_thr: f32, noise_std: f32) -> Vec<TierBand> {
    let thr = void_thr.max(0.08);
    let noise = noise_std.max(0.02);
    let t1_lo = 0.6 * thr;
    let t2_lo = (1.4 * noise).max(0.35 * thr);
    let mut bands = vec![TierBand {
        tier: 1,
        lo: t1_lo,
        hi: thr,
    }];
    if t2_lo < t1_lo - 1e-4 {
        bands.push(TierBand {
            tier: 2,
            lo: t2_lo,
            hi: t1_lo,
        });
    }
    bands
}

/// Yan: kapak/taban — kapak sığ (tavan yüksek); yükseklik ayakizinden bol.
pub fn side_cover_floor_m(b: &Blob, depth_range_m: f32) -> (f32, f32) {
    side_cover_floor_cued(b, depth_range_m, 0.0)
}

pub fn side_cover_floor_cued(b: &Blob, depth_range_m: f32, structure_cue: f32) -> (f32, f32) {
    let e = emergence_with_cue(b.intensity, b.fill_ratio, structure_cue);
    // Kapak sığ kalsın → tavan yüksek → iç hacim büyük
    let cover_hi = (depth_range_m * 0.28).max(MIN_COVER_M + 0.35);
    let cover_lo = MIN_COVER_M.min(cover_hi);
    let cover_band = (depth_range_m * (0.12 + (1.0 - e).powf(1.4) * 0.28))
        .clamp(cover_lo, cover_hi);
    let deep_cap = (cover_band * 0.55)
        .max(MIN_COVER_M)
        .min((cover_band - 0.15).max(MIN_COVER_M));
    let top_hi = (cover_band - 0.15).max(MIN_COVER_M);
    let mut top = burial_from_emergence(e, MIN_COVER_M, deep_cap).clamp(MIN_COVER_M, top_hi);
    let y_mid = b.cy.clamp(0.0, 1.0);
    let y_bias = (y_mid - 0.32).clamp(-0.15, 0.3) * cover_band * 0.08 * (1.0 - 0.5 * e);
    top = (top + y_bias).clamp(MIN_COVER_M, top_hi);

    // Yükseklik: ayakizi × ölçek — bol iç hacim
    let span_n = (b.ry * 2.0).clamp(0.05, 0.75);
    let h_avail = ((depth_range_m - top) * 0.9).max(1.0);
    let h_lo = 1.1f32.min(h_avail);
    let h_hi = h_avail.min(5.0).max(h_lo);
    let height = (span_n * depth_range_m * 0.48).clamp(h_lo, h_hi);
    let bottom = (top + height).min(depth_range_m.max(top + height));
    (top, bottom.max(top + h_lo))
}

/// Sinyal gömüsünü koru: tavanı `MIN_COVER_M`'e zorlama.
/// Yalnızca taban/tavan tutarlılığı ve minimum iç yükseklik.
pub fn expand_volume_keep_floors(
    chambers: &mut [Chamber],
    tunnels: &mut [Tunnel],
    depth_range_m: f32,
) {
    const MIN_H: f32 = 0.9;
    for c in chambers.iter_mut() {
        if c.kind == "shaft" {
            continue;
        }
        let floor = c.bottom_from_surface_m.min(depth_range_m).max(0.4);
        let mut top = c.top_from_surface_m.clamp(0.05, (floor - 0.35).max(0.05));
        if floor - top < MIN_H {
            // Hacim yetmezse tabanı aşağı aç; tavanı yüzeye kilitleme
            let new_floor = (top + MIN_H).min(depth_range_m);
            c.bottom_from_surface_m = new_floor;
            top = top.min(new_floor - 0.35).max(0.05);
            c.top_from_surface_m = top;
        } else {
            c.top_from_surface_m = top;
            c.bottom_from_surface_m = floor;
        }
        c.height_m = (c.bottom_from_surface_m - c.top_from_surface_m).max(0.35);
        c.depth = ((c.top_from_surface_m + c.height_m * 0.5) / depth_range_m).clamp(0.05, 0.98);
        c.height = (c.height_m / depth_range_m).clamp(0.08, 0.95);
    }
    for t in tunnels.iter_mut() {
        let floor = t.floor_from_surface_m.min(depth_range_m).max(0.4);
        let mut crown = t.crown_from_surface_m.clamp(0.05, (floor - 0.35).max(0.05));
        if floor - crown < MIN_H {
            let new_floor = (crown + MIN_H).min(depth_range_m);
            t.floor_from_surface_m = new_floor;
            crown = crown.min(new_floor - 0.35).max(0.05);
            t.crown_from_surface_m = crown;
        } else {
            t.crown_from_surface_m = crown;
            t.floor_from_surface_m = floor;
        }
        t.height_m = (t.floor_from_surface_m - t.crown_from_surface_m).max(0.35);
        t.depth = ((t.crown_from_surface_m + t.height_m * 0.5) / depth_range_m).clamp(0.05, 0.98);
    }
}

/// Geriye uyum — hacim büyütme (artık tavanı 0.28'e kilitlemez).
pub fn lift_covers_keep_floors(
    chambers: &mut [Chamber],
    tunnels: &mut [Tunnel],
    depth_range_m: f32,
) {
    expand_volume_keep_floors(chambers, tunnels, depth_range_m);
}

pub fn build_chamber(
    b: &Blob,
    class: VoidClass,
    side: bool,
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    conf: f32,
    evidence: Evidence,
) -> Option<Chamber> {
    let kind = match class {
        VoidClass::Shaft => "shaft",
        VoidClass::Tomb => "tomb",
        VoidClass::Room => "room",
        _ => return None,
    };
    let bearing_deg = if side {
        0.0
    } else {
        blob_orient_deg(b, false, map_w_m, depth_range_m)
    };

    if side {
        // Yan: X = hat; gömü = yüzey çıkışı (görüntü Y mutlak metre değil)
        let cue = evidence.wall_support.max(evidence.path_support * 0.5);
        let (top_m, bottom_m) = side_cover_floor_cued(b, depth_range_m, cue);
        let height_m = (bottom_m - top_m).max(0.85);
        let width_m = (b.rx * 2.0 * map_w_m).clamp(0.45, map_w_m * 0.95);
        // Yan: Z ince kesit — boy şişmesin
        let length_m = (height_m * 0.55).clamp(0.7, 1.8);
        let _ = map_d_m;

        if kind == "shaft" {
            let diam = width_m.min(length_m).clamp(0.4, 2.2);
            return Some(Chamber {
                kind: kind.into(),
                cx: b.cx,
                cy: b.cy,
                rx: b.rx,
                ry: b.ry,
                depth: ((top_m + bottom_m) * 0.5 / depth_range_m).clamp(0.05, 0.98),
                height: (height_m / depth_range_m).clamp(0.08, 0.9),
                intensity: b.intensity,
                width_m: diam,
                length_m: diam,
                top_from_surface_m: top_m,
                bottom_from_surface_m: bottom_m,
                height_m,
                bearing_deg: 0.0,
                confidence: conf,
                tier: 0,
                depth_estimate_m: 0.0,
                evidence,
                geometry: Default::default(),
                outline: b.outline.clone(),
            });
        }
        return Some(Chamber {
            kind: kind.into(),
            cx: b.cx,
            cy: b.cy,
            rx: b.rx,
            ry: b.ry,
            depth: ((top_m + bottom_m) * 0.5 / depth_range_m).clamp(0.05, 0.98),
            height: (height_m / depth_range_m).clamp(0.08, 0.85),
            intensity: b.intensity,
            width_m,
            length_m,
            top_from_surface_m: top_m,
            bottom_from_surface_m: bottom_m,
            height_m,
            // Yan: döndürme yok — mavi ayakizi XZ hizasinda kalsın
            bearing_deg: 0.0,
            confidence: conf,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence,
            geometry: Default::default(),
            outline: b.outline.clone(),
        });
    }

    let max_depth = depth_range_m;
    let mut width_m = b.rx * 2.0 * map_w_m;
    let mut length_m = b.ry * 2.0 * map_d_m;
    if b.axis_aspect >= 1.2 {
        let map_avg = (map_w_m + map_d_m) * 0.5;
        let major = (b.half_len * 2.0 * map_avg).clamp(0.6, map_w_m.max(map_d_m) * 0.9);
        let minor = (major / b.axis_aspect).clamp(0.4, major);
        width_m = major;
        length_m = minor;
    }
    let diam = width_m.min(length_m);
    if kind == "shaft" {
        // Dik çekim kuyu: haritada ağız/kapak; gövde aşağı iner. Tipik ~7.5 m; üst tavan yok.
        const WELL_TYPICAL_M: f32 = 7.5;
        let well_cap = max_depth.max(WELL_TYPICAL_M + 1.0);
        let d = diam.clamp(0.5, 5.0);
        let d = if d > 2.8 { (d * 0.28).clamp(0.8, 2.8) } else { d };
        width_m = d;
        length_m = d;
        let cover = (0.05 + (1.0 - b.intensity) * 0.14).clamp(0.04, 0.28);
        let strength = (b.intensity * 0.7 + b.fill_ratio * 0.3).clamp(0.0, 1.0);
        let bottom = (WELL_TYPICAL_M - (1.0 - strength) * 2.0).clamp(cover + 5.5, well_cap);
        let h = (bottom - cover).clamp(5.5, well_cap - cover);
        let bottom = (cover + h).min(well_cap);
        return Some(Chamber {
            kind: kind.into(),
            cx: b.cx,
            cy: b.cy,
            rx: b.rx,
            ry: b.ry,
            depth: ((cover + h * 0.5) / well_cap).clamp(0.05, 0.98),
            height: (h / well_cap).clamp(0.08, 0.95),
            intensity: b.intensity,
            width_m,
            length_m,
            top_from_surface_m: cover,
            bottom_from_surface_m: bottom,
            height_m: bottom - cover,
            bearing_deg: 0.0,
            confidence: conf,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence,
            geometry: Default::default(),
            outline: b.outline.clone(),
        });
    }

    let span = diam.max(0.6);
    let height_m = match kind {
        "tomb" => (span * 0.48).clamp(1.4, 3.2),
        _ => (span * 0.45).clamp(1.2, 3.0),
    };
    // Dik: kapak sığ kalır; oda yüksekliği ayakizinden (küçültülmez)
    let cue = evidence.wall_support.max(evidence.path_support * 0.5);
    let e = emergence_with_cue(b.intensity, b.fill_ratio, cue);
    let deep_cap = (max_depth * (0.22 + (1.0 - e).powf(1.4) * 0.28))
        .max(0.5)
        .min((max_depth - height_m).max(0.4));
    let cover = burial_from_emergence(e, TYPICAL_COVER_M, deep_cap)
        .clamp(MIN_COVER_M, (max_depth - height_m).max(0.75));
    let bottom = (cover + height_m).min(max_depth);
    Some(Chamber {
        kind: kind.into(),
        cx: b.cx,
        cy: b.cy,
        rx: b.rx,
        ry: b.ry,
        depth: ((cover + height_m * 0.5) / max_depth).clamp(0.05, 0.98),
        height: (height_m / max_depth).clamp(0.08, 0.85),
        intensity: b.intensity,
        width_m,
        length_m,
        top_from_surface_m: cover,
        bottom_from_surface_m: bottom,
        height_m: bottom - cover,
        bearing_deg,
        confidence: conf,
        tier: 0,
        depth_estimate_m: 0.0,
        evidence,
        geometry: Default::default(),
        outline: b.outline.clone(),
    })
}

pub fn build_tunnel(
    b: &Blob,
    side: bool,
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    conf: f32,
    evidence: Evidence,
    walls: &[WallCue],
    signed: &[f32],
    w: u32,
    h: u32,
    metal_thr: f32,
) -> Option<Tunnel> {
    let (x0, y0, x1, y1) = if side {
        side_tunnel_endpoints(b, walls, signed, w, h, metal_thr)
    } else {
        top_tunnel_endpoints(b, walls)
    };
    let (bearing_deg, heading, direction) = compass_from_segment(x0, y0, x1, y1);

    let (height_m, width_m, crown) = if side {
        let cue = evidence.wall_support.max(evidence.path_support * 0.5);
        let (crown, floor) = side_cover_floor_cued(b, depth_range_m, cue);
        let height_m = (floor - crown).max(0.85);
        let span_x = ((x1 - x0).abs() * map_w_m)
            .max(b.rx * 2.0 * map_w_m)
            .clamp(0.7, map_w_m * 0.95);
        let width_m = (b.rx * 2.0 * map_w_m)
            .clamp(0.7, 3.2)
            .min(span_x * 0.65)
            .max(0.7);
        let _ = map_d_m;
        (height_m, width_m, crown)
    } else {
        let cross = (b.rx * 2.0 * map_w_m).min(b.ry * 2.0 * map_d_m);
        let height_m = (cross * 1.0).clamp(1.0, 3.2);
        let width_m = cross.clamp(0.9, 4.5);
        let cue = evidence.wall_support.max(evidence.path_support * 0.5);
        let e = emergence_with_cue(b.intensity, b.fill_ratio, cue);
        let deep_cap = (depth_range_m * (0.18 + (1.0 - e).powf(1.45) * 0.3))
            .max(0.5)
            .min((depth_range_m - height_m).max(0.3));
        let crown = burial_from_emergence(e, TYPICAL_COVER_M, deep_cap)
            .clamp(MIN_COVER_M, (depth_range_m - height_m).max(0.75));
        (height_m, width_m, crown)
    };
    let floor = (crown + height_m).min(depth_range_m);

    Some(Tunnel {
        x0,
        y0,
        x1,
        y1,
        radius: b.rx.min(b.ry).clamp(0.008, 0.08),
        depth: ((crown + height_m * 0.5) / depth_range_m).clamp(0.05, 0.98),
        bearing_deg,
        direction,
        heading,
        width_m,
        floor_from_surface_m: floor,
        crown_from_surface_m: crown,
        height_m: floor - crown,
        confidence: conf,
        tier: 0,
        depth_estimate_m: 0.0,
        evidence,
        geometry: Default::default(),
        outline: b.outline.clone(),
    })
}

/// Yeşil içi düz beyaz çizgi → tünel (piksel geçişinden gelen segment).
pub fn build_tunnel_from_green_line(
    seg: &GreenLineSeg,
    side: bool,
    map_w_m: f32,
    _map_d_m: f32,
    depth_range_m: f32,
    min_confidence: f32,
) -> Option<Tunnel> {
    let conf = (0.42 + seg.strength * 0.35 + (seg.length - 0.07).min(0.25) * 0.8)
        .clamp(0.4, 0.92);
    if conf < (min_confidence - 0.08).max(0.28) {
        return None;
    }

    let (x0, y0, x1, y1, height_m, width_m, crown) = if side {
        // Yeşil içi beyaz çizgi = yüzey çıkışlı tünel ipucu
        let strength = seg.strength.clamp(0.0, 1.0);
        let e = emergence_with_cue(strength, 0.55, strength);
        let (crown, floor) = {
            let fake = Blob {
                cx: (seg.x0 + seg.x1) * 0.5,
                cy: ((seg.y0 + seg.y1) * 0.5).clamp(0.0, 1.0),
                rx: ((seg.x1 - seg.x0).abs() * 0.5).max(0.02),
                ry: 0.06,
                intensity: strength.max(0.55),
                max_intensity: strength.max(0.55),
                area_px: 40,
                fill_ratio: 0.55,
                dir_x: 1.0,
                dir_y: 0.0,
                half_len: ((seg.x1 - seg.x0).abs() * 0.5).max(0.02),
                axis_aspect: 2.0,
                outline: Vec::new(),
            };
            side_cover_floor_cued(&fake, depth_range_m, e)
        };
        let height_m = (floor - crown).clamp(0.85, 3.2);
        let span = ((seg.x1 - seg.x0).abs() * map_w_m).clamp(1.2, map_w_m * 0.95);
        let width_m = 1.35f32.clamp(0.85, 2.6);
        (
            seg.x0.min(seg.x1),
            seg.y0.clamp(0.0, 1.0),
            seg.x0.max(seg.x1),
            seg.y1.clamp(0.0, 1.0),
            height_m,
            width_m.min(span * 0.4).max(0.65),
            crown,
        )
    } else {
        let cross = (0.035 * map_w_m).clamp(0.7, 2.0);
        let height_m = (cross * 0.95).clamp(0.7, 2.4);
        let width_m = cross;
        let strength = seg.strength.clamp(0.0, 1.0);
        let e = emergence_with_cue(strength, 0.5, strength);
        let deep_cap = (depth_range_m * (0.14 + (1.0 - e).powf(1.45) * 0.26)).max(0.5);
        let crown = burial_from_emergence(e, TYPICAL_COVER_M, deep_cap)
            .clamp(0.7, depth_range_m - height_m);
        (seg.x0, seg.y0, seg.x1, seg.y1, height_m, width_m, crown)
    };
    if (x1 - x0).abs() + (y1 - y0).abs() < 0.06 {
        return None;
    }
    let floor = (crown + height_m).min(depth_range_m);
    let (bearing_deg, heading, direction) = compass_from_segment(x0, y0, x1, y1);
    Some(Tunnel {
        x0,
        y0,
        x1,
        y1,
        radius: 0.02,
        depth: ((crown + height_m * 0.5) / depth_range_m).clamp(0.05, 0.98),
        bearing_deg,
        direction,
        heading,
        width_m,
        floor_from_surface_m: floor,
        crown_from_surface_m: crown,
        height_m: floor - crown,
        confidence: conf,
        tier: 0,
        depth_estimate_m: 0.0,
        evidence: Evidence {
            snr: 1.8 + seg.strength,
            path_support: seg.strength,
            class_margin: 0.2 + seg.length * 0.5,
            wall_support: seg.strength,
            reasons: vec!["green_line".into(), format!("len:{:.2}", seg.length)],
        },
        geometry: Default::default(),
        outline: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surface::Evidence;

    fn blob(cy: f32, ry: f32) -> Blob {
        Blob {
            cx: 0.4,
            cy,
            rx: 0.18,
            ry,
            intensity: 0.7,
            max_intensity: 0.8,
            area_px: 100,
            fill_ratio: 0.6,
            dir_x: 1.0,
            dir_y: 0.0,
            half_len: 0.18,
            axis_aspect: 2.5,
            outline: Vec::new(),
        }
    }

    #[test]
    fn side_tunnel_burial_follows_surface_emergence() {
        let t = build_tunnel(
            &blob(0.55, 0.12),
            true,
            24.0,
            3.0,
            10.0,
            0.8,
            Evidence::default(),
            &[],
            &[0.0; 16],
            4,
            4,
            0.3,
        )
        .expect("tunnel");
        // intensity=0.7 → yüzey bandı; ham Y×range (~5–6 m) olmamalı
        assert!(
            t.crown_from_surface_m < 4.0,
            "strong paint tunnel crown in near-surface band, got {}",
            t.crown_from_surface_m
        );
        assert!(
            t.crown_from_surface_m > 0.1,
            "should not glue to surface, got {}",
            t.crown_from_surface_m
        );
        assert!(
            t.floor_from_surface_m > t.crown_from_surface_m + 0.3,
            "tunnel must have thickness"
        );
        assert!(
            (t.height_m - (t.floor_from_surface_m - t.crown_from_surface_m)).abs() < 0.08
        );
    }

    #[test]
    fn strong_emergence_shallower_than_weak() {
        let shallow = burial_from_intensity(0.9, 0.7, 0.1, 8.0);
        let deep = burial_from_intensity(0.25, 0.2, 0.1, 8.0);
        assert!(
            shallow < deep * 0.7,
            "strong paint must bury shallower: {shallow} vs {deep}"
        );
        assert!(shallow < 2.8, "strong paint near-surface band, got {shallow}");
        // Tavan yüzeye yakın → iç hacim büyük; ~80 cm kapak kısıtı yok
        assert!(
            shallow < 1.2,
            "strong paint shallow crown for volume growth, got {shallow}"
        );
    }

    #[test]
    fn side_room_sits_on_blue_thin_z_not_map_depth() {
        let c = build_chamber(
            &blob(0.4, 0.15),
            VoidClass::Room,
            true,
            24.0,
            16.0,
            3.0,
            0.8,
            Evidence::default(),
        )
        .expect("room");
        // ry×map_d ≈ 4.8 olurdu; yan oda ince kesit olmalı
        assert!(
            c.length_m <= 2.55,
            "side room Z must be thin on blue, got {}",
            c.length_m
        );
        assert!((c.width_m - 0.18 * 2.0 * 24.0).abs() < 0.05);
        assert_eq!(c.bearing_deg, 0.0);
    }

    #[test]
    fn expand_volume_preserves_burial_not_lock_028() {
        let mut chambers = vec![Chamber {
            kind: "room".into(),
            cx: 0.4,
            cy: 0.5,
            rx: 0.1,
            ry: 0.08,
            depth: 0.4,
            height: 0.26,
            intensity: 0.7,
            width_m: 2.0,
            length_m: 2.5,
            top_from_surface_m: 2.4,
            bottom_from_surface_m: 5.0,
            height_m: 2.6,
            bearing_deg: 0.0,
            confidence: 0.8,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        }];
        let mut tunnels = vec![Tunnel {
            x0: 0.3,
            y0: 0.5,
            x1: 0.6,
            y1: 0.5,
            radius: 0.02,
            depth: 0.4,
            bearing_deg: 90.0,
            direction: "D".into(),
            heading: "D".into(),
            width_m: 1.2,
            floor_from_surface_m: 4.5,
            crown_from_surface_m: 1.8,
            height_m: 2.7,
            confidence: 0.8,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        }];
        expand_volume_keep_floors(&mut chambers, &mut tunnels, 10.0);
        assert!(
            (chambers[0].top_from_surface_m - 2.4).abs() < 0.05,
            "room top must stay ~2.4 not 0.28, got {}",
            chambers[0].top_from_surface_m
        );
        assert!(
            (tunnels[0].crown_from_surface_m - 1.8).abs() < 0.05,
            "tunnel crown must stay ~1.8 not 0.28, got {}",
            tunnels[0].crown_from_surface_m
        );
    }
}
