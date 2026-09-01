//! Anomali → yapı adayları + doğrulama kapıları (V1–V6).
//!
//! Analiz sırası:
//! 1) Yapı bul (mavi boşluk + beyaz/nötr zarf → oda / tünel / şaft)
//! 2) Kırmızı anomali bul (pozitif metal)
//! 3) Kırmızıyı yapıyla kesiştir (yapı içi dolgu / çıkış)
//!
//! Manyetik alan:
//! - signed < 0 (mavi) → boşluk
//! - signed > 0 (kırmızı) → metal; derin demek değil; yapı yanında silinmez
//! - beyaza yakın → nötr zarf; yeşil → toprak (yapı yok demek değil)

pub mod analysis_report;
mod blobs;
mod build;
mod calibrate;
mod classify;
mod compass;
mod cues;
mod hints;
mod path;
mod prob_apply;
mod types_local;
mod validate;
mod water;

pub use calibrate::calibrate_field;
pub use hints::StructureHint;
pub use types_local::FieldCalib;
pub use validate::align_tunnel_floors_to_rooms;
pub use build::{expand_volume_keep_floors, MIN_COVER_M};
pub use water::extract_blue_waters;

use crate::preprocess::WallCue;
use crate::surface::{Chamber, Evidence, MetalBody, Tunnel, UndergroundStructures};

use blobs::{connected_blobs, connected_blobs_ex, split_peak_blobs};
use build::{
    build_chamber, build_tunnel, build_tunnel_from_green_line, burial_from_emergence,
    deep_tier_bands, depth_from_amplitude, emergence_with_cue, side_cover_floor_m,
    surface_emergence,
};
use classify::{classify_void_side, classify_void_top, well_like_plan, well_physical_diameter_m};
use cues::{
    green_line_tunnel_support, interpret_red_cue, near_metal_blob, near_void_blob,
    positive_bloom_ring, wall_bounds_around, wall_ring_support, wall_ring_support_with_clarity,
};
use path::{path_structure_support, tunnel_path_endpoints};
use std::collections::HashMap;
use types_local::{Blob, VoidClass};
use hints::apply_structure_hints;
use validate::{
    attach_metal_to_structure, dedupe_metals, dedupe_voids, link_chambers_with_path,
    merge_collinear_tunnels, promote_side_red_corridors,
};
use crate::preprocess::extract_green_line_segments;

/// Dik ve yan çekimde hedef tipi (kuyu / oda / tünel / yapı / otomatik).
fn normalize_target(_view_mode: &str, target_kind: &str) -> &'static str {
    match target_kind.trim().to_ascii_lowercase().as_str() {
        "well" | "kuyu" | "shaft" => "well",
        "room" | "oda" | "tomb" | "mezar" => "room",
        "tunnel" | "tunel" | "tünel" => "tunnel",
        "site" | "yapi" | "yapı" | "structure" => "site",
        _ => "auto",
    }
}

fn class_allowed(target: &str, class: VoidClass) -> bool {
    match target {
        "well" => matches!(class, VoidClass::Shaft),
        // Oda hedefinde de koridorlar kalsın (karşı PC'de tünel kaybolmasın)
        "room" => matches!(
            class,
            VoidClass::Room | VoidClass::Tomb | VoidClass::Tunnel
        ),
        "tunnel" => matches!(class, VoidClass::Tunnel),
        "site" => matches!(
            class,
            VoidClass::Room | VoidClass::Tomb | VoidClass::Tunnel
        ),
        _ => !matches!(class, VoidClass::Noise),
    }
}

fn allow_metal_to_shaft(target: &str) -> bool {
    // Metal ≠ kuyu: yalnızca hedef açıkça "Kuyu" iken kompakt metal şaft adayı olur
    target == "well"
}

fn allow_link_tunnels(target: &str) -> bool {
    matches!(target, "auto" | "tunnel" | "site" | "room")
}

/// Kırmızı blob, kabul edilmiş oda/tünelle plan kesişiyor mu?
fn near_accepted_structure(
    b: &Blob,
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    side: bool,
) -> bool {
    for c in chambers {
        if side {
            let reach = (c.rx + b.rx).max(0.04) * 1.5 + 0.06;
            if (b.cx - c.cx).abs() <= reach {
                return true;
            }
        } else {
            let dx = (b.cx - c.cx) / (c.rx + b.rx + 0.02).max(1e-3);
            let dy = (b.cy - c.cy) / (c.ry + b.ry + 0.02).max(1e-3);
            if dx * dx + dy * dy < 2.5 {
                return true;
            }
        }
    }
    tunnels.iter().any(|t| {
        let mx = (t.x0 + t.x1) * 0.5;
        let my = (t.y0 + t.y1) * 0.5;
        let dx = (b.cx - mx).abs();
        let dy = (b.cy - my).abs();
        if side {
            dx < (b.rx + 0.08).max(0.1)
        } else {
            dx * dx + dy * dy < 0.04
        }
    })
}

fn depth_m_probe(b: &Blob, side: bool, depth_range_m: f32) -> f32 {
    if side {
        let (top, bot) = side_cover_floor_m(b, depth_range_m);
        ((top + bot) * 0.5).clamp(0.08, depth_range_m)
    } else {
        let e = surface_emergence(b.intensity, b.fill_ratio);
        let deep_cap = (depth_range_m * (0.18 + (1.0 - e).powf(1.45) * 0.3)).max(0.55);
        burial_from_emergence(e, 0.15, deep_cap).clamp(0.12, depth_range_m)
    }
}

/// Link tüneli, mevcut blob tüneliyle aynı koridoru mu paylaşıyor?
fn tunnel_overlaps_existing(cand: &Tunnel, existing: &[Tunnel]) -> bool {
    let cmx = (cand.x0 + cand.x1) * 0.5;
    let cmy = (cand.y0 + cand.y1) * 0.5;
    existing.iter().any(|t| {
        let tmx = (t.x0 + t.x1) * 0.5;
        let tmy = (t.y0 + t.y1) * 0.5;
        let mid_d = ((cmx - tmx).powi(2) + (cmy - tmy).powi(2)).sqrt();
        if mid_d < 0.08 {
            return true;
        }
        let ends_close = (cand.x0 - t.x0).abs() + (cand.y0 - t.y0).abs() < 0.12
            || (cand.x0 - t.x1).abs() + (cand.y0 - t.y1).abs() < 0.12
            || (cand.x1 - t.x0).abs() + (cand.y1 - t.y0).abs() < 0.12
            || (cand.x1 - t.x1).abs() + (cand.y1 - t.y1).abs() < 0.12;
        ends_close && mid_d < 0.18
    })
}

/// VPE link uçlarını en yakın odaya yasla: yan modda geniş oda parçalanınca fragman
/// merkezleri blob merkezinden farklıdır — tünel uçları fragman odalarına otursun.
fn snap_tunnel_to_chambers(t: &mut Tunnel, chambers: &[Chamber]) {
    let snap = |x: f32, y: f32| -> (f32, f32) {
        chambers
            .iter()
            .min_by(|a, b| {
                let da = (x - a.cx).powi(2) + (y - a.cy).powi(2);
                let db = (x - b.cx).powi(2) + (y - b.cy).powi(2);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|c| (c.cx, c.cy))
            .unwrap_or((x, y))
    };
    let (x0, y0) = snap(t.x0, t.y0);
    let (x1, y1) = snap(t.x1, t.y1);
    t.x0 = x0;
    t.y0 = y0;
    t.x1 = x1;
    t.y1 = y1;
}

/// Yan çekimde aynı yapıya ait yakın parçaları birleştir.
/// Tünel parçaları birleşir; odalar yalnız güçlü örtüşmede (ayrı odalar bağlantıyla kalsın).
fn merge_side_void_parts(
    mut items: Vec<(Blob, VoidClass, f32, f32, f32, Vec<String>)>,
    depth_range_m: f32,
) -> Vec<(Blob, VoidClass, f32, f32, f32, Vec<String>)> {
    if items.len() < 2 {
        return items;
    }
    items.sort_by(|a, b| a.0.cx.partial_cmp(&b.0.cx).unwrap_or(std::cmp::Ordering::Equal));
    let mut out: Vec<(Blob, VoidClass, f32, f32, f32, Vec<String>)> = Vec::new();
    for (b, class, conf, snr, margin, reasons) in items {
        if matches!(class, VoidClass::Shaft | VoidClass::Noise) {
            out.push((b, class, conf, snr, margin, reasons));
            continue;
        }
        let mut merged = false;
        for slot in &mut out {
            if matches!(slot.1, VoidClass::Shaft | VoidClass::Noise) {
                continue;
            }
            let both_tunnel = matches!(
                (slot.1, class),
                (VoidClass::Tunnel, VoidClass::Tunnel)
            );
            let both_room = matches!(
                (slot.1, class),
                (VoidClass::Room, VoidClass::Room)
                    | (VoidClass::Tomb, VoidClass::Tomb)
                    | (VoidClass::Room, VoidClass::Tomb)
                    | (VoidClass::Tomb, VoidClass::Room)
            );
            if !both_tunnel && !both_room {
                continue;
            }
            let a = &slot.0;
            let a0 = a.cx - a.rx;
            let a1 = a.cx + a.rx;
            let b0 = b.cx - b.rx;
            let b1 = b.cx + b.rx;
            let overlap = (a1.min(b1) - a0.max(b0)).max(0.0);
            let span = (a1.max(b1) - a0.min(b0)).max(1e-3);
            let x_iou = overlap / span;
            let gap_x = (b0 - a1).max(a0 - b1).max(0.0);
            let y_touch = (a.cy - b.cy).abs() <= (a.ry + b.ry) * (if both_tunnel { 1.45 } else { 1.1 }) + 0.05;
            let cx_close = (a.cx - b.cx).abs() < 0.2;
            let combined_span = a1.max(b1) - a0.min(b0);
            let can_merge = if both_tunnel {
                y_touch && (x_iou >= 0.18 || gap_x < 0.12 || (gap_x < 0.18 && cx_close))
            } else {
                y_touch && x_iou >= 0.72 && combined_span <= 0.16 && gap_x < 0.04
            };
            if can_merge {
                let min_x = a0.min(b0);
                let max_x = a1.max(b1);
                let min_y = (a.cy - a.ry).min(b.cy - b.ry);
                let max_y = (a.cy + a.ry).max(b.cy + b.ry);
                slot.0.cx = (min_x + max_x) * 0.5;
                slot.0.cy = (min_y + max_y) * 0.5;
                slot.0.rx = ((max_x - min_x) * 0.5).max(0.01);
                slot.0.ry = ((max_y - min_y) * 0.5).max(0.01);
                slot.0.intensity = slot.0.intensity.max(b.intensity);
                slot.0.fill_ratio = ((slot.0.fill_ratio + b.fill_ratio) * 0.5).clamp(0.2, 0.95);
                slot.0.area_px = slot.0.area_px.saturating_add(b.area_px);
                if both_tunnel {
                    let len = (max_x - min_x).max(1e-3);
                    slot.0.dir_x = 1.0;
                    slot.0.dir_y = 0.0;
                    slot.0.half_len = len * 0.5;
                    slot.0.axis_aspect = (len / (slot.0.ry * 2.0).max(1e-3)).clamp(1.0, 12.0);
                    slot.1 = VoidClass::Tunnel;
                } else if matches!(class, VoidClass::Tomb) || matches!(slot.1, VoidClass::Tomb) {
                    slot.1 = VoidClass::Tomb;
                } else {
                    slot.1 = VoidClass::Room;
                }
                slot.2 = slot.2.max(conf);
                slot.3 = slot.3.max(snr);
                slot.4 = slot.4.max(margin);
                for r in &reasons {
                    if !slot.5.iter().any(|x| x == r) {
                        slot.5.push(r.clone());
                    }
                }
                let _ = depth_range_m;
                merged = true;
                break;
            }
        }
        if !merged {
            out.push((b, class, conf, snr, margin, reasons));
        }
    }
    out
}

/// Yan: tek büyük oda kutusunu yan yana oda parçalarına böl.
fn fragment_oversized_side_chambers(chambers: Vec<Chamber>, map_w_m: f32) -> Vec<Chamber> {
    const MAX_ROOM_W_M: f32 = 3.5;
    let mut out = Vec::new();
    for c in chambers {
        if c.kind != "room" && c.kind != "tomb" {
            out.push(c);
            continue;
        }
        if c.width_m <= MAX_ROOM_W_M + 0.2 {
            out.push(c);
            continue;
        }
        let n = ((c.width_m / MAX_ROOM_W_M).ceil() as usize).clamp(2, 6);
        let piece_rx = (c.rx / n as f32).max(0.012);
        let piece_w = (c.width_m / n as f32).max(0.5);
        let left = c.cx - c.rx;
        for i in 0..n {
            let mut p = c.clone();
            p.cx = (left + piece_rx * (2.0 * i as f32 + 1.0)).clamp(0.0, 1.0);
            // Hafif boşluk: birleşik kutular, tek prizma değil
            p.rx = (piece_rx * 0.92).max(0.012);
            p.width_m = (piece_w * 0.9).clamp(0.5, MAX_ROOM_W_M + 0.15);
            if p.geometry.label.is_empty() {
                p.geometry.label = "parçalı oda".into();
            }
            p.geometry.method = "side_room_fragment".into();
            p.outline.clear();
            let _ = map_w_m;
            out.push(p);
        }
    }
    out
}

/// Kademeli derinlikte derin tier'ların inebileceği maksimum menzil çarpanı.
/// deep_range_m = depth_range_m * DEEP_RANGE_MULT (mevcut kıskacın altına iner).
const DEEP_RANGE_MULT: f32 = 3.0;

/// Kabul edilen tier-0 yapılarının ayakizini piksel maskesine işler (bbox + pay).
/// `true` = o piksel tier-0 tarafından sahiplenilmiş; derin tier oraya girmez.
fn build_footprint_mask(
    w: u32,
    h: u32,
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    metals: &[MetalBody],
) -> Vec<bool> {
    let mut mask = vec![false; (w * h) as usize];
    let wf = (w.max(1) - 1) as f32;
    let hf = (h.max(1) - 1) as f32;
    let mut stamp = |cx: f32, cy: f32, rx: f32, ry: f32| {
        // Ayakizini biraz büyüt (pay) → derin adaylar tier-0'a yapışmasın
        let pad = 0.02f32;
        let x0 = (((cx - rx - pad).clamp(0.0, 1.0)) * wf).floor() as i32;
        let x1 = (((cx + rx + pad).clamp(0.0, 1.0)) * wf).ceil() as i32;
        let y0 = (((cy - ry - pad).clamp(0.0, 1.0)) * hf).floor() as i32;
        let y1 = (((cy + ry + pad).clamp(0.0, 1.0)) * hf).ceil() as i32;
        for y in y0..=y1 {
            for x in x0..=x1 {
                if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
                    continue;
                }
                mask[(y as u32 * w + x as u32) as usize] = true;
            }
        }
    };
    for c in chambers {
        stamp(c.cx, c.cy, c.rx.max(0.02), c.ry.max(0.02));
    }
    for m in metals {
        stamp(m.cx, m.cy, m.rx.max(0.02), m.ry.max(0.02));
    }
    for t in tunnels {
        // Tünel segmentini bbox olarak damgala
        let cx = (t.x0 + t.x1) * 0.5;
        let cy = (t.y0 + t.y1) * 0.5;
        let rx = ((t.x1 - t.x0).abs() * 0.5).max(t.radius).max(0.02);
        let ry = ((t.y1 - t.y0).abs() * 0.5).max(t.radius).max(0.02);
        stamp(cx, cy, rx, ry);
    }
    mask
}

/// Kademeli derinlik: tier-0 maskesi dışında, zayıflayan genlik bantlarında
/// (bkz. [`deep_tier_bands`]) derin void adayları bulur; fizik (1/r^n) ile
/// derinlik kestirir, düşük güven + `tier>=1` atar. Tier-0'a dokunmaz.
#[allow(clippy::too_many_arguments)]
fn extract_deep_tiers(
    signed: &[f32],
    w: u32,
    h: u32,
    map_width_m: f32,
    map_depth_m: f32,
    depth_range_m: f32,
    deep_range_m: f32,
    side: bool,
    target: &str,
    calib: &FieldCalib,
    wall_cues: &[WallCue],
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    metals: &[MetalBody],
) -> (Vec<Chamber>, Vec<Tunnel>) {
    let mut mask = build_footprint_mask(w, h, chambers, tunnels, metals);
    let bands = deep_tier_bands(calib.void_thr, calib.noise_std);
    let n_px = (w * h) as usize;
    let min_area = calib.min_area.max(10);
    let cover_ref = depth_range_m * 0.35;
    let mut out_ch: Vec<Chamber> = Vec::new();
    let mut out_tn: Vec<Tunnel> = Vec::new();

    for band in bands {
        // Yalnızca maske dışı + bu banttaki NEGATİF (void) sinyalleri tut
        let mut deep_signed = vec![0.0f32; n_px];
        for i in 0..n_px {
            if mask[i] {
                continue;
            }
            let s = signed[i];
            if s <= -band.lo && s > -band.hi {
                deep_signed[i] = s;
            }
        }
        let blobs = connected_blobs_ex(&deep_signed, w, h, true, band.lo, min_area, false);
        for b in &blobs {
            // Maske ile çakışan (merkezi sahipli) adayları at
            let mcx = (b.cx * (w.max(1) - 1) as f32).round() as i32;
            let mcy = (b.cy * (h.max(1) - 1) as f32).round() as i32;
            if mcx >= 0
                && mcy >= 0
                && (mcx as u32) < w
                && (mcy as u32) < h
                && mask[(mcy as u32 * w + mcx as u32) as usize]
            {
                continue;
            }
            let snr = b.intensity / calib.noise_std.max(0.04);
            let aspect = b
                .axis_aspect
                .max((b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3)));
            let class = if aspect >= 2.0 {
                VoidClass::Tunnel
            } else {
                VoidClass::Room
            };
            if !class_allowed(target, class) {
                continue;
            }
            // Fizik: zayıf genlik → daha derin. Referans = tier-0 void eşiği.
            let d_est =
                depth_from_amplitude(b.intensity, calib.void_thr, 3.0, cover_ref, deep_range_m);
            // Düşük güven: tier arttıkça + zayıf sinyalde daha da düşük
            let conf = (0.34 - 0.07 * band.tier as f32
                + (b.intensity / calib.void_thr.max(0.05)) * 0.12)
                .clamp(0.15, 0.46);
            let evidence = Evidence {
                snr,
                path_support: 0.0,
                class_margin: 0.0,
                wall_support: 0.0,
                reasons: vec![
                    format!("deep_tier:T{}", band.tier),
                    format!("weak_signal:{:.2}", b.intensity),
                    format!("depth_est:{:.1}m", d_est),
                ],
            };
            match class {
                VoidClass::Tunnel => {
                    if let Some(mut t) = build_tunnel(
                        b,
                        side,
                        map_width_m,
                        map_depth_m,
                        deep_range_m,
                        conf,
                        evidence,
                        wall_cues,
                        signed,
                        w,
                        h,
                        calib.metal_thr,
                    ) {
                        let hh = (t.floor_from_surface_m - t.crown_from_surface_m)
                            .max(t.height_m)
                            .max(0.6);
                        let crown = (d_est - hh * 0.5).max(MIN_COVER_M);
                        t.crown_from_surface_m = crown;
                        t.floor_from_surface_m = crown + hh;
                        t.height_m = hh;
                        t.depth = ((crown + hh * 0.5) / deep_range_m).clamp(0.03, 0.99);
                        t.tier = band.tier;
                        t.depth_estimate_m = d_est;
                        t.confidence = conf;
                        t.geometry.label = format!("olası derin (T{})", band.tier);
                        out_tn.push(t);
                    }
                }
                _ => {
                    if let Some(mut c) = build_chamber(
                        b,
                        VoidClass::Room,
                        side,
                        map_width_m,
                        map_depth_m,
                        deep_range_m,
                        conf,
                        evidence,
                    ) {
                        let hh = c.height_m.max(0.6);
                        let top = (d_est - hh * 0.5).max(MIN_COVER_M);
                        c.top_from_surface_m = top;
                        c.bottom_from_surface_m = top + hh;
                        c.height_m = hh;
                        c.depth = ((top + hh * 0.5) / deep_range_m).clamp(0.03, 0.99);
                        c.height = (hh / deep_range_m).clamp(0.03, 0.95);
                        c.tier = band.tier;
                        c.depth_estimate_m = d_est;
                        c.confidence = conf;
                        c.geometry.label = format!("olası derin (T{})", band.tier);
                        out_ch.push(c);
                    }
                }
            }
            // Bu adayın ayakizini maskeye ekle → sonraki tier çakışmasın
            let pad = 0.02f32;
            let wf = (w.max(1) - 1) as f32;
            let hf = (h.max(1) - 1) as f32;
            let x0 = (((b.cx - b.rx - pad).clamp(0.0, 1.0)) * wf).floor() as i32;
            let x1 = (((b.cx + b.rx + pad).clamp(0.0, 1.0)) * wf).ceil() as i32;
            let y0 = (((b.cy - b.ry - pad).clamp(0.0, 1.0)) * hf).floor() as i32;
            let y1 = (((b.cy + b.ry + pad).clamp(0.0, 1.0)) * hf).ceil() as i32;
            for y in y0..=y1 {
                for x in x0..=x1 {
                    if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
                        continue;
                    }
                    mask[(y as u32 * w + x as u32) as usize] = true;
                }
            }
        }
    }
    (out_ch, out_tn)
}

pub fn extract_validated(
    signed: &[f32],
    w: u32,
    h: u32,
    map_width_m: f32,
    map_depth_m: f32,
    depth_range_m: f32,
    view_mode: &str,
    min_confidence: f32,
    target_kind: &str,
    wall_cues: &[WallCue],
    dta_hints: &[StructureHint],
    deep: bool,
    staged: bool,
) -> Result<UndergroundStructures, String> {
    // Derin yapı analizi: kırmızı köprü zorunlu + eşikler gevşetilir (kalan yapılar da çıksın)
    let through_red = deep || crate::app_settings::load_settings().structures_through_red;
    let min_confidence = if deep {
        (min_confidence - 0.18).max(0.2)
    } else {
        min_confidence
    };
    let side = view_mode == "side";
    let (calib, void_blobs, metal_blobs) = prepare_blobs(signed, w, h, through_red, side);
    let vpe = prob_apply::try_vpe_decide(
        &void_blobs,
        &metal_blobs,
        signed,
        w,
        h,
        &calib,
        wall_cues,
        map_width_m,
        map_depth_m,
        depth_range_m,
        view_mode,
        target_kind,
        min_confidence,
        through_red,
        deep,
    )?;
    extract_validated_inner(
        signed,
        w,
        h,
        map_width_m,
        map_depth_m,
        depth_range_m,
        view_mode,
        min_confidence,
        target_kind,
        wall_cues,
        dta_hints,
        deep,
        staged,
        through_red,
        &calib,
        &void_blobs,
        &metal_blobs,
        vpe.as_ref(),
    )
}

/// Kalibrasyon + blob çıkarımı + yan mod parçalama. Hem `extract_validated` hem parite
/// testleri aynı girdiyi üretsin diye ayrıldı.
fn prepare_blobs(
    signed: &[f32],
    w: u32,
    h: u32,
    through_red: bool,
    side: bool,
) -> (FieldCalib, Vec<Blob>, Vec<Blob>) {
    let calib = calibrate_field(signed, w, h);
    let mut void_blobs = connected_blobs_ex(
        signed,
        w,
        h,
        true,
        calib.void_thr,
        calib.min_area,
        through_red,
    );
    let mut metal_blobs =
        connected_blobs(signed, w, h, false, calib.metal_thr, calib.min_area.max(8));
    if side {
        // Metal tepeleri ayır; void'u parçalama — merge sonra birleştirir
        metal_blobs = split_peak_blobs(
            signed,
            w,
            h,
            metal_blobs,
            false,
            calib.metal_thr,
            calib.min_area.max(8),
        );
        // Geniş void'ları tepe noktalarına böl — tek büyük oda AABB'sini kes
        let (wide, narrow): (Vec<_>, Vec<_>) =
            void_blobs.into_iter().partition(|b| b.rx >= 0.09);
        void_blobs = narrow;
        if !wide.is_empty() {
            void_blobs.extend(split_peak_blobs(
                signed,
                w,
                h,
                wide,
                true,
                calib.void_thr,
                calib.min_area.max(20),
            ));
        }
    }
    (calib, void_blobs, metal_blobs)
}

/// Karar hattının ortak gövdesi. `vpe = None` → legacy; `Some(batch)` → VPE kararları
/// (motor çevrimiçiymiş gibi) kullanılır. Parite testleri iki modu da aynı girdiyle
/// koşup çıktı setlerini karşılaştırır.
/// through_red rescue kapısının göreceği conf tabanı (parite — bkz. rescue'daki
/// PARITE NOTU + shared_through_red_branch_markers_parity). VPE-kabul edilen bloblarda
/// engine'in `raw_conf`'u kullanılır (score_void çıktısı — forcing max'leri ve zarf
/// boost'u ÖNCESİ ham skor); legacy / yeniden sınıflandırılan bloblarda `conf` zaten
/// hamdır (classify çıktısı). NEDEN raw_conf TAŞINIYOR: ilk düzeltme (zarf boost'unu
/// de-boost etmek) eksikti — engine'in apply_target_and_policy forcing max'leri
/// (well 0.55, tunnel 0.58, side cut 0.58/0.55, auto shaft 0.64) conf'u 0.42'nin üstüne
/// itince VPE rescue'u atlıyor, legacy ham conf'la ateşliyordu (marker denetimi: 25 vs
/// 23 ateşleme). max() geri alınamayacağı için engine ham değeri açıkça taşır.
pub(crate) fn rescue_gate_conf(conf: f32, vpe_raw_conf: f32, use_vpe: bool, reclassified: bool) -> f32 {
    if use_vpe && !reclassified {
        vpe_raw_conf
    } else {
        conf
    }
}

/// Metal kapı bileşenleri — paylaşılan TEK kaynak (score_metal, margin). Metal
/// zincirinde 'farklı conf tabanı' tuzağı yapısal olarak imkânsızdır: paylaşılan
/// gövdenin metal döngüsünde use_vpe dalı YOKTUR (tek kod yolu — iki yol da aynı
/// snr/score/margin eşiklerini aynı girdiyle görür) ve engine `decide_metals` kararı
/// ortak gövdede TÜKETİLMEZ (yalnızca DecisionBatch rapor sayımlarına girer; metal
/// çıktısı oda/tünel seti paritesinin ardışığıdır). Engine portu birebir olmalıdır —
/// metal_gate_engine_parity bunu kapı yüzeyinde sabitler.
pub(crate) fn metal_gate_components(intensity: f32, fill_ratio: f32, aspect: f32) -> (f32, f32) {
    let mut score_metal = 0.35 + intensity * 0.45 + fill_ratio * 0.2;
    if aspect > 2.4 {
        score_metal -= 0.2;
    }
    let score_noise = (1.1 - intensity).max(0.0) * 0.5;
    let margin = score_metal - score_noise;
    (score_metal, margin)
}

/// through_red rescue ATEŞLENDİĞİNDE conf: VPE yolu legacy ile aynı toplamı üretir
/// (max(0.58) ham tabana, sonra zarf boost'u — legacy'de max(0.58) sonra ~satır
/// 936'daki zarf boost'u eklenir; VPE'de engine boost'u rescue'da ezilmesin).
pub(crate) fn rescue_fire_conf(
    conf: f32,
    rescue_conf: f32,
    use_vpe: bool,
    reclassified: bool,
    zarf: f32,
) -> f32 {
    if use_vpe && !reclassified && zarf >= 0.1 {
        (rescue_conf.max(0.58) + zarf * 0.32 + 0.05).min(0.98)
    } else {
        conf.max(0.58)
    }
}

#[cfg(test)]
mod rescue_gate_tests {
    //! through_red rescue conf tabanı düzeltmesinin regresyonu (PARITE NOTU'na bak).
    //! Case-54 straddle sayılarıyla: legacy raw conf 0.38 < 0.42 (rescue ateşlenir),
    //! engine conf'u 0.502 ≥ 0.42 (erken-zarf boost'u zarf 0.226 ile +0.122). Düzeltme
    //! olmasa VPE rescue'u atlar → sınıf + conf farkı → dedupe sırası → link uç sırası
    //! (bearing 180° + floor kayması). İlk düzeltme zarf boost'unu de-boost ediyordu;
    //! shared_through_red_branch_markers_parity bunun EKSİK olduğunu yakaladı (25 vs 23
    //! ateşleme): engine'in forcing max'leri (well/tunnel/side cut/auto shaft) de conf'u
    //! 0.42 üstüne itiyordu. Artık engine `raw_conf`'u (score_void çıktısı — tüm
    //! modifikasyonlar öncesi) açıkça taşır; bu testler o taban seçimini sabitler.
    //!
    //! NEDEN TAM PİPLINE SENARYOSU DEĞİL: through_red koridor path'i her zaman 1.0'dır
    //! (path_samples'ta her değer bir isabet: v ≤ -soft, v ≥ fill, |v| ≤ soft·1.15 veya
    //! v > 0.0 bantları tüm reel değerleri kapsar) → tünel conf'u ≥ 0.52. Kabul edilen
    //! zayıf odalarda da fill·min_area duvarı: tespit edilen blob fill ≥ ~0.4 (bbox ≤
    //! ~25 px², min_area 10 px) → room conf ≥ 0.438. Yani [~0.35, 0.42) straddle bölgesi
    //! gerçek pipeline'da yapısal olarak erişilemez; semantik birim testi bu yüzden
    //! kalıcı korumadır (süpürmede zayıf TÜNELLER rescue'u ateşler — marker testi).
    use super::{rescue_fire_conf, rescue_gate_conf};

    #[test]
    fn legacy_path_keeps_conf() {
        // Legacy: kapı noktasında conf hamdır — vpe_raw_conf yok sayılır.
        assert_eq!(rescue_gate_conf(0.38, 0.9, false, false), 0.38);
        assert_eq!(rescue_gate_conf(0.38, 0.9, false, true), 0.38);
    }

    #[test]
    fn vpe_accepted_uses_engine_raw_conf() {
        // Case-54 v0: engine conf 0.502 (zarf boost +0.122 ile) ama raw 0.38.
        // Kapı raw_conf'u görür → 0.38 < 0.42 → rescue ateşlenir (0.502 ile atlanırdı).
        let gated = rescue_gate_conf(0.502, 0.38, true, false);
        assert_eq!(gated, 0.38, "engine raw_conf kullanılmalı");
        assert!(gated < 0.42, "ham taban rescue'u ateşlemeli");
    }

    #[test]
    fn vpe_forced_conf_still_uses_raw() {
        // Marker denetiminin düzeltmesi (25 vs 23): engine side cut conf'u 0.58'e
        // max'ladı (raw 0.35) — kapı yine raw'ı görmeli, yoksa VPE rescue'u atlar.
        let gated = rescue_gate_conf(0.58, 0.35, true, false);
        assert_eq!(gated, 0.35);
        assert!(gated < 0.42, "forcing max'i kapıyı kandırmamalı");
    }

    #[test]
    fn reclassified_vpe_keeps_conf() {
        // Engine reddetti + through_red kurtarması → yeniden sınıflandırılan blob:
        // conf zaten ham (classify çıktısı) — raw_conf kullanılmaz.
        assert_eq!(rescue_gate_conf(0.38, 0.9, true, true), 0.38);
    }

    #[test]
    fn fire_converges_both_paths() {
        // Rescue ateşlendiğinde iki yol aynı toplamı üretmeli. Legacy: max(0.58) ham
        // conf'a, sonra ~satır 936'daki zarf boost'u (+0.122). VPE: aynı işlem tek
        // fonksiyonda (engine boost'u max() tarafından yutulmaz).
        let legacy_total = (0.38f32.max(0.58)) + 0.226 * 0.32 + 0.05;
        let vpe_total = rescue_fire_conf(0.502, 0.38, true, false, 0.226);
        assert_eq!(vpe_total, legacy_total.min(0.98), "iki yol aynı conf üretmeli");
        assert!(vpe_total > 0.62, "rescue conf'u güçlendirmeli, {vpe_total}");
    }

    #[test]
    fn fire_legacy_is_plain_max() {
        // Legacy ateşleme: conf.max(0.58) — boost dışarıda (shared body ekler).
        assert_eq!(rescue_fire_conf(0.38, 0.38, false, false, 0.226), 0.58);
        assert_eq!(rescue_fire_conf(0.9, 0.9, false, false, 0.226), 0.9);
    }

    #[test]
    fn fire_vpe_without_zarf_is_plain_max() {
        assert_eq!(rescue_fire_conf(0.5, 0.5, true, false, 0.05), 0.58);
        assert_eq!(rescue_fire_conf(0.9, 0.9, true, false, 0.05), 0.9);
    }
}

fn extract_validated_inner(
    signed: &[f32],
    w: u32,
    h: u32,
    map_width_m: f32,
    map_depth_m: f32,
    depth_range_m: f32,
    view_mode: &str,
    min_confidence: f32,
    target_kind: &str,
    wall_cues: &[WallCue],
    dta_hints: &[StructureHint],
    deep: bool,
    staged: bool,
    through_red: bool,
    calib: &FieldCalib,
    void_blobs: &[Blob],
    metal_blobs: &[Blob],
    vpe: Option<&crate::prob_client::DecisionBatch>,
) -> Result<UndergroundStructures, String> {
    let target = normalize_target(view_mode, target_kind);
    let side = view_mode == "side";
    let mut rejected = 0u32;
    let mut chambers = Vec::new();
    let mut tunnels = Vec::new();
    let mut accepted_void: Vec<(Blob, VoidClass, f32, f32, f32, Vec<String>)> = Vec::new();

    let vpe_voids = vpe.map(prob_apply::void_decision_map);
    let use_vpe = vpe.map(|d| !d.stub).unwrap_or(false);

    let snr_gate = if deep { 1.05 } else { 1.35 };
    for (vi, b) in void_blobs.iter().enumerate() {
        let snr = b.intensity / calib.noise_std.max(0.04);
        if snr < snr_gate {
            rejected += 1;
            continue;
        }

        let vid = format!("v{vi}");
        let mut why: Vec<String> = Vec::new();
        let near_red_early = near_metal_blob(b, &metal_blobs);
        let (mut class, mut conf, mut margin, mut path_s) =
            if let Some(map) = vpe_voids.as_ref() {
                if let Some(d) = map.get(&vid) {
                    // through_red: VPE reject'ini yutma — kırmızı path/komşu VPE'yi yanıltır
                    if d.action == "reject" {
                        if through_red && b.intensity >= 0.22 {
                            why.push(if near_red_early {
                                "rewrite:vpe_reject_near_red".into()
                            } else {
                                "rewrite:vpe_reject_through_red".into()
                            });
                            if side {
                                classify_void_side(
                                    b,
                                    signed,
                                    w,
                                    h,
                                    calib.void_thr,
                                    map_width_m,
                                    depth_range_m,
                                    true,
                                )
                            } else {
                                classify_void_top(
                                    b,
                                    signed,
                                    w,
                                    h,
                                    calib.void_thr,
                                    map_width_m,
                                    map_depth_m,
                                    true,
                                )
                            }
                        } else {
                            rejected += 1;
                            continue;
                        }
                    } else {
                        let class = prob_apply::class_from_vpe(&d.class).unwrap_or(VoidClass::Noise);
                        let (x0, y0, x1, y1) = tunnel_path_endpoints(b, side);
                        let path_s = path_structure_support(
                            signed,
                            w,
                            h,
                            x0,
                            y0,
                            x1,
                            y1,
                            calib.void_thr,
                            through_red || side,
                        );
                        why = d.reasons.clone();
                        if why.is_empty() {
                            why.push(format!("vpe:{}", d.class));
                        }
                        why.push(format!("conf:{:.0}%", d.conf * 100.0));
                        (class, d.conf, d.margin, path_s)
                    }
                } else if side {
                    classify_void_side(
                        b,
                        signed,
                        w,
                        h,
                        calib.void_thr,
                        map_width_m,
                        depth_range_m,
                        through_red,
                    )
                } else {
                    classify_void_top(
                        b,
                        signed,
                        w,
                        h,
                        calib.void_thr,
                        map_width_m,
                        map_depth_m,
                        through_red,
                    )
                }
            } else if side {
                classify_void_side(
                    b,
                    signed,
                    w,
                    h,
                    calib.void_thr,
                    map_width_m,
                    depth_range_m,
                    through_red,
                )
            } else {
                classify_void_top(
                    b,
                    signed,
                    w,
                    h,
                    calib.void_thr,
                    map_width_m,
                    map_depth_m,
                    through_red,
                )
            };
        // Kırmızı yapıya engel değil: path skorunu koridor modunda yeniden hesapla
        if through_red {
            let (x0, y0, x1, y1) = tunnel_path_endpoints(b, side);
            path_s = path_structure_support(
                signed,
                w,
                h,
                x0,
                y0,
                x1,
                y1,
                calib.void_thr,
                true,
            );
        }
        // Engine kararı kullanılmadıysa (reject → yeniden sınıflandırma veya map dışı)
        // common-body `!use_vpe` guard'ları legacy gibi uygulanmalı: engine bu blobda
        // zarf boost'unu / kapılarını yapmadı (reddedilen kararı atıldı). Aksi halde
        // VPE-reddedilen + through_red kurtarması geçen blobların conf'u legacy'den
        // düşük kalır (ör. dedupe sırası → link uç ataması farklılaşırdı).
        let reclassified = vpe_voids.as_ref().map_or(false, |map| {
            map.get(&vid).map_or(true, |d| d.action == "reject")
        });
        // Engine kendi kararında Tunnel ile bitirdiyse path kapısını uygulamış demektir;
        // ortak gövde sonradan sınıfı değiştirmediyse (rescue/forcing) kesim tekrar
        // gerekmez. Engine "room" ile bitirip ortak gövde rescue ile Tunnel'a çevirdiyse
        // (ör. through_red kurtarması) kesim engine'de YAPILMADI — legacy ile aynı
        // sonucu vermek için burada uygulanmalı (parite: auto/side/case=39).
        let engine_tunnel = vpe_voids.as_ref().map_or(false, |map| {
            map.get(&vid).map_or(false, |d| {
                d.action == "accept"
                    && prob_apply::class_from_vpe(&d.class).unwrap_or(VoidClass::Noise)
                        == VoidClass::Tunnel
            })
        });
        // through_red: Noise / düşük conf → oda veya tünel (kırmızı engel değil)
        // PARITE NOTU (bearing/floor sapması — araştırma kaydı + marker denetimi):
        // rescue kapısı `conf < 0.42` her iki yolda AYNI conf tabanını görmeli.
        // Legacy'de bu noktada conf henüz hiçbir boost/forcing almamıştır (hepsi
        // aşağıda); VPE'de engine conf'u zarf boost'u + forcing max'lerini (well 0.55,
        // tunnel 0.58, side cut 0.58/0.55, auto shaft 0.64) içerir — de-boost bunları
        // geri alamazdı (marker testi 25 vs 23 ateşleme sapmasını yakaladı). Çözüm:
        // engine score_void çıktısını `raw_conf` olarak taşır; kapı VPE-kabul edilen
        // bloblarda onu kullanır. Sınıf + conf farkı → dedupe_voids sıralaması → link
        // uç sırası (bearing 180° + floor kayması) zincirini önler. Legacy davranışı
        // hiç değişmez (use_vpe dışında etkisiz).
        let zarf_early = wall_ring_support(b, wall_cues)
            .max(green_line_tunnel_support(b, wall_cues) * 0.9);
        if through_red && b.intensity >= 0.22 {
            let aspect = b
                .axis_aspect
                .max((b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3)));
            let rescue_ok = near_red_early || path_s >= 0.12 || aspect >= 1.9 || b.fill_ratio >= 0.28;
            let vpe_raw_conf = vpe_voids
                .as_ref()
                .and_then(|m| m.get(&vid))
                .map(|d| d.raw_conf)
                .unwrap_or(conf);
            let rescue_conf = rescue_gate_conf(conf, vpe_raw_conf, use_vpe, reclassified);
            if rescue_ok && (class == VoidClass::Noise || rescue_conf < 0.42) {
                if aspect >= 2.0 || path_s >= 0.18 {
                    class = VoidClass::Tunnel;
                } else {
                    class = VoidClass::Room;
                }
                conf = rescue_fire_conf(conf, rescue_conf, use_vpe, reclassified, zarf_early);
                margin = margin.max(0.12);
                why.push("rewrite:through_red_rescue".into());
            }
        }
        if why.is_empty() {
            why.push(format!(
                "score:{}",
                match class {
                    VoidClass::Room => "room",
                    VoidClass::Tomb => "tomb",
                    VoidClass::Tunnel => "tunnel",
                    VoidClass::Shaft => "shaft",
                    VoidClass::Noise => "noise",
                }
            ));
            why.push(format!("snr:{snr:.1}"));
            why.push(format!("margin:{margin:.2}"));
            if path_s > 0.05 {
                why.push(format!("path:{:.0}%", path_s * 100.0));
            }
        }

        // Hedef kapısı: kuyu seçiliyse kompakt / dikey adayı şafta zorla
        if target == "well" && !side && well_like_plan(b, map_width_m, map_depth_m) {
            class = VoidClass::Shaft;
            conf = conf.max(0.55);
        }
        if target == "well" && side {
            let aspect_y = b.ry / b.rx.max(1e-3);
            let height_m = (b.ry * 2.0 * crate::surface::SIDE_CLASS_REF_M).max(0.2);
            if aspect_y >= 1.25 || height_m >= 1.0 {
                class = VoidClass::Shaft;
                conf = conf.max(0.55);
            }
        }
        if target == "site" && class == VoidClass::Shaft {
            rejected += 1;
            continue;
        }

        // Hedef Tünel: oda/şaft adaylarını koridora çevir (yanında Tunnel→Oda ezmesi yüzünden sıfır yapı kalıyordu)
        // Engine aynı forcing'i uygular; burada tekrar uygulamak idempotent (sınıf sabit,
        // conf max). class_allowed kontrolü legacy ile aynı sınıfı görmeli — engine'in path
        // kapısı (karar içinde) sınıfı room'a çevirmiş olsa bile bu zorlama legacy'deki
        // sırayı (zorla → kontrol → kapı) korur, sonraki path kapısı tekrar düzeltir.
        if target == "tunnel" {
            if matches!(
                class,
                VoidClass::Room | VoidClass::Tomb | VoidClass::Shaft
            ) || (class == VoidClass::Noise && b.intensity >= 0.28)
            {
                class = VoidClass::Tunnel;
                conf = conf.max(0.58);
            }
        }

        if !class_allowed(target, class) {
            rejected += 1;
            continue;
        }

        // Yan çekim: tünel adayı ama oda kesiti gibi → odaya çevir (mavi altı oda kalsın)
        // Hedef açıkça Tünel ise çevirme — aksi halde odaya dönüp sonra silinir.
        // Kırmızı dolgu path'i böler → path düşük diye koridoru odaya EZME.
        // through_red: kırmızı yanında path düşük → odaya çevirme.
        // Engine kendi kararında Tunnel ile bitirmediyse bu kesimi uygula — engine
        // yalnızca kendi sınıflandırdığı Tunnel'lara path kapısı uygular; ortak gövde
        // sonradan Tunnel'a çevirdiyse (through_red rescue / forcing) kesim engine'de
        // yoktur ve legacy paritesi için burada gereklidir (bkz. engine_tunnel).
        if !engine_tunnel && side && class == VoidClass::Tunnel && target != "tunnel" {
            let measured_h = (b.ry * 2.0 * crate::surface::SIDE_CLASS_REF_M).max(0.35);
            let aspect_x = b.rx / b.ry.max(1e-3);
            let room_cut = measured_h >= 1.0 || aspect_x < 2.45 || (b.intensity >= 0.45 && aspect_x < 2.8);
            if room_cut && !near_red_early {
                class = VoidClass::Room;
                conf = conf.max(0.58);
            } else if room_cut && near_red_early && aspect_x < 2.0 && !through_red {
                // Legacy: kalın + kırmızı → oda; through_red açıkken tünelde bırak
                class = VoidClass::Room;
                conf = conf.max(0.58);
            } else if path_s < 0.38 && !near_red_early {
                class = VoidClass::Room;
                conf = conf.max(0.55);
            } else if path_s < 0.38 && near_red_early && !through_red {
                class = VoidClass::Room;
                conf = conf.max(0.55);
            }
            // near_red + through_red → tünelde bırak (kırmızı engellemesin)
        }
        // Yan + otomatik: geniş/zarflı şaft → oda (kuyu yalnızca dar sütun)
        if side && target == "auto" && class == VoidClass::Shaft {
            let span_x = b.rx * 2.0 * map_width_m;
            let aspect_y = b.ry / b.rx.max(1e-3);
            let narrow = span_x <= 1.15 && aspect_y >= 2.35;
            if !narrow {
                class = VoidClass::Room;
                conf = conf.max(0.64);
            }
        }

        let aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
        // Zarf erken: conf kapısından önce oda/tüneli kurtarır. VPE path'inde boost'u
        // decide() kapı öncesi uyguladı — burada tekrar uygulamak çift boost olur.
        let (wall_s, wall_clarity) = wall_ring_support_with_clarity(b, wall_cues);
        let line_s = green_line_tunnel_support(b, wall_cues);
        let zarf = wall_s.max(line_s * 0.9);
        if zarf >= 0.1 && (!use_vpe || reclassified) {
            conf = (conf + zarf * 0.32 + 0.05).min(0.98);
        }
        // Beyaz/nötr zarf varken yan şaft → oda
        if side
            && class == VoidClass::Shaft
            && zarf >= 0.12
            && target != "well"
            && class_allowed(target, VoidClass::Room)
        {
            class = VoidClass::Room;
            conf = (conf.max(0.66) + zarf * 0.2).min(0.97);
        }

        let margin_need = if through_red {
            0.02
        } else if zarf >= 0.22 {
            0.04
        } else if class == VoidClass::Tunnel && aspect >= 1.8 {
            0.07
        } else if side {
            0.06
        } else {
            0.12
        };
        let conf_need = if through_red {
            (min_confidence - 0.24).max(0.2)
        } else if zarf >= 0.2 {
            (min_confidence - 0.18).max(0.26)
        } else if target == "tunnel" || class == VoidClass::Tunnel {
            (min_confidence - 0.12).max(0.25)
        } else if side {
            (min_confidence - 0.12).max(0.32)
        } else {
            min_confidence
        };
        // Zarf varken Noise → oda/tünel adayına çek
        if class == VoidClass::Noise && zarf >= 0.16 {
            if line_s >= 0.2 && aspect >= 1.45 {
                class = VoidClass::Tunnel;
            } else {
                class = VoidClass::Room;
            }
            conf = conf.max(0.55);
        }
        // through_red: conf kapısından önce bir kez daha kurtar
        if through_red
            && (class == VoidClass::Noise || conf < conf_need || margin < margin_need)
            && b.intensity >= 0.22
        {
            let asp = b
                .axis_aspect
                .max((b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3)));
            class = if asp >= 1.9 || path_s >= 0.14 {
                VoidClass::Tunnel
            } else {
                VoidClass::Room
            };
            conf = conf.max(conf_need + 0.05).max(0.55);
            margin = margin.max(margin_need + 0.02);
            why.push("rewrite:through_red_gate".into());
        }
        if class == VoidClass::Noise || margin < margin_need || conf < conf_need {
            rejected += 1;
            continue;
        }

        // Kırmızı komşuluk: silme nedeni değil — yapı önce, metal sonra kesişir
        let near_red = near_red_early || near_metal_blob(b, &metal_blobs);

        // VPE-kabul edilen bloblarda da çalışır: engine aynı kapıyı karar içinde uygular;
        // tekrar uygulamak idempotent (aynı path_s/aspect, max'lı conf). Atlamak legacy
        // ile sınıf sapması yaratırdı — forcing (yukarıda) engine'in path kapısıyla room'a
        // çevirdiği blobu tekrar tunnel yapar; bu kapı onu legacy'deki gibi düzeltir.
        if class == VoidClass::Tunnel {
            let aspect = b
                .axis_aspect
                .max((b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3)));
            let measured_h = if side {
                (b.ry * 2.0 * crate::surface::SIDE_CLASS_REF_M).max(0.35)
            } else {
                0.0
            };
            let path_need = if through_red {
                // Kırmızı yapıya engel değil — path eşiği yok
                0.0
            } else if side {
                if measured_h > 1.35 || aspect < 2.45 {
                    // İnce koridor değil → oda olarak kabul et (kırmızı hariç tutuldu yukarıda)
                    if !near_red {
                        class = VoidClass::Room;
                        conf = conf.max(0.55);
                    } else if !through_red {
                        class = VoidClass::Room;
                        conf = conf.max(0.55);
                    }
                    0.0
                } else if near_red {
                    // Kırmızı dolgu path skorunu düşürür; tüneli silme / eşik yok
                    0.0
                } else if aspect >= 2.8 {
                    0.42
                } else {
                    0.52
                }
            } else if near_red {
                0.0 // kırmızı path'i kesse bile tüneli tut
            } else if aspect >= 2.6 {
                0.38
            } else if aspect >= 2.2 {
                0.48
            } else {
                0.62
            };
            if class == VoidClass::Tunnel
                && path_need > 0.0
                && (path_s < path_need || (!side && aspect < 2.15 && !near_red))
            {
                if near_red || through_red {
                    // Kırmızı içinde/çıkışında koridor — asla silme
                    conf = conf.max(0.58);
                } else {
                    rejected += 1;
                    continue;
                }
            }
            if class == VoidClass::Tunnel && near_red {
                conf = conf.max(0.6);
            }
        }

        // Beyaz/nötr zarf + yeşil çizgi: oda/tüneli net güçlendir
        let emerge = emergence_with_cue(b.intensity, b.fill_ratio, zarf);

        if zarf >= 0.08 {
            conf = (conf + zarf * 0.28 + 0.04).min(0.98);
            if margin < 0.2 {
                conf = (conf + zarf * 0.14).min(0.98);
            }
        }
        if emerge >= 0.4 && zarf >= 0.1 {
            conf = (conf + emerge * 0.18).min(0.98);
        }
        // Kırmızı komşu + zarf → yapı içi/çıkış ilişkisi net
        if near_red && matches!(class, VoidClass::Room | VoidClass::Tomb | VoidClass::Tunnel) {
            conf = (conf + 0.12).min(0.98);
            if zarf >= 0.1 {
                conf = (conf + 0.1).min(0.98);
            }
        }

        // Yeşil çizgi → tünel (daha düşük eşik, daha yüksek conf)
        if line_s >= 0.12 && class_allowed(target, VoidClass::Tunnel) {
            let aspect = b
                .axis_aspect
                .max((b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3)));
            let side_line_ok = side && (aspect >= 1.25 || line_s >= 0.2 || emerge >= 0.45);
            if aspect >= 1.45 || line_s >= 0.22 || side_line_ok {
                class = VoidClass::Tunnel;
                conf = (conf.max(0.58) + line_s * 0.42).min(0.97);
            }
        }

        // Beyaz/nötr zarf → oda (tünel/noise'tan çek)
        if matches!(class, VoidClass::Tunnel | VoidClass::Noise | VoidClass::Room)
            && wall_s >= 0.14
            && line_s < 0.28
            && class_allowed(target, VoidClass::Room)
        {
            let aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
            let roomish = aspect < 2.6 || wall_s >= 0.28 || (side && wall_s >= 0.16);
            if roomish && (side || aspect < 2.35 || wall_s >= 0.32) {
                // Uzun ince + güçlü yeşil çizgi ise tünelde bırak
                if !(class == VoidClass::Tunnel && line_s >= 0.28 && aspect >= 2.2) {
                    class = VoidClass::Room;
                    // Duvar netliği低e conf cezası uygula
                    let wall_boost = if wall_clarity >= 0.6 {
                        // Net, keskin duvarlar → normal boost
                        wall_s * 0.35
                    } else if wall_clarity >= 0.3 {
                        // Orta netlik → düşük boost
                        wall_s * 0.15
                    } else {
                        // Bulanık duvarlar → boost yok (dolgu alanı olabilir)
                        0.0
                    };
                    conf = (conf.max(0.55) + wall_boost).min(0.97);
                    // Duvar çok net değilse belirsiz olarak işaretle
                    if wall_clarity < 0.3 {
                        why.push("uncertain:blurry_walls".into());
                    }
                }
            }
        }

        // Yan: mavi + zarf → oda (ek güvence — mavi altı oda kalsın)
        if side
            && matches!(class, VoidClass::Tunnel | VoidClass::Noise)
            && wall_s >= 0.1
            && b.rx * 2.0 * map_width_m >= 0.7
            && class_allowed(target, VoidClass::Room)
        {
            let aspect_x = b.rx / b.ry.max(1e-3);
            // İnce uzun + güçlü yeşil çizgi ise tünelde bırak
            if !(aspect_x >= 2.6 && line_s >= 0.22) {
                class = VoidClass::Room;
                conf = (conf.max(0.64) + wall_s * 0.28).min(0.97);
            }
        }

        // Zayıf boyalı + zarfsız + kırmızı ilişkisi yok → gürültü
        if side
            && matches!(class, VoidClass::Room | VoidClass::Tomb)
            && emerge < 0.35
            && zarf < 0.14
            && !near_red
        {
            rejected += 1;
            continue;
        }

        // Dik: kompakt zarf → oda (zayıf tüneli ez)
        if !side
            && wall_s >= 0.2
            && line_s < 0.22
            && class == VoidClass::Tunnel
            && class_allowed(target, VoidClass::Room)
        {
            let aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
            if aspect < 2.5 {
                class = VoidClass::Room;
                conf = (conf.max(0.6) + wall_s * 0.3).min(0.97);
            }
        }

        accepted_void.push((b.clone(), class, conf, snr, margin, why));
    }

    // through_red: içi kırmızı dolu yapı — void parçalanıp silindiyse metal etrafında oda/tünel kurtar
    if through_red {
        for mb in metal_blobs {
            let covered = accepted_void.iter().any(|(vb, ..)| {
                let dx = (mb.cx - vb.cx).abs() / (vb.rx + mb.rx + 0.02).max(1e-3);
                let dy = (mb.cy - vb.cy).abs() / (vb.ry + mb.ry + 0.02).max(1e-3);
                dx * dx + dy * dy < 1.8
            });
            if covered {
                continue;
            }
            let wall_s = wall_ring_support(mb, wall_cues);
            let line_s = green_line_tunnel_support(mb, wall_cues);
            let near_v = near_void_blob(mb, &void_blobs);
            if wall_s < 0.08 && line_s < 0.08 && !near_v && mb.intensity < 0.38 {
                continue;
            }
            let snr = mb.intensity / calib.noise_std.max(0.04);
            if snr < 1.2 {
                continue;
            }
            let mut b = mb.clone();
            b.rx = (mb.rx * 1.4).clamp(0.025, 0.38);
            b.ry = (mb.ry * 1.4).clamp(0.025, 0.38);
            b.intensity = mb.intensity.max(0.48);
            let aspect = b
                .axis_aspect
                .max((b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3)));
            let class = if aspect >= 2.15 || line_s >= 0.18 {
                VoidClass::Tunnel
            } else {
                VoidClass::Room
            };
            if !class_allowed(target, class) {
                continue;
            }
            accepted_void.push((
                b,
                class,
                0.62_f32.max(min_confidence),
                snr,
                0.14,
                vec!["rewrite:red_interior_host".into()],
            ));
        }
    }

    // Yan: parçaları birleştirme — tek koridora asker dizilimi yaratıyordu
    // (her boşluk kendi cx/cy konumunda kalsın)

    accepted_void = dedupe_voids(accepted_void);
    if side {
        accepted_void = merge_side_void_parts(accepted_void, depth_range_m);
        // İkinci geçiş: hâlâ bitişik parçalar
        accepted_void = merge_side_void_parts(accepted_void, depth_range_m);
    }

    for (b, class, conf, snr, margin, why) in &accepted_void {
        if !class_allowed(target, *class) {
            rejected += 1;
            continue;
        }
        let wall_s = wall_ring_support(b, wall_cues);
        let line_s = green_line_tunnel_support(b, wall_cues);
        let structure_cue = wall_s.max(line_s);
        // Geometri kaynağı = anomali blob'u; duvar yalnızca kenarı hafifçe netleştirir
        let mut b_fit = b.clone();
        if wall_s >= 0.2 {
            if let Some((x0, y0, x1, y1)) = wall_bounds_around(b, wall_cues) {
                let wrx = ((x1 - x0) * 0.5).max(0.01);
                let wry = ((y1 - y0) * 0.5).max(0.01);
                let wcx = (x0 + x1) * 0.5;
                let wcy = (y0 + y1) * 0.5;
                // Duvar bbox blob'dan çok sapıyorsa yok say (HUD / yanlış highlight)
                let dx = (wcx - b.cx).abs();
                let dy = (wcy - b.cy).abs();
                let size_ok = wrx <= b.rx * 1.55
                    && wry <= b.ry * 1.55
                    && wrx >= b.rx * 0.55
                    && wry >= b.ry * 0.55;
                if size_ok && dx < b.rx * 0.85 && dy < b.ry * 0.85 {
                    b_fit.cx = (b.cx * 0.72 + wcx * 0.28).clamp(0.0, 1.0);
                    b_fit.cy = (b.cy * 0.72 + wcy * 0.28).clamp(0.0, 1.0);
                    b_fit.rx = (b.rx * 0.75 + wrx * 0.25).clamp(0.01, 0.45);
                    b_fit.ry = (b.ry * 0.75 + wry * 0.25).clamp(0.01, 0.45);
                }
            }
        }
        let path_s = if *class == VoidClass::Tunnel {
            let (x0, y0, x1, y1) = tunnel_path_endpoints(&b_fit, side);
            path_structure_support(
                signed,
                w,
                h,
                x0,
                y0,
                x1,
                y1,
                calib.void_thr,
                through_red || side,
            )
        } else {
            0.0
        };
        let mut reasons = why.clone();
        if structure_cue >= 0.1 {
            reasons.push(format!("zarf:{:.0}%", structure_cue * 100.0));
        }
        if path_s >= 0.1 && !reasons.iter().any(|r| r.starts_with("path:")) {
            reasons.push(format!("path:{:.0}%", path_s * 100.0));
        }
        let evidence = Evidence {
            snr: *snr,
            path_support: path_s.max(structure_cue * 0.5),
            class_margin: *margin,
            wall_support: structure_cue,
            reasons,
        };

        match class {
            VoidClass::Tunnel => {
                if let Some(t) = build_tunnel(
                    &b_fit,
                    side,
                    map_width_m,
                    map_depth_m,
                    depth_range_m,
                    *conf,
                    evidence.clone(),
                    wall_cues,
                    signed,
                    w,
                    h,
                    calib.metal_thr,
                ) {
                    tunnels.push(t);
                } else {
                    rejected += 1;
                }
            }
            VoidClass::Room | VoidClass::Tomb | VoidClass::Shaft => {
                if let Some(c) = build_chamber(
                    &b_fit,
                    *class,
                    side,
                    map_width_m,
                    map_depth_m,
                    depth_range_m,
                    *conf,
                    evidence,
                ) {
                    chambers.push(c);
                } else {
                    rejected += 1;
                }
            }
            VoidClass::Noise => rejected += 1,
        }
    }

    // Yan: aşırı geniş odayı bitişik kutulara böl; link tüneli bağlar
    if side {
        chambers = fragment_oversized_side_chambers(chambers, map_width_m);
    }

    // Yeşil→beyaz→yeşil düz çizgi segmentleri → tünel (mavi blob olmasa da)
    if allow_link_tunnels(target) || class_allowed(target, VoidClass::Tunnel) {
        let segs = extract_green_line_segments(wall_cues);
        for seg in segs {
            if let Some(t) =
                build_tunnel_from_green_line(
                    &seg,
                    side,
                    map_width_m,
                    map_depth_m,
                    depth_range_m,
                    min_confidence,
                )
            {
                if tunnel_overlaps_existing(&t, &tunnels) {
                    rejected += 1;
                    continue;
                }
                // Mevcut oda ile aynı yerdeyse odayı ezme; çizgi oda duvarı olabilir
                let hits_room = chambers.iter().any(|c| {
                    let mx = (t.x0 + t.x1) * 0.5;
                    let my = if side {
                        (c.top_from_surface_m + c.bottom_from_surface_m) * 0.5 / depth_range_m
                    } else {
                        c.cy
                    };
                    let dx = mx - c.cx;
                    let dy = if side {
                        let ty = ((t.crown_from_surface_m + t.floor_from_surface_m) * 0.5)
                            / depth_range_m;
                        ty - my
                    } else {
                        my - c.cy
                    };
                    dx * dx + dy * dy < (c.rx.max(0.04) + 0.03).powi(2)
                });
                // Yan: oda planı altındaki uzun çizgi de tünel olmasın (mavi altı oda)
                let hits_room_plan = side
                    && chambers.iter().any(|c| {
                        let mx = (t.x0 + t.x1) * 0.5;
                        (mx - c.cx).abs() <= c.rx.max(0.05) + 0.04
                    });
                if (hits_room && seg.length < 0.14) || hits_room_plan {
                    continue;
                }
                tunnels.push(t);
            }
        }
    }

    if allow_link_tunnels(target) {
        let vpe_corridor = vpe.map(|d| d.policy_id == "corridor").unwrap_or(false);
        if use_vpe && !vpe_corridor {
            // Standart profil: VPE link kararı legacy motorla bit düzeyinde aynıdır
            // (link_rooms ≡ link_chambers_with_path, parite testi). Parçalanmış yan
            // odalarda legacy motor fragman zincirini doğru üretir — VPE linkleri blob
            // düzeyinde karar verdiği için fragman odalarını göremezdi (pipeline parite
            // testi bu uyuşmazlığı yakaladı). Motoru değiştirmek kararı değiştirmez.
            let link_tunnels = link_chambers_with_path(
                signed,
                w,
                h,
                &chambers,
                calib.void_thr,
                depth_range_m,
                min_confidence,
                side,
                through_red,
            );
            rejected += link_tunnels.1;
            for lt in link_tunnels.0 {
                if tunnel_overlaps_existing(&lt, &tunnels) {
                    rejected += 1;
                    continue;
                }
                tunnels.push(lt);
            }
        } else if use_vpe {
            // Corridor: VPE'ye özgü genişletilmiş link toleransları — VPE kararlarını
            // kullan; uçları parçalanmış odalara yasla (fragman zinciri bu profilde VPE'de
            // ifade edilemez, standart profil zaten legacy motorla aynı kararı verir).
            if let Some(ref dec) = vpe {
                let mut id_to_blob: HashMap<String, &Blob> = HashMap::new();
                let mut depth_of: HashMap<String, (f32, f32, f32)> = HashMap::new();
                for (i, b) in void_blobs.iter().enumerate() {
                    let id = format!("v{i}");
                    id_to_blob.insert(id.clone(), b);
                }
                for d in &dec.depths {
                    depth_of.insert(d.id.clone(), (d.cover_m, d.floor_m, d.height_m));
                }
                for mut lt in prob_apply::tunnels_from_vpe_links(
                    dec,
                    &id_to_blob,
                    &depth_of,
                    depth_range_m,
                    side,
                ) {
                    snap_tunnel_to_chambers(&mut lt, &chambers);
                    if tunnel_overlaps_existing(&lt, &tunnels) {
                        rejected += 1;
                        continue;
                    }
                    tunnels.push(lt);
                }
            }
        } else {
            let link_tunnels = link_chambers_with_path(
                signed,
                w,
                h,
                &chambers,
                calib.void_thr,
                depth_range_m,
                min_confidence,
                side,
                through_red,
            );
            rejected += link_tunnels.1;
            for lt in link_tunnels.0 {
                if tunnel_overlaps_existing(&lt, &tunnels) {
                    rejected += 1;
                    continue;
                }
                tunnels.push(lt);
            }
        }
    }

    if side {
        tunnels = merge_collinear_tunnels(tunnels);
    }

    let mut metals = Vec::new();
    // Metal/kırmızı: yapı (oda/tünel) kabulünden SONRA — kırmızı yapı üretimini engellemez.
    for b in metal_blobs {
        let snr = b.intensity / calib.noise_std.max(0.04);
        if snr < 1.4 {
            rejected += 1;
            continue;
        }
        let aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
        let (score_metal, margin) = metal_gate_components(b.intensity, b.fill_ratio, aspect);
        if margin < 0.12 || score_metal < min_confidence {
            rejected += 1;
            continue;
        }

        let near_v = near_void_blob(b, &void_blobs)
            || near_accepted_structure(b, &chambers, &tunnels, side);
        let bloom = positive_bloom_ring(b, signed, w, h, wall_cues);
        let interp = interpret_red_cue(
            b,
            side,
            depth_m_probe(b, side, depth_range_m),
            depth_range_m,
            near_v,
            bloom,
        );
        let cue = interp.cue;

        // Dik çekim + hedef Kuyu: kapak/ağız (metal/oksit/yüzey) → şaft gövdesi
        let cue_ok_for_well = matches!(
            cue,
            "metal" | "oxidation" | "surface_exit" | "field"
        );
        if !side
            && allow_metal_to_shaft(target)
            && cue_ok_for_well
            && well_like_plan(b, map_width_m, map_depth_m)
        {
            let already = chambers.iter().any(|c| {
                c.kind == "shaft"
                    && ((c.cx - b.cx).powi(2) + (c.cy - b.cy).powi(2)).sqrt() < 0.14
            });
            if !already {
                let conf = (score_metal * 0.92).clamp(0.4, 0.98);
                if let Some(mut c) = build_chamber(
                    b,
                    VoidClass::Shaft,
                    false,
                    map_width_m,
                    map_depth_m,
                    depth_range_m,
                    conf,
                    Evidence {
                        snr,
                        path_support: 0.0,
                        class_margin: margin,
                        wall_support: 0.0,
                        reasons: vec!["well_from_metal".into()],
                    },
                ) {
                    let d = well_physical_diameter_m(b, map_width_m, map_depth_m);
                    c.width_m = d;
                    c.length_m = d;
                    chambers.push(c);
                    // Kapak metalini düz disk olarak ekleme — şaft çizilecek
                    continue;
                }
            } else {
                // Zaten şaft var; bu metal ayakizini atla
                continue;
            }
        }

        let (depth_m, cx, cy) = if side {
            (
                depth_m_probe(b, true, depth_range_m),
                b.cx,
                b.cy,
            )
        } else {
            let e = surface_emergence(b.intensity, b.fill_ratio);
            let deep_cap = (depth_range_m * (0.18 + (1.0 - e).powf(1.45) * 0.3)).max(0.55);
            (
                burial_from_emergence(e, 0.15, deep_cap).clamp(0.12, depth_range_m),
                b.cx,
                b.cy,
            )
        };
        // Yüzey çıkışı / yapı ipucu: derinliği sığ tut (ama aşırı yapıştırma)
        let depth_m = if cue == "surface_exit" {
            depth_m.min(0.55).max(0.08)
        } else {
            let e = surface_emergence(b.intensity, b.fill_ratio);
            burial_from_emergence(e, 0.12, depth_m.max(0.35)).clamp(0.1, depth_range_m)
        };
        let width_m = (b.rx * 2.0 * map_width_m).clamp(0.35, map_width_m * 0.95);
        let (length_m, plume_height_m, spread_m) = if side {
            let along_z = (b.ry * 2.0 * map_depth_m).clamp(0.35, map_depth_m * 0.95);
            let e = surface_emergence(b.intensity, b.fill_ratio);
            let plume = (0.2 + (1.0 - e) * 1.2).clamp(0.18, depth_range_m * 0.28);
            (along_z, plume, width_m.max(along_z))
        } else {
            let length_m = (b.ry * 2.0 * map_depth_m).max(0.3);
            let spread = width_m.max(length_m);
            (length_m, (spread * 0.35).clamp(0.25, 2.5), spread)
        };
        let size_m = width_m.min(length_m.max(0.15));
        let field_strength = b.intensity.clamp(0.0, 1.0);
        let cue_kind = cue.to_string();
        let metal_guess = interp.metal_guess.to_string();
        let wall_s = wall_ring_support(b, wall_cues).max(bloom * 0.5);
        let bearing_deg = compass::blob_orient_deg(b, side, map_width_m, depth_range_m);
        metals.push(MetalBody {
            cx,
            cy,
            rx: b.rx,
            ry: b.ry,
            depth: (depth_m / depth_range_m).clamp(0.02, 0.95),
            intensity: b.intensity,
            width_m,
            length_m: length_m.max(0.15),
            size_m,
            depth_from_surface_m: depth_m,
            inside_chamber: false,
            host_kind: String::new(),
            spread_m,
            spread_ratio: 1.0,
            field_strength,
            bearing_deg,
            plume_height_m,
            cue_kind,
            metal_guess,
            confidence: score_metal.clamp(0.0, 1.0),
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence {
                snr,
                path_support: bloom,
                class_margin: margin,
                wall_support: wall_s,
                reasons: vec![format!("red_{cue}"), format!("snr:{snr:.1}")],
            },
            geometry: crate::surface::GeometryAnalysis {
                method: format!("red_{}", cue),
                label: interp.label.clone(),
                ..Default::default()
            },
        });
    }

    let n_shaft = chambers.iter().filter(|c| c.kind == "shaft").count();

    // Fallback kuyu: hedef = well ve henüz şaft yoksa — en güçlü pozitif ayakizi
    if !side && target == "well" && n_shaft == 0 && !metals.is_empty() {
        if let Some((_, m)) = metals
            .iter()
            .enumerate()
            .filter(|(_, m)| {
                let aspect = (m.rx / m.ry.max(1e-3)).max(m.ry / m.rx.max(1e-3));
                let diam = (m.rx * 2.0 * map_width_m).min(m.ry * 2.0 * map_depth_m);
                aspect < 3.2 && diam >= 0.3 && diam <= 22.0 && m.intensity >= 0.28
            })
            .max_by(|(_, a), (_, b)| {
                let sa = a.intensity * a.confidence;
                let sb = b.intensity * b.confidence;
                sa.partial_cmp(&sb)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        {
            const WELL_TYPICAL_M: f32 = 7.5;
            let well_cap = depth_range_m.max(WELL_TYPICAL_M + 1.0);
            let footprint = (m.rx * 2.0 * map_width_m)
                .min(m.ry * 2.0 * map_depth_m)
                .max(0.4);
            let diam = if footprint <= 2.8 {
                footprint.clamp(0.55, 2.8)
            } else {
                (footprint * 0.28).clamp(0.8, 2.8)
            };
            let cover = 0.08f32;
            let h = (WELL_TYPICAL_M - cover).clamp(5.5, well_cap - cover);
            let shaft_cx = m.cx;
            let shaft_cy = m.cy;
            chambers.push(Chamber {
                kind: "shaft".into(),
                cx: shaft_cx,
                cy: shaft_cy,
                rx: m.rx,
                ry: m.ry,
                depth: ((cover + h * 0.5) / well_cap).clamp(0.05, 0.98),
                height: (h / well_cap).clamp(0.08, 0.95),
                intensity: m.intensity,
                width_m: diam,
                length_m: diam,
                top_from_surface_m: cover,
                bottom_from_surface_m: (cover + h).min(well_cap),
                height_m: h.min(well_cap - cover),
                bearing_deg: 0.0,
                confidence: (m.confidence * 0.9).clamp(0.4, 0.95),
                tier: 0,
                depth_estimate_m: 0.0,
                evidence: m.evidence.clone(),
                geometry: Default::default(),
                outline: Vec::new(),
            });
            // Kapak disklerini kaldır — şaft gövdesi çizilecek
            metals.retain(|mm| {
                let d = ((mm.cx - shaft_cx).powi(2) + (mm.cy - shaft_cy).powi(2)).sqrt();
                d > 0.16
            });
        }
    }

    // Post-filter: hedefe uymayan yapıları at
    match target {
        "well" => {
            let before_c = chambers.len();
            chambers.retain(|c| c.kind == "shaft");
            rejected += (before_c - chambers.len()) as u32;
            rejected += tunnels.len() as u32;
            tunnels.clear();
            // Kuyu modunda şaft varken düz metal diskleri gösterme
            if chambers.iter().any(|c| c.kind == "shaft") {
                rejected += metals.len() as u32;
                metals.clear();
            }
        }
        "room" => {
            let before_c = chambers.len();
            chambers.retain(|c| c.kind == "room" || c.kind == "tomb");
            rejected += (before_c - chambers.len()) as u32;
            // Tünelleri silme — oda + bağlayan koridor birlikte kalsın
        }
        "tunnel" => {
            rejected += chambers.len() as u32;
            chambers.clear();
        }
        "site" => {
            let before_c = chambers.len();
            chambers.retain(|c| c.kind == "room" || c.kind == "tomb");
            rejected += (before_c - chambers.len()) as u32;
        }
        _ => {
            // auto: şaft-only sahnede yatay tünel loblarını temizle
            let n_shaft = chambers.iter().filter(|c| c.kind == "shaft").count();
            let n_room = chambers.iter().filter(|c| c.kind != "shaft").count();
            if !side && n_shaft > 0 && n_room == 0 {
                rejected += tunnels.len() as u32;
                tunnels.clear();
            } else if !side && n_shaft > 0 {
                let before = tunnels.len();
                tunnels.retain(|t| {
                    let mx = (t.x0 + t.x1) * 0.5;
                    let my = (t.y0 + t.y1) * 0.5;
                    !chambers.iter().any(|c| {
                        if c.kind != "shaft" {
                            return false;
                        }
                        let dx = mx - c.cx;
                        let dy = my - c.cy;
                        (dx * dx + dy * dy).sqrt() < 0.2
                    })
                });
                rejected += (before - tunnels.len()) as u32;
            }
        }
    }

    if side {
        promote_side_red_corridors(
            &metals,
            &mut tunnels,
            &chambers,
            map_width_m,
            map_depth_m,
            depth_range_m,
            min_confidence,
        );
        tunnels = merge_collinear_tunnels(tunnels);
        // Yan tünel: gerçekçi kesit; yalnızca bandı dolduran dev kemerleri at
        let before = tunnels.len();
        tunnels.retain(|t| {
            let h = (t.floor_from_surface_m - t.crown_from_surface_m).max(t.height_m);
            // 10 m zarfta 0.75 tavanı kısa/orta tünelleri fazla kesiyordu
            h <= 6.0 && t.floor_from_surface_m <= depth_range_m * 0.95
        });
        rejected += (before - tunnels.len()) as u32;
        for t in &mut tunnels {
            let h = (t.floor_from_surface_m - t.crown_from_surface_m)
                .max(t.height_m)
                .clamp(0.85, 4.2);
            t.height_m = h;
            t.floor_from_surface_m = (t.crown_from_surface_m + h).min(depth_range_m);
            t.depth = ((t.crown_from_surface_m + h * 0.5) / depth_range_m).clamp(0.05, 0.98);
            if t.width_m < 0.7 {
                t.width_m = t.width_m.max(0.7).min(3.2);
            }
        }
        align_tunnel_floors_to_rooms(&mut tunnels, &chambers, true, depth_range_m);
    }

    // DTA yönlendirme: eksik oda/tünel/metal — mevcut pipeline sonrası enjekte/güçlendir
    apply_structure_hints(
        &mut chambers,
        &mut tunnels,
        &mut metals,
        dta_hints,
        map_width_m,
        map_depth_m,
        depth_range_m,
        side,
    );

    // İpucu sonrası da taban hizasını koru
    align_tunnel_floors_to_rooms(&mut tunnels, &chambers, side, depth_range_m);
    // Taban sabit; tavan yükselir → iç hacim büyür
    expand_volume_keep_floors(&mut chambers, &mut tunnels, depth_range_m);

    for m in &mut metals {
        attach_metal_to_structure(
            m,
            &chambers,
            &tunnels,
            side,
            depth_range_m,
            map_width_m,
            map_depth_m,
        );
    }

    // Kırmızı yapı değildir — host'a oturmayanları liste/çizimden çıkar
    let before_m = metals.len();
    metals.retain(|m| m.inside_chamber && !m.host_kind.is_empty());
    rejected += (before_m - metals.len()) as u32;

    metals = dedupe_metals(metals, &chambers);

    // Kademeli Derinlik (staged): tier-0 tamamen bittikten SONRA, kabul edilen
    // yapıların ayakizini maskeleyip zayıf/derin artık sinyalleri ayrı tier'lara
    // yerleştir. Tier-0 çıktısı bu noktaya kadar hiç değişmedi.
    if staged {
        let deep_range_m = (depth_range_m * DEEP_RANGE_MULT).max(depth_range_m + 1.0);
        let (deep_ch, deep_tn) = extract_deep_tiers(
            signed,
            w,
            h,
            map_width_m,
            map_depth_m,
            depth_range_m,
            deep_range_m,
            side,
            target,
            &calib,
            wall_cues,
            &chambers,
            &tunnels,
            &metals,
        );
        chambers.extend(deep_ch);
        tunnels.extend(deep_tn);
    }

    let accepted = (chambers.len() + tunnels.len() + metals.len()) as u32;
    let mut geometry_report = crate::surface::SiteGeometryReport::default();
    if use_vpe {
        if let Some(ref dec) = vpe {
            geometry_report.prob_engine_online = true;
            geometry_report.prob_used_legacy = false;
            geometry_report.prob_engine_label =
                format!("VPE {} · {}", dec.engine_version, dec.policy_id);
        }
    } else {
        geometry_report.prob_used_legacy = true;
        let st = crate::prob_client::probe_status();
        geometry_report.prob_engine_online = st.online;
        geometry_report.prob_engine_label = if st.online {
            format!("{} · legacy fallback", st.label)
        } else {
            st.label
        };
    }

    Ok(UndergroundStructures {
        chambers,
        tunnels,
        metals,
        waters: Vec::new(),
        accepted_count: accepted,
        rejected_count: rejected,
        min_confidence,
        geometry_report,
    })
}

#[cfg(test)]
mod fragment_tests {
    use super::fragment_oversized_side_chambers;
    use crate::surface::{Chamber, Evidence};

    fn wide_room(width_m: f32) -> Chamber {
        let rx = width_m / (2.0 * 24.0);
        Chamber {
            kind: "room".into(),
            cx: 0.55,
            cy: 0.35,
            rx,
            ry: 0.08,
            depth: 0.4,
            height: 0.4,
            intensity: 0.6,
            width_m,
            length_m: 2.0,
            top_from_surface_m: 0.4,
            bottom_from_surface_m: 1.6,
            height_m: 1.2,
            bearing_deg: 0.0,
            confidence: 0.7,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence::default(),
            geometry: Default::default(),
            outline: Vec::new(),
        }
    }

    #[test]
    fn oversized_side_room_splits_into_joined_pieces() {
        let parts = fragment_oversized_side_chambers(vec![wide_room(10.0)], 24.0);
        assert!(parts.len() >= 3, "geniş oda parçalanmalı, got {}", parts.len());
        assert!(parts.iter().all(|p| p.width_m <= 3.7));
        assert!(parts.iter().all(|p| p.geometry.method == "side_room_fragment"));
    }

    #[test]
    fn compact_room_stays_whole() {
        let parts = fragment_oversized_side_chambers(vec![wide_room(2.8)], 24.0);
        assert_eq!(parts.len(), 1);
    }
}

/// Tam pipeline propertik karşılaştırması: rastgele signed alanlar üretilir, aynı
/// alan `extract_validated_inner` ile iki kez çalıştırılır — `vpe=None` (legacy) ve
/// `vpe=Some(gerçek VPE kararı)` (motor çevrimiçiyken birebir aynı yol: kanıt paketi
/// serde_json round-trip ile in-process motora gider, kararlar aynı şekilde geri gelir).
///
/// Karşılaştırılan: karar düzeyi setleri — oda (kind, cx, cy), tünel uç çiftleri,
/// metal (cx, cy, host_kind) ve kabul/red sayaçları. Geometri meta verisi (derinlik,
/// bearing, evidence) karşılaştırma kapsamı dışındadır: derinlik kestirimi VPE'de
/// `estimate_depth`, legacy'de `build`'te ayrı formüllerle yapılır — bu ayrı bir hizalama
/// projesidir.
#[cfg(test)]
mod pipeline_parity_tests {
    use super::*;

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

    fn stamp(s: &mut [f32], w: u32, h: u32, cx: f32, cy: f32, rx: f32, ry: f32, v: f32) {
        let wf = (w - 1) as f32;
        let hf = (h - 1) as f32;
        for y in 0..h {
            for x in 0..w {
                let nx = x as f32 / wf;
                let ny = y as f32 / hf;
                let dx = (nx - cx) / rx;
                let dy = (ny - cy) / ry;
                if dx * dx + dy * dy <= 1.0 {
                    s[(y * w + x) as usize] = v;
                }
            }
        }
    }

    /// Yeşil zemin + rastgele mavi void elipsleri (2–6) + kırmızı metal elipsleri (0–4)
    /// + duvar ipuçları (0–6, blobların çevresinde). Blobların %60'ı uzamış (tünel adayı),
    /// %40'ı kompakt; %40 ihtimalle yeni blob önceki blobun yanında doğar (örtüşme →
    /// parçalama / fragman yolları zorlanır).
    fn random_field(
        rng: &mut Rng,
        w: u32,
        h: u32,
        side: bool,
    ) -> (Vec<f32>, Vec<crate::preprocess::WallCue>) {
        let mut s = vec![0.0f32; (w * h) as usize];
        // Hafif arka plan gürültüsü (±0.08, MAD → noise_std ≈ 0.059): noise_std
        // düzeltmesini (MAD) tüm süpürmelerde gerçekçi tutar — 0.03 tabanına kilitli
        // kalmaz. Blobları bozmaz: |noise| ≤ 0.08, void_thr/metal_thr ≥ 0.12 olduğundan
        // sahte blob üretmez; güçlü bloblar (0.45–0.75) SNR 7.6+ ile kapının üstünde kalır.
        for px in &mut s {
            *px = rng.range(-0.08, 0.08);
        }
        let mut centers = Vec::new();
        // Zayıf/derin artık sinyaller: tier-0 eşiğinin altında kalır (güçlü bloklar
        // kalibrasyonu yukarıda tutar), extract_deep_tiers bantlarında (tier1/tier2)
        // maske dışı alanlarda derin yapı adayı olur. ÖNCE damgalanır — güçlü blob
        // üst üste bindiğinde zayıfı ezer, tier-0 bozulmaz.
        let n_weak = (rng.next() % 3) as usize;
        for _ in 0..n_weak {
            stamp(
                &mut s,
                w,
                h,
                rng.range(0.08, 0.92),
                rng.range(0.12, 0.88),
                rng.range(0.03, 0.06),
                rng.range(0.03, 0.06),
                -rng.range(0.16, 0.3),
            );
        }
        // Metal + zayıf sinyal çakışması: zayıf void'in merkezi güçlü metal tarafından
        // örtülür (overwrite), kenarları zayıf kalır. Tier-0'da metal yapısı + deep
        // tier'da metal ayakizinin maskelenmesi (veya serbest kalan zayıf halkanın yapıya
        // dönüşmesi) — iki tarafta aynı sonucu üretmeli.
        if rng.unit() < 0.4 {
            let (cx, cy) = (rng.range(0.15, 0.85), rng.range(0.15, 0.85));
            let wrx = rng.range(0.09, 0.13);
            let wry = rng.range(0.09, 0.13);
            stamp(&mut s, w, h, cx, cy, wrx, wry, -rng.range(0.18, 0.28));
            stamp(
                &mut s,
                w,
                h,
                cx,
                cy,
                wrx * 0.55,
                wry * 0.55,
                rng.range(0.5, 0.68),
            );
        }
        // Yan çekim derinlik bandı çakışması: aynı x ekseninde, cy (derinlik) adımları
        // küçük boşluklu 2–3 blob yığını — piksel ayrık (ayrı blob) ama merge_side_void_parts
        // toleransında (y_touch + x_iou) → birleşir; side_cover_floor_cued birleşik/ayrık
        // derinlik bantlarını hesaplar. İki tarafta aynı sonucu üretmeli.
        if side {
            let n_stack = 2 + (rng.next() % 2) as usize;
            let sx = rng.range(0.2, 0.8);
            let mut last_cy = rng.range(0.3, 0.65);
            let mut last_ry = rng.range(0.05, 0.09);
            for _ in 0..n_stack {
                let ry = if rng.unit() < 0.5 {
                    last_ry
                } else {
                    rng.range(0.05, 0.11)
                };
                let rx = rng.range(0.04, 0.1);
                stamp(
                    &mut s,
                    w,
                    h,
                    (sx + rng.range(-0.03, 0.03)).clamp(0.08, 0.92),
                    last_cy,
                    rx,
                    ry,
                    -rng.range(0.45, 0.7),
                );
                last_ry = ry;
                // Küçük boşluk: pikselde ayrık kalır, merge toleransında (y_touch 1.45×)
                last_cy += (last_ry + ry) * 1.15;
            }
        }
        let n_void = 2 + (rng.next() % 5) as usize;
        let mut last = (0.5f32, 0.5f32);
        for i in 0..n_void {
            let near = i > 0 && rng.unit() < 0.4;
            let cx = if near {
                (last.0 + rng.range(-0.12, 0.12)).clamp(0.08, 0.92)
            } else {
                rng.range(0.08, 0.92)
            };
            let cy = if near {
                (last.1 + rng.range(-0.12, 0.12)).clamp(0.12, 0.88)
            } else {
                rng.range(0.12, 0.88)
            };
            last = (cx, cy);
            let elongated = rng.unit() < 0.6;
            let (rx, ry) = if elongated {
                if rng.unit() < 0.5 {
                    (rng.range(0.05, 0.14), rng.range(0.02, 0.05))
                } else {
                    (rng.range(0.02, 0.05), rng.range(0.05, 0.14))
                }
            } else {
                (rng.range(0.02, 0.08), rng.range(0.02, 0.08))
            };
            stamp(&mut s, w, h, cx, cy, rx, ry, -rng.range(0.45, 0.75));
            centers.push((cx, cy));
        }
        let n_metal = (rng.next() % 5) as usize;
        for _ in 0..n_metal {
            let near_v = rng.unit() < 0.5;
            let (cx, cy) = if near_v {
                (last.0 + rng.range(-0.08, 0.08), last.1 + rng.range(-0.08, 0.08))
            } else {
                (rng.range(0.1, 0.9), rng.range(0.15, 0.85))
            };
            stamp(
                &mut s,
                w,
                h,
                cx.clamp(0.05, 0.95),
                cy.clamp(0.1, 0.9),
                rng.range(0.012, 0.05),
                rng.range(0.01, 0.04),
                rng.range(0.4, 0.7),
            );
        }
        // Duvar ipuçları: blob merkezlerinin çevresinde (wall_ring_support bunları arar)
        let mut walls = Vec::new();
        let n_walls = (rng.next() % 7) as usize;
        for _ in 0..n_walls {
            if centers.is_empty() {
                break;
            }
            let (bcx, bcy) = centers[(rng.next() % centers.len() as u64) as usize];
            walls.push(crate::preprocess::WallCue {
                x: (bcx + rng.range(-0.08, 0.08)).clamp(0.01, 0.99),
                y: (bcy + rng.range(-0.08, 0.08)).clamp(0.01, 0.99),
                strength: rng.range(0.15, 0.9),
                near_void: rng.unit() < 0.7,
                green_line: rng.unit() < 0.25,
            });
        }
        (s, walls)
    }

    /// Gürültülü alan üreteci (deep süpürmesi): uniform arka plan gürültüsü ±0.22
    /// (MAD → noise_std ≈ 0.163; SNR bandı [1.05, 1.35]·0.163 ≈ [0.171, 0.220]).
    /// Void bloblarının ~%55'i bantta (0.20–0.215 → SNR 1.23–1.32: deep=true kabul,
    /// deep=false red), gerisi normal kapının üstünde (0.30–0.45). Kasıtlı olarak
    /// güçlü blob yok — void_p70'i yukarı çekip banttaki blobların tespitini
    /// engellemesinler. noise_std düzeltmesi (MAD) olmadan bu alanlarda da SNR
    /// paydası 0.04'e kilitli kalır ve bant yine erişilemez olurdu.
    fn random_noisy_field(
        rng: &mut Rng,
        w: u32,
        h: u32,
        side: bool,
    ) -> (Vec<f32>, Vec<crate::preprocess::WallCue>) {
        let mut s = vec![0.0f32; (w * h) as usize];
        for px in &mut s {
            *px = rng.range(-0.22, 0.22);
        }
        let mut centers = Vec::new();
        // Yan çekim derinlik yığını: piksel ayrık ama merge toleransında (random_field ile aynı)
        if side {
            let n_stack = 2 + (rng.next() % 2) as usize;
            let sx = rng.range(0.2, 0.8);
            let mut last_cy = rng.range(0.3, 0.65);
            let mut last_ry = rng.range(0.05, 0.09);
            for _ in 0..n_stack {
                let ry = if rng.unit() < 0.5 {
                    last_ry
                } else {
                    rng.range(0.05, 0.11)
                };
                let rx = rng.range(0.04, 0.1);
                let v = if rng.unit() < 0.5 {
                    rng.range(0.2, 0.215)
                } else {
                    rng.range(0.3, 0.45)
                };
                stamp(
                    &mut s,
                    w,
                    h,
                    (sx + rng.range(-0.03, 0.03)).clamp(0.08, 0.92),
                    last_cy,
                    rx,
                    ry,
                    -v,
                );
                centers.push((sx, last_cy));
                last_ry = ry;
                last_cy += (last_ry + ry) * 1.15;
            }
        }
        // Orta-güç void blobları: yarısı deep bandında, yarısı normal kapının üstünde
        let n_void = 3 + (rng.next() % 3) as usize;
        let mut last = (0.5f32, 0.5f32);
        for i in 0..n_void {
            let near = i > 0 && rng.unit() < 0.4;
            let cx = if near {
                (last.0 + rng.range(-0.12, 0.12)).clamp(0.08, 0.92)
            } else {
                rng.range(0.08, 0.92)
            };
            let cy = if near {
                (last.1 + rng.range(-0.12, 0.12)).clamp(0.12, 0.88)
            } else {
                rng.range(0.12, 0.88)
            };
            last = (cx, cy);
            let in_band = rng.unit() < 0.55;
            let v = if in_band {
                rng.range(0.2, 0.215)
            } else {
                rng.range(0.3, 0.45)
            };
            let elongated = rng.unit() < 0.6;
            let (rx, ry) = if elongated {
                if rng.unit() < 0.5 {
                    (rng.range(0.05, 0.14), rng.range(0.02, 0.05))
                } else {
                    (rng.range(0.02, 0.05), rng.range(0.05, 0.14))
                }
            } else {
                (rng.range(0.04, 0.09), rng.range(0.04, 0.09))
            };
            stamp(&mut s, w, h, cx, cy, rx, ry, -v);
            centers.push((cx, cy));
        }
        let n_metal = (rng.next() % 4) as usize;
        for _ in 0..n_metal {
            let near_v = rng.unit() < 0.5;
            let (cx, cy) = if near_v {
                (last.0 + rng.range(-0.08, 0.08), last.1 + rng.range(-0.08, 0.08))
            } else {
                (rng.range(0.1, 0.9), rng.range(0.15, 0.85))
            };
            stamp(
                &mut s,
                w,
                h,
                cx.clamp(0.05, 0.95),
                cy.clamp(0.1, 0.9),
                rng.range(0.012, 0.05),
                rng.range(0.01, 0.04),
                rng.range(0.3, 0.6),
            );
        }
        let mut walls = Vec::new();
        let n_walls = (rng.next() % 7) as usize;
        for _ in 0..n_walls {
            if centers.is_empty() {
                break;
            }
            let (bcx, bcy) = centers[(rng.next() % centers.len() as u64) as usize];
            walls.push(crate::preprocess::WallCue {
                x: (bcx + rng.range(-0.08, 0.08)).clamp(0.01, 0.99),
                y: (bcy + rng.range(-0.08, 0.08)).clamp(0.01, 0.99),
                strength: rng.range(0.15, 0.9),
                near_void: rng.unit() < 0.7,
                green_line: rng.unit() < 0.25,
            });
        }
        (s, walls)
    }

    /// Geometri meta verisi dahil oda anahtarı: kind + konum + top/bottom/height (cm)
    /// + bearing (0.1°) + width/length (cm). Derinlik artık ortak build_chamber'dan geldiği
    /// için karşılaştırılabilir (estimate_depth hizalaması RoomSlot/link bantlarını tutar).
    fn chamber_keys(
        out: &UndergroundStructures,
    ) -> Vec<(String, i64, i64, i64, i64, i64, i64, i64, i64, u8)> {
        out.chambers
            .iter()
            .map(|c| {
                (
                    c.kind.clone(),
                    (c.cx * 1000.0).round() as i64,
                    (c.cy * 1000.0).round() as i64,
                    (c.top_from_surface_m * 100.0).round() as i64,
                    (c.bottom_from_surface_m * 100.0).round() as i64,
                    (c.height_m * 100.0).round() as i64,
                    (c.bearing_deg * 10.0).round() as i64,
                    (c.width_m * 100.0).round() as i64,
                    (c.length_m * 100.0).round() as i64,
                    c.tier,
                )
            })
            .collect()
    }

    /// Tünel anahtarı: uç çiftleri + crown/floor/height/width (cm) + bearing (0.1°).
    fn tunnel_keys(
        out: &UndergroundStructures,
    ) -> Vec<((i64, i64), (i64, i64), i64, i64, i64, i64, i64, u8)> {
        out.tunnels
            .iter()
            .map(|t| {
                let a = ((t.x0 * 1000.0).round() as i64, (t.y0 * 1000.0).round() as i64);
                let b = ((t.x1 * 1000.0).round() as i64, (t.y1 * 1000.0).round() as i64);
                let (p, q) = if a < b { (a, b) } else { (b, a) };
                (
                    p,
                    q,
                    (t.crown_from_surface_m * 100.0).round() as i64,
                    (t.floor_from_surface_m * 100.0).round() as i64,
                    (t.height_m * 100.0).round() as i64,
                    (t.width_m * 100.0).round() as i64,
                    (t.bearing_deg * 10.0).round() as i64,
                    t.tier,
                )
            })
            .collect()
    }

    fn metal_keys(out: &UndergroundStructures) -> Vec<(i64, i64, String)> {
        out.metals
            .iter()
            .map(|m| {
                (
                    (m.cx * 1000.0).round() as i64,
                    (m.cy * 1000.0).round() as i64,
                    m.host_kind.clone(),
                )
            })
            .collect()
    }

    fn assert_pipeline_parity(
        legacy: &UndergroundStructures,
        vpe: &UndergroundStructures,
        side: bool,
        case: u64,
        target: &str,
    ) {
        let mut l_ch = chamber_keys(legacy);
        let mut v_ch = chamber_keys(vpe);
        l_ch.sort();
        v_ch.sort();
        assert_eq!(
            l_ch, v_ch,
            "target={target} side={side} case={case}: oda seti"
        );
        let mut l_tn = tunnel_keys(legacy);
        let mut v_tn = tunnel_keys(vpe);
        l_tn.sort();
        v_tn.sort();
        assert_eq!(
            l_tn, v_tn,
            "target={target} side={side} case={case}: tünel seti\nlegacy={l_tn:?}\nvpe={v_tn:?}"
        );
        let mut l_m = metal_keys(legacy);
        let mut v_m = metal_keys(vpe);
        l_m.sort();
        v_m.sort();
        assert_eq!(
            l_m, v_m,
            "target={target} side={side} case={case}: metal seti"
        );
        assert_eq!(
            legacy.accepted_count, vpe.accepted_count,
            "target={target} side={side} case={case}: kabul sayısı"
        );
        assert_eq!(
            legacy.rejected_count, vpe.rejected_count,
            "target={target} side={side} case={case}: red sayısı"
        );
    }

    /// İki pipeline çıktısının set olarak aynı olup olmadığı (probe/vakum korumaları
    /// için — örneğin deep=false vs deep=true kararlarının farklılaşmasını ölçer).
    fn same_structures(a: &UndergroundStructures, b: &UndergroundStructures) -> bool {
        let mut a_ch = chamber_keys(a);
        let mut b_ch = chamber_keys(b);
        a_ch.sort();
        b_ch.sort();
        if a_ch != b_ch {
            return false;
        }
        let mut a_tn = tunnel_keys(a);
        let mut b_tn = tunnel_keys(b);
        a_tn.sort();
        b_tn.sort();
        if a_tn != b_tn {
            return false;
        }
        let mut a_m = metal_keys(a);
        let mut b_m = metal_keys(b);
        a_m.sort();
        b_m.sort();
        a_m == b_m && a.accepted_count == b.accepted_count && a.rejected_count == b.rejected_count
    }

    fn run_legacy(
        signed: &[f32],
        w: u32,
        h: u32,
        view: &str,
        through_red: bool,
        target: &str,
        staged: bool,
        deep: bool,
        min_conf: f32,
        wall_cues: &[crate::preprocess::WallCue],
        calib: &FieldCalib,
        void_blobs: &[Blob],
        metal_blobs: &[Blob],
    ) -> UndergroundStructures {
        // Deep mod: extract_validated wrapper'ının semantiğini birebir yansıt —
        // deep=true → min_confidence (taban−0.18).max(0.2). (through_red'i
        // wrapper zorlar; süpürme onu zaten açıkça döngüye alır.) SNR kapısı (1.05)
        // yapısal olarak erişilemez: tespit edilen her blob |v| ≥ void_thr ≥ 0.12
        // içerir → SNR ≥ 0.12 / max(noise_std, 0.04) = 3.0 — deep'in gerçek davranış
        // farkı min_confidence düşüşüdür ve burada uygulanır.
        let min_conf = if deep { (min_conf - 0.18).max(0.2) } else { min_conf };
        extract_validated_inner(
            signed,
            w,
            h,
            24.0,
            10.0,
            10.0,
            view,
            min_conf,
            target,
            wall_cues,
            &[],
            deep,
            staged,
            through_red,
            calib,
            void_blobs,
            metal_blobs,
            None,
        )
        .expect("legacy pipeline")
    }

    fn run_vpe(
        signed: &[f32],
        w: u32,
        h: u32,
        view: &str,
        through_red: bool,
        target: &str,
        staged: bool,
        deep: bool,
        min_conf: f32,
        wall_cues: &[crate::preprocess::WallCue],
        calib: &FieldCalib,
        void_blobs: &[Blob],
        metal_blobs: &[Blob],
    ) -> UndergroundStructures {
        // extract_validated wrapper'ının deep semantiği (bkz. run_legacy) — motor batch'i
        // ve common body aynı düşürülmüş eşiği görmeli (parite riski: engine conf_need
        // zinciri legacy ile aynı yapıda, satır 110-118; eşik farkı sapma yaratmasın).
        let min_conf = if deep { (min_conf - 0.18).max(0.2) } else { min_conf };
        let mut batch = prob_apply::build_evidence_batch(
            void_blobs,
            metal_blobs,
            signed,
            w,
            h,
            calib,
            wall_cues,
            24.0,
            10.0,
            10.0,
            view,
            target,
            min_conf,
            through_red,
            deep,
        );
        batch.policy_id = Some("standard".into());
        // Tel protokolü: istemci paketi → JSON → motor paketi → decide → JSON → istemci kararı
        let json = serde_json::to_string(&batch).unwrap();
        let engine_batch: votex_prob::schema::EvidenceBatch = serde_json::from_str(&json).unwrap();
        let engine_dec = votex_prob::decide::decide(&engine_batch, "standard");
        assert!(!engine_dec.stub);
        let json2 = serde_json::to_string(&engine_dec).unwrap();
        let client_dec: crate::prob_client::DecisionBatch = serde_json::from_str(&json2).unwrap();
        extract_validated_inner(
            signed,
            w,
            h,
            24.0,
            10.0,
            10.0,
            view,
            min_conf,
            target,
            wall_cues,
            &[],
            deep,
            staged,
            through_red,
            calib,
            void_blobs,
            metal_blobs,
            Some(&client_dec),
        )
        .expect("vpe pipeline")
    }

    /// Hedef hedefi süpürür: side × through_red × case rastgele alanlarda legacy ve VPE
    /// aynı karar setlerini üretmeli. Hedef, post-filter dahil tüm hedefe özgü dalları
    /// (forcing, class_allowed, link toleransı, post-filter retain/clear) iki tarafta da
    /// birebir çalıştırır.
    /// Erişilemezlik notu (yan kesim path dalı): `path_s < 0.38` koşulu tünel sınıflı yan
    /// bloblarda yapısal olarak ulaşılamaz — ölçüm: 1200 yan alanda aspect ≥ 2.55 olan
    /// 84 blobun min path_s 0.8. Kanıt: path_samples ±1 px dikey örnek alır → boşluk
    /// ≥3 px gerekir → şerit ≥5 px (measured_h ≥ 0.45 m) → score_side room skoru tüneli
    /// her zaman yener → blob Room sınıflanır, kesim (yalnızca Tunnel) ateşlenmez. Katı
    /// blobların ekseni de hep blobun içinde kalır (path_s = 1.0). Bu yüzden süpürmeler
    /// bu dalı kapsayamaz; koruması engine seviyesindeki near_red_low_path_side_tunnel    /// _cut_to_room testidir. Üreteç değişirse bu ölçümü yeniden çalıştırın (yukarıdaki
    /// histogram yöntemi: prepare_blobs + tunnel_path_endpoints + path_structure_support).
    ///
    /// ERİŞİLEBİLİRLİK DENEYİ (kayıt — 2026): "süpürme bu dalı GERÇEKTEN yakalar mı?"
    /// sorusu kontrollü deneyle kanıtlandı. Dal geçici olarak erişilebilir kılındı:
    /// (1) üreteç yan alanlara görünmez damga bastı (signed[0] = 0.10), path_structure_support
    /// damgayı görünce yatay eksenli uzun blobların path'ini 0.30'a sabitledi; (2) iki
    /// sınıflandırıcıya (classify_void_side + score_side, birebir) düşük-path geniş yan
    /// bloblara tünel boost'u eklendi. Sonra engine fix'i `(!b.near_red || !through_red)`
    /// yerine eski `!b.near_red`e geri alındı → **site_target_pipeline_parity case=88'de
    /// KIRILDI** (legacy (533,609)/(637,609) odalarını üretti, VPE tünel tuttu — dalın
    /// tam imzası). Fix geri konunca aynı enstrümantasyonla **16/16 süpürme geçti**;
    /// yalnızca side_path_branch_unreachable_guard bilerek kırıldı (dal erişilebilir oldu
    /// → koruma mesajıyla uyardı). Yani: dal erişilebilir olsaydı süpürme sapmayı yakalardı;
    /// fix doğru ve süpürmeler onu koruyor. Deney tüm enstrümantasyon kaldırılarak bitti;
    /// tek kalıcı artefakt bu kayıt + engine fix yorumundaki kısa özet.

    fn sweep_target_parity(
        target: &str,
        seed: u64,
        cases: u64,
        staged: bool,
        deep: bool,
        noisy: bool,
        min_conf: f32,
    ) -> usize {
        let mut rng = Rng(seed);
        let mut total = 0usize;
        for side in [false, true] {
            for through_red in [false, true] {
                let view = if side { "side" } else { "top" };
                for case in 0..cases {
                    let w = 48u32;
                    let h = 24u32;
                    let (signed, wall_cues) = if noisy {
                        random_noisy_field(&mut rng, w, h, side)
                    } else {
                        random_field(&mut rng, w, h, side)
                    };
                    let (calib, void_blobs, metal_blobs) =
                        prepare_blobs(&signed, w, h, through_red, side);
                    let legacy = run_legacy(
                        &signed,
                        w,
                        h,
                        view,
                        through_red,
                        target,
                        staged,
                        deep,
                        min_conf,
                        &wall_cues,
                        &calib,
                        &void_blobs,
                        &metal_blobs,
                    );
                    let vpe = run_vpe(
                        &signed,
                        w,
                        h,
                        view,
                        through_red,
                        target,
                        staged,
                        deep,
                        min_conf,
                        &wall_cues,
                        &calib,
                        &void_blobs,
                        &metal_blobs,
                    );
                    assert_pipeline_parity(&legacy, &vpe, side, case, target);
                    total += legacy.accepted_count as usize;
                }
            }
        }
        total
    }

    /// Otomatik hedef: tüm sınıf seti + auto post-filter (şaft-only temizlik).
    #[test]
    fn random_field_full_pipeline_parity() {
        sweep_target_parity("auto", 0xC0DE_2026, 200, false, false, false, 0.35);
    }

    /// Well hedefi: well_like_plan (dik), side şaft kuralı (yan), well_from_metal ve
    /// fallback dalları — karar kapısı sıralamasının iki tarafta aynı olduğunu doğrular.
    #[test]
    fn well_target_pipeline_parity() {
        sweep_target_parity("well", 0x57E11_2026, 100, false, false, false, 0.35);
    }

    /// Room hedefi: room/tomb kabul + post-filter retain + bağlayan koridorların korunması.
    #[test]
    fn room_target_pipeline_parity() {
        sweep_target_parity("room", 0x80D1_2026, 150, false, false, false, 0.35);
    }

    /// Tunnel hedefi: tünel forcing'i (oda/şaft → koridor) + chamber temizliği post-filter.
    #[test]
    fn tunnel_target_pipeline_parity() {
        sweep_target_parity("tunnel", 0x7A11E1_2026, 150, false, false, false, 0.35);
    }

    /// Site hedefi: shaft reddi (kapı öncesi) + retain room/tomb + auto link davranışı
    /// (site allow_link_tunnels = evet).
    #[test]
    fn site_target_pipeline_parity() {
        sweep_target_parity("site", 0x517E_2026, 150, false, false, false, 0.35);
    }

    /// Kademeli derinlik (staged): tier-0 setleri aynı olduğu sürece extract_deep_tiers
    /// iki tarafta da aynı tier yapılarını üretmeli (maske + bant + derinlik formülleri
    /// ortak). Tier ataması chamber/tunnel anahtarlarına dahil — tier setleri de birebir.
    /// Well: tasarım gereği tier üretmez (class_allowed yalnızca Shaft) ama zayıf artık
    /// sinyaller tier-0 kararlarını (well_from_metal, fallback, forcing) etkilememeli —
    /// bu yüzden well de staged olarak süpürülür.
    #[test]
    fn staged_pipeline_parity() {
        for (target, seed) in [
            ("auto", 0x51A6_2026u64),
            ("well", 0x51B0_2026u64),
            ("room", 0x51A7_2026u64),
            ("tunnel", 0x51A8_2026u64),
            ("site", 0x51A9_2026u64),
        ] {
            sweep_target_parity(target, seed, 80, true, false, false, 0.35);
        }
    }

    /// Deep modun artık anlamlı olduğunu doğrular (noise_std MAD düzeltmesi sonrası):
    /// 1. SNR bandı [1.05, 1.35) erişilebilir — gürültülü alanlarda en az bir tespit
    ///    edilen blob bu bandda (noise_std ≈ 0.163, orta bloblar 0.20–0.215 → SNR 1.23–1.32).
    /// 2. deep=true kararları değiştirir: banddaki zayıf bloblar normal modda SNR
    ///    kapısında (1.35) reddedilir, deep modda (1.05) işleme girer. Legacy'de ölçülür;
    ///    VPE paritesi deep_pipeline_parity'de süpürülür.
    ///
    /// Eski no-op durumu (deep_mode_noop_guard): eski noise_std yalnızca |v| ≤ 0.05
    /// nötr piksellerden hesaplanıyordu → ≤ 0.025 → clamp 0.03 → payda max(noise_std, 0.04)
    /// = 0.04; tespit edilen her blob |v| ≥ void_thr ≥ 0.12 içerdiğinden SNR ≥ 3.0 > 1.35
    /// — bant hiçbir alanda ulaşılamıyordu. MAD tabanlı tahmin gürültülü alanlarda
    /// gerçek σ'yu verir, temiz alanlarda (üreteç) 0.03 tabanına düşer.
    #[test]
    fn deep_mode_changes_decisions() {
        let mut rng = Rng(0xDEE9_2026u64);
        let mut in_band = 0usize;
        let mut diff_fields = 0usize;
        for side in [false, true] {
            for through_red in [false, true] {
                for _ in 0..80u64 {
                    let (signed, wall_cues) = random_noisy_field(&mut rng, 48, 24, side);
                    let view = if side { "side" } else { "top" };
                    let (calib, void_blobs, metal_blobs) =
                        prepare_blobs(&signed, 48, 24, through_red, side);
                    for b in &void_blobs {
                        let snr = b.intensity / calib.noise_std.max(0.04);
                        if snr >= 1.05 && snr < 1.35 {
                            in_band += 1;
                        }
                    }
                    let normal = run_legacy(
                        &signed, 48, 24, view, through_red, "auto", false, false, 0.35,
                        &wall_cues, &calib, &void_blobs, &metal_blobs,
                    );
                    let deep = run_legacy(
                        &signed, 48, 24, view, through_red, "auto", false, true, 0.35,
                        &wall_cues, &calib, &void_blobs, &metal_blobs,
                    );
                    if !same_structures(&normal, &deep) {
                        diff_fields += 1;
                    }
                }
            }
        }
        assert!(
            in_band > 0,
            "vakum: hiçbir blob SNR bandında değil — üreteç/gürültü ayarını kontrol et"
        );
        assert!(
            diff_fields > 0,
            "vakum: deep hiçbir alanda karar değiştirmiyor — SNR kapısı erişilemez kaldı"
        );
    }

    /// Erişilemezlik guard'ı (yan kesim path dalı): tünel sınıflı yan bloblarda
    /// path_s < 0.38 ulaşılamaz olmalı — kanıt ve ölçüm sweep_target_parity yorumunda.
    /// Tarama boş geçmesin diye yeterli alan + en az bir tünel sınıflı blob şart koşar.
    /// Sınıflandırıcı/üreteç/path örnekleyici değişip bu blob türü oluşmaya başlarsa
    /// test bilerek kırılır: o zaman path dalını süpürmeye bağlayın (üretece desen) ve
    /// motor testi near_red_low_path_side_tunnel_cut_to_room'u koruyun.
    #[test]
    fn side_path_branch_unreachable_guard() {
        let mut rng = Rng(0x51A0_2026u64);
        let mut scanned = 0usize;
        let mut tunnels = 0usize;
        for noisy in [false, true] {
            for _ in 0..400u64 {
                let (signed, _) = if noisy {
                    random_noisy_field(&mut rng, 48, 24, true)
                } else {
                    random_field(&mut rng, 48, 24, true)
                };
                let (calib, void_blobs, _) = prepare_blobs(&signed, 48, 24, false, true);
                for b in &void_blobs {
                    scanned += 1;
                    let (cls, _, _, _) =
                        classify_void_side(b, &signed, 48, 24, calib.void_thr, 24.0, 10.0, false);
                    if cls != VoidClass::Tunnel {
                        continue;
                    }
                    tunnels += 1;
                    let (x0, y0, x1, y1) = tunnel_path_endpoints(b, true);
                    let path_s = path_structure_support(
                        &signed, 48, 24, x0, y0, x1, y1, calib.void_thr, false,
                    );
                    assert!(
                        path_s >= 0.38,
                        "tünel sınıflı yan blob path={path_s:.3} < 0.38 — path dalı \
                         erişilebilir oldu; üretece desen ekleyip süpürmeyi güncelleyin"
                    );
                }
            }
        }
        assert!(scanned > 200, "vakum: tarama çok az blob gördü ({scanned})");
        assert!(
            tunnels > 0,
            "vakum: hiç tünel sınıflı yan blob yok — guard anlamsız"
        );
    }

    /// Deep mod: extract_validated wrapper'ının deep semantiğiyle (min_confidence −0.18,
    /// engine batch'ine taşınan deep bayrağı) iki tarafın aynı kararı verdiğini süpürür.
    /// Gürültülü alanlarda (noise_std ≈ 0.163) SNR kapısı artık erişilebilir: banddaki
    /// zayıf bloblar (SNR 1.05–1.35) deep modda kabul edilir, normal modda reddedilir —
    /// kapı paritesi (legacy 1.05 == engine 1.05) bu süpürmede doğrulanır. Ayrıca
    /// production deep davranışı olan through_red zorlaması satırları açıkça döngülenir.
    #[test]
    fn deep_pipeline_parity() {
        for (target, seed) in [
            ("auto", 0xDEE9_2026u64),
            ("room", 0xDEEA_2026u64),
            ("tunnel", 0xDEEB_2026u64),
            ("site", 0xDEEC_2026u64),
        ] {
            sweep_target_parity(target, seed, 80, false, true, true, 0.35);
        }
    }

    /// conf_need kapı denetiminin süpürme kanıtı (rescue-gate parite düzeltmesinin
    /// ardından yapılan eşik denetimi): rescue kapısı (`conf < 0.42`) erken-zarf
    /// boost'undan ÖNCE çalıştığı için iki yolda farklı conf tabanı görüyordu (legacy
    /// ham, VPE engine boost'lu) — düzeltildi. conf_need/margin_need/path_need kapıları
    /// ise yapısal olarak güvende: hepsi line 1052'deki zarf-boost yakınsama noktasından
    /// SONRA çalışır (VPE boost'u decide() içinde uygular, legacy aynı boost'u 1052'de;
    /// VPE-reddedilen blobs reclassified olup legacy gibi işlenir). Bu test, o iddianın
    /// kanıtını sabitler: mc=0.35'te conf_need dallarının DÖRDÜ taban değerinde kaldığı
    /// için (through_red 0.2, zarf≥0.2 0.26, tünel 0.25, yan 0.32) mevcut süpürmeler
    /// kapının DEĞİŞKEN bölgesini hiç sıkmıyordu. Yüksek mc ile dallar gerçek formüle
    /// (mc−0.24 / mc−0.12 / mc) iner, kapı sıkılaşır → sınır blobları (conf ≈ conf_need)
    /// iki tarafta da AYNI kabul/red kararını vermeli. (min_confidence iki yola da aynı
    /// değerle girer: motor batch.clamp(0.15,0.9) — 0.6/0.75 aralık içinde.)
    #[test]
    fn high_confidence_gate_parity() {
        let mut accepted_total = 0usize;
        for (target, seed) in [
            ("auto", 0x61A7_2026u64),
            ("room", 0x61A8_2026u64),
            ("tunnel", 0x61A9_2026u64),
            ("site", 0x61AA_2026u64),
        ] {
            for mc in [0.6f32, 0.75] {
                accepted_total += sweep_target_parity(
                    target,
                    seed ^ (mc.to_bits() as u64),
                    60,
                    false,
                    false,
                    false,
                    mc,
                );
            }
        }
        // Vakum koruması: yüksek eşikte bile süpürmeler yapı kabul etmeli (ölçüm:
        // 4 hedef × 2 mc × 2 yön × 2 through_red × 60 alan → 6772 kabul — üreteç
        // değişirse sayıyı yeniden doğrulayın).
        assert!(
            accepted_total > 0,
            "yüksek mc süpürmeleri hiç yapı kabul etmedi — üreteç/eşik değişmiş olabilir"
        );
    }

    /// Paylaşılan gövde through_red dallarının (rescue 950, gate rescue 1099, metal
    /// rescue 1275) iki yolda da aynı sırayla ve aynı sonuçla ateşlendiğini kanıtlar.
    /// Mevcut süpürmeler yapı setlerini karşılaştırır ama bu dallar HİÇ ateşlenmese de
    /// geçerdi (vakum körlüğü) — bu test, dalların çıktı nedenlerindeki işaretçilerini
    /// (marker) sayar: legacy ve VPE AYNI sayıda ateşlemeli VE her dal en az bir kez
    /// ateşlenmeli. Marker'lar `why` → Evidence.reasons → Chamber/Tunnel.evidence
    /// zincirinden çıktıya ulaşır (yapı seti eşitliği zaten assert_pipeline_parity'de).
    ///
    /// BU TEST BİR PARİTE HATASI YAKALADI VE DÜZELTİLDİ: ilk çalıştırmada rescue
    /// marker'ları 25 vs 23 çıktı (legacy 2 kez fazla ateşliyordu) — yapı setleri
    /// eşitti, sapma yalnızca marker/conf düzeyindeydi. Mekanizma (case=76, side):
    /// legacy'de rescue ham conf'la (0.42 altı) ateşlenip SONRA kesim odaya çeviriyor;
    /// VPE'de engine'in kesim max'ı (conf.max(0.58)) conf'u 0.42 üstüne itiyordu ve
    /// eski de-boost (yalnızca zarf boost'unu geri alıyor) 0.458 ≥ 0.42 bırakıyordu →
    /// rescue atlanıyordu. max() geri alınamayacağı için çözüm: engine score_void
    /// çıktısını `raw_conf` olarak taşır (VoidDecision.schema), kapı onu kullanır.
    /// Düzeltme sonrası marker sayıları birebir (rescue 25/25).
    ///
    /// Gate rescue dalını (1099) deterministik ateşleyen alanlar (hedefli senaryo).
    /// Keşif: marker süpürmesinde gate rescue 240 alanda yalnızca 1 kez ateşleniyordu;
    /// 1200 alan taramasında (3 seed × 2 yön × 400) toplam 4 vaka bulundu — hepsi top
    /// view. Mekanizma: tomb/room skorları neredeyse eşit (margin < 0.02, through_red
    /// margin_need = 0.02) ve conf ≥ 0.42 → erken rescue (950) atlanır (conf eşiği),
    /// gate rescue (1099) margin eşiğinde ateşlenir → sınıf Room/Tunnel'a çevrilir ve
    /// conf 0.55'e çekilir → son kapı geçer. VPE tarafında aynı blob engine kapısında
    /// REDDEDİLİR (margin < 0.02) → reclassified → ortak gövde aynı mantıkla kurtarır:
    /// iki yol da aynı yapıyı ve aynı marker'ı üretir. Rastgele üreteçte nadir olduğu
    /// için (1000+ alanda ~4) her koşuda ateşlemeyi garanti eden deterministik kayıttır.
    #[test]
    fn gate_rescue_deterministic_fields() {
        let fields = [
            (0x7B0D_2026u64, 98u64),
            (0x6A7E_2026u64, 106u64),
            (0x6A7E_2026u64, 185u64),
            (0x9A7E_2026u64, 141u64),
        ];
        let mut total_gate = (0usize, 0usize); // (legacy, vpe)
        for (seed, case) in fields {
            let mut rng = Rng(seed);
            for _ in 0..case {
                let _ = random_noisy_field(&mut rng, 48, 24, false);
            }
            let (signed, wall_cues) = random_noisy_field(&mut rng, 48, 24, false);
            let (calib, void_blobs, metal_blobs) = prepare_blobs(&signed, 48, 24, true, false);
            assert!(!void_blobs.is_empty(), "seed={seed:x} case={case}: void üretilmeli");
            let legacy = run_legacy(
                &signed, 48, 24, "top", true, "auto", false, false, 0.35, &wall_cues, &calib,
                &void_blobs, &metal_blobs,
            );
            let vpe = run_vpe(
                &signed, 48, 24, "top", true, "auto", false, false, 0.35, &wall_cues, &calib,
                &void_blobs, &metal_blobs,
            );
            assert_pipeline_parity(&legacy, &vpe, false, case, "auto");
            for out in [&legacy, &vpe] {
                let g = if std::ptr::eq(out, &legacy) {
                    &mut total_gate.0
                } else {
                    &mut total_gate.1
                };
                for c in &out.chambers {
                    for r in &c.evidence.reasons {
                        if r == "rewrite:through_red_gate" {
                            *g += 1;
                        }
                    }
                }
                for t in &out.tunnels {
                    for r in &t.evidence.reasons {
                        if r == "rewrite:through_red_gate" {
                            *g += 1;
                        }
                    }
                }
            }
        }
        assert_eq!(
            total_gate.0, total_gate.1,
            "gate rescue her iki yolda da aynı sayıda ateşlenmeli"
        );
        assert!(
            total_gate.0 >= fields.len(),
            "her deterministik alan gate rescue ateşlemeli, got {}",
            total_gate.0
        );
    }

    /// Metal rescue dalını (through_red red_interior_host — ortak gövde ~1310) izole
    /// deterministik senaryo. Marker testindeki metal-yalnız damgadan (oda/tünel YOK,
    /// tüm yapılar rescue'dan) farklı olarak bu alan DOĞAL void içeriği de taşır:
    ///   A (taban çizgisi): tek güçlü void → doğal oda/tünel
    ///   B: aynı void + örtülmemiş güçlü metal (0.75,0.75, v=0.6) → rescue tetiklenir
    /// Rescue koşulları sağlanır: metal void'lerden uzak (covered dx²+dy²=11 ≫ 1.8 ve
    /// near_v yok) → intensity ≥ 0.38 (skip yok), snr = 0.6/0.04 = 15 ≥ 1.2. Host
    /// top view'da tünel olur (axis_aspect 2.17 ≥ 2.15 — damga pikselleri 48×24 ızgarada
    /// x'e uzar), doğal void de through_red rescue'da tünel (path 100%) — bu yüzden
    /// karşılaştırma oda+tünel birlikte. Kalibrasyon A/B'de aynı
    /// (void_p70/metal_p70/noise_std değişmez) → doğal setler birebir korunur: B'nin
    /// rescue-olmayan yapıları A'nınkiyle AYNI anahtarlar — damga oda/tünel setlerini
    /// bozmaz, yalnızca ekleme yapar. İki taraf (legacy/VPE) her iki alanda birebir.
    #[test]
    fn metal_rescue_isolated_parity() {
        let w = 48u32;
        let h = 24u32;
        for side in [false, true] {
            let view = if side { "side" } else { "top" };
            // Alan A: yalnız doğal void
            let mut s_a = vec![0.0f32; (w * h) as usize];
            stamp(&mut s_a, w, h, 0.35, 0.35, 0.06, 0.06, -0.6);
            // Alan B: aynı void + örtülmemiş güçlü metal (rescue tetikleyicisi)
            let mut s_b = s_a.clone();
            stamp(&mut s_b, w, h, 0.75, 0.75, 0.06, 0.06, 0.6);
            let wall_cues = vec![];
            for (s, tag) in [(&s_a, "A"), (&s_b, "B")] {
                let (calib, void_blobs, metal_blobs) = prepare_blobs(s, w, h, true, side);
                assert!(
                    !void_blobs.is_empty(),
                    "{tag} side={side}: void blob üretilmeli"
                );
                if tag == "B" {
                    assert!(
                        !metal_blobs.is_empty(),
                        "B side={side}: metal blob üretilmeli"
                    );
                }
                let legacy = run_legacy(
                    s, w, h, view, true, "auto", false, false, 0.35, &wall_cues, &calib,
                    &void_blobs, &metal_blobs,
                );
                let vpe = run_vpe(
                    s, w, h, view, true, "auto", false, false, 0.35, &wall_cues, &calib,
                    &void_blobs, &metal_blobs,
                );
                assert_pipeline_parity(&legacy, &vpe, side, 0, "auto");
                // Rescue host'u doğal setten ayır: marker taşımayan tüm yapı anahtarları
                // (oda + tünel — through_red top view'da hem doğal void hem metal host
                // tünel sınıfına düşer, chamber-only karşılaştırma kör olurdu).
                let natural_l = natural_structure_keys(&legacy);
                let natural_v = natural_structure_keys(&vpe);
                assert_eq!(
                    natural_l, natural_v,
                    "{tag} side={side}: rescue-olmayan doğal set legacy==VPE"
                );
                if tag == "B" {
                    let count_l = structure_count(&legacy);
                    let count_v = structure_count(&vpe);
                    assert!(
                        count_l >= 2 && count_v >= 2,
                        "B side={side}: doğal yapı + rescue host olmalı (l={count_l} v={count_v})"
                    );
                    assert!(
                        natural_l.len() >= 1,
                        "B side={side}: doğal (rescue olmayan) yapı kalmalı"
                    );
                }
                // Rescue marker sayısı: legacy == VPE
                let m_l = metal_rescue_count(&legacy);
                let m_v = metal_rescue_count(&vpe);
                assert_eq!(m_l, m_v, "{tag} side={side}: metal rescue sayısı legacy==VPE");
                if tag == "B" {
                    assert!(m_l >= 1, "B side={side}: metal rescue ateşlemeli");
                }
            }
            // B'nin doğal seti A'nınkiyle birebir (damga bozmadı)
            let (calib_a, va, ma) = prepare_blobs(&s_a, w, h, true, side);
            let legacy_a = run_legacy(
                &s_a, w, h, view, true, "auto", false, false, 0.35, &wall_cues, &calib_a, &va,
                &ma,
            );
            let (calib_b, vb, mb) = prepare_blobs(&s_b, w, h, true, side);
            let legacy_b = run_legacy(
                &s_b, w, h, view, true, "auto", false, false, 0.35, &wall_cues, &calib_b, &vb,
                &mb,
            );
            let mut keys_a = structure_keys(&legacy_a);
            keys_a.sort();
            let mut keys_b_natural = natural_structure_keys(&legacy_b);
            keys_b_natural.sort();
            assert_eq!(
                keys_a, keys_b_natural,
                "side={side}: metal damgası doğal seti bozmamalı"
            );
            assert!(
                structure_count(&legacy_b) > keys_a.len(),
                "side={side}: B doğal sete ek olarak rescue host içermeli"
            );
        }
    }

    /// Metal rescue host geometrisinin çıktı derinlik/bearing değerlerine yansımasını
    /// legacy formülleriyle çapraz kontrol eder — tünel, oda ve şaft host'larını tek
    /// tablo testinde birleştirir. red_interior_host (rescue) dalında blob şöyle
    /// türetilir: rx/ry ×1.4 (clamp [0.025,0.38]), intensity max(0.48) — bu test o
    /// dönüşümü elle tekrarlayıp `build_tunnel` / `build_chamber`'ı AYNI parametrelerle
    /// çağırır (b_fit değişmez: wall_cues boş → wall_s=0; evidence pipeline'dan birebir
    /// kopyalanır; expand_volume_keep_floors de uygulanır — pipeline satır ~1920).
    /// well_from_metal (şaft) dalı FARKLIDIR: metal blob DÖNÜŞÜMSÜZ kullanılır (1.4×
    /// /0.48 clamp yalnızca rescue dalına özgü), conf = (score_metal·0.92).clamp(0.4,
    /// 0.98), build_chamber shaft dalı + well_physical_diameter_m çap override'ı.
    /// Geometri tablosu (damga rx, damga ry, beklenen sınıf, target, through_red):
    ///   T (0.06, 0.06, tunnel, auto, true)  → axis_aspect 2.17 ≥ 2.15 → build_tunnel
    ///   A (0.05, 0.08, room, auto, true)    → 1.342 ∈ [1.2, 2.15) → build_chamber PCA
    ///     boyutlu dalı (major = half_len·2·map_avg — rx'ten BAĞIMSIZ)
    ///   B (0.05, 0.10, room, auto, true)    → 1.042 < 1.2 → build_chamber rx/ry dalı
    ///   S1 (0.08, 0.07, shaft, well, false) → 2.366 < 2.6 → well_from_metal (yalnız
    ///     dik çekim; !side) — build_chamber shaft + çap override; footprint 1.25 ≤ 2.8
    ///     → well_physical_diameter_m DAL A (çap = footprint.clamp(0.55, 2.8))
    ///   S2 (0.07, 0.15, shaft, well, false) → bbox ~1.0 < 2.6 → aynı dal; footprint
    ///     2.92 > 2.8 → DAL B (çap = (footprint·0.28).clamp(0.8, 2.8)). rx < 0.08
    ///     tutulur çünkü split_peak_blobs rx ≥ 0.08 blobları böler — S2 side guard'da
    ///     da tek blob kalmalı (probe: 6-8 parçaya bölünen büyük damgalar elendi)
    /// Beş geometri birlikte build'in tüm boyut dallarını + çap formülünün iki dalını
    /// kapsar. İddialar (her view × her geometri):
    ///   (a) elle türetilen host blob → build → expand == pipeline host'u (crown/floor
    ///       veya top/bottom, bearing, height, width birebir)
    ///   (b) genişletilmemiş ham metal blob ile aynı build FARKLI derinlik üretir
    ///       (1.4× gerçekten çıktıyı değiştiriyor — test kör değil; shaft'ta çap
    ///       override'sız build FARKLI çap üretir)
    ///   (c) intensity clamp'sız (0.45) ile aynı build FARKLI üst derinlik üretir
    ///       (0.48 clamp'ı emergence → burial zincirini değiştiriyor; shaft'ta conf
    ///       formülü elle hesaplanır ve pipeline ile birebir)
    ///   (d) bearing rx/ry'den BAĞIMSIZ: ham blob da aynı bearing verir (PCA ana
    ///       ekseni dir_x/dir_y/half_len'den gelir — tunnel_endpoints rx'i yalnızca
    ///       aspect < 1.25 veya half_len < 0.02'de kullanır; side/shaft'ta sabit 0.0)
    /// Host geometri tablosu — (damga rx, damga ry, beklenen sınıf, target,
    /// through_red). HEM tablo çapraz kontrolünü HEM dal kapsam raporunu besler
    /// (tek kaynak — satır eklerken kapsam testi hangi dalın kapsandığını doğrular):
    ///   T (0.06, 0.06) tunnel  auto  true  → build_tunnel
    ///   A (0.05, 0.08) room    auto  true  → build_chamber PCA boyut dalı (ax ≥ 1.2)
    ///   B (0.05, 0.10) room    auto  true  → build_chamber rx/ry boyut dalı (ax < 1.2)
    ///   S1 (0.08, 0.07) shaft well false → çap DAL A (footprint ≤ 2.8)
    ///   S2 (0.07, 0.15) shaft well false → çap DAL B (footprint > 2.8)
    const HOST_GEOMS: [(f32, f32, &str, &str, bool); 5] = [
        (0.06, 0.06, "tunnel", "auto", true),
        (0.05, 0.08, "room", "auto", true),
        (0.05, 0.10, "room", "auto", true),
        (0.08, 0.07, "shaft", "well", false),
        (0.07, 0.15, "shaft", "well", false),
    ];

    #[test]
    fn metal_rescue_host_geometry_table_crosscheck() {
        let w = 48u32;
        let h = 24u32;
        let geoms = HOST_GEOMS;
        for side in [false, true] {
            let view = if side { "side" } else { "top" };
            for &(grx, gry, expect, target, through_red) in &geoms {
                let mut s = vec![0.0f32; (w * h) as usize];
                stamp(&mut s, w, h, 0.35, 0.35, 0.06, 0.06, -0.6);
                // Zayıf metal (I=0.45 < 0.48): rescue intensity'yi 0.48'e clamp'ler.
                stamp(&mut s, w, h, 0.75, 0.75, grx, gry, 0.45);
                let wall_cues = vec![];
                let (calib, void_blobs, metal_blobs) = prepare_blobs(&s, w, h, through_red, side);
                assert_eq!(
                    metal_blobs.len(),
                    1,
                    "side={side} geom=({grx},{gry}): tek metal blob (I=0.45, thr=0.45)"
                );
                let mb = &metal_blobs[0];
                let aspect = mb
                    .axis_aspect
                    .max((mb.rx / mb.ry.max(1e-3)).max(mb.ry / mb.rx.max(1e-3)));
                match expect {
                    "tunnel" => assert!(
                        aspect >= 2.15,
                        "side={side} geom=({grx},{gry}): tunnel host için aspect≥2.15 (got {aspect:.3})"
                    ),
                    "shaft" => assert!(
                        aspect < 2.6,
                        "side={side} geom=({grx},{gry}): shaft host için well_like_plan aspect<2.6 (got {aspect:.3})"
                    ),
                    _ => assert!(
                        aspect < 2.15,
                        "side={side} geom=({grx},{gry}): room host için aspect<2.15 (got {aspect:.3})"
                    ),
                }
                let legacy = run_legacy(
                    &s, w, h, view, through_red, target, false, false, 0.35, &wall_cues, &calib,
                    &void_blobs, &metal_blobs,
                );
                let vpe = run_vpe(
                    &s, w, h, view, through_red, target, false, false, 0.35, &wall_cues, &calib,
                    &void_blobs, &metal_blobs,
                );
                assert_pipeline_parity(&legacy, &vpe, side, 0, target);
                // GUARD (shaft): well_from_metal YAPISAL olarak yalnızca dik çekimde
                // açıktır (!side koşulu). Aynı metal blob side view'da hiçbir şekilde
                // well_from_metal marker'lı şaft ÜRETMEMELİ — sessiz skip yerine bu
                // iddia, yan çekimde şaft üretmeye çalışan gelecekteki bir değişikliği
                // anında yakalar (parite yine de legacy==VPE olmalı — üstte doğrulandı).
                if expect == "shaft" && side {
                    assert!(
                        !legacy.chambers.iter().any(|c| {
                            c.kind == "shaft"
                                && c.evidence
                                    .reasons
                                    .iter()
                                    .any(|r| r == "well_from_metal")
                        }),
                        "side view'da well_from_metal şaftı üretilmemeli (!side koşulu)"
                    );
                    continue;
                }
                // (a) Host blob'u elle türet: 1.4× + clamp (rescue dalı; shaft dönüşümsüz)
                let mut hb = mb.clone();
                hb.rx = (mb.rx * 1.4).clamp(0.025, 0.38);
                hb.ry = (mb.ry * 1.4).clamp(0.025, 0.38);
                hb.intensity = mb.intensity.max(0.48);
                if expect != "shaft" {
                    assert!(
                        (hb.rx - mb.rx * 1.4).abs() < 1e-5
                            && (hb.ry - mb.ry * 1.4).abs() < 1e-5,
                        "side={side} geom=({grx},{gry}): rx/ry 1.4× genişleme"
                    );
                    assert_eq!(hb.intensity, 0.48, "side={side}: intensity 0.48 clamp");
                }

                if expect == "shaft" {
                    // GUARD (hedef): well_from_metal YAPISAL olarak yalnızca hedef
                    // açıkça "well" iken açıktır (allow_metal_to_shaft: target ==
                    // "well"). Aynı metal blob target="auto" ile çalıştırıldığında
                    // well_from_metal marker'lı şaft ÜRETMEMELİ — sessiz varsayım yerine
                    // bu iddia, hedef sınırını gevşeten gelecekteki bir değişikliği
                    // yakalar (parite auto'da da legacy==VPE olmalı — üstte doğrulandı).
                    if !side {
                        let auto = run_legacy(
                            &s, w, h, view, through_red, "auto", false, false, 0.35, &wall_cues,
                            &calib, &void_blobs, &metal_blobs,
                        );
                        let auto_v = run_vpe(
                            &s, w, h, view, through_red, "auto", false, false, 0.35, &wall_cues,
                            &calib, &void_blobs, &metal_blobs,
                        );
                        assert_pipeline_parity(&auto, &auto_v, side, 0, "auto");
                        assert!(
                            !auto.chambers.iter().any(|c| {
                                c.kind == "shaft"
                                    && c.evidence
                                        .reasons
                                        .iter()
                                        .any(|r| r == "well_from_metal")
                            }),
                            "target=auto: well_from_metal şaftı üretilmemeli (allow_metal_to_shaft sınırı)"
                        );
                    }
                    // well_from_metal: dönüşümsüz metal blob + conf formülü + çap override
                    let host = legacy
                        .chambers
                        .iter()
                        .find(|c| {
                            c.kind == "shaft"
                                && c.evidence
                                    .reasons
                                    .iter()
                                    .any(|r| r == "well_from_metal")
                        })
                        .expect("well_from_metal şaftı olmalı");
                    // (c) conf formülü: (score_metal·0.92).clamp(0.4, 0.98)
                    let bbox_aspect = (mb.rx / mb.ry.max(1e-3)).max(mb.ry / mb.rx.max(1e-3));
                    let (score_metal, _margin) =
                        metal_gate_components(mb.intensity, mb.fill_ratio, bbox_aspect);
                    let conf = (score_metal * 0.92).clamp(0.4, 0.98);
                    assert!(
                        (conf - host.confidence).abs() < 1e-4,
                        "shaft: conf formülü (score_metal·0.92) == pipeline (got {conf:.4} vs {:.4})",
                        host.confidence
                    );
                    // (a) build_chamber shaft + çap override + expand == pipeline
                    let mut built = build_chamber(
                        mb,
                        VoidClass::Shaft,
                        false,
                        24.0,
                        10.0,
                        10.0,
                        conf,
                        host.evidence.clone(),
                    )
                    .expect("build_chamber shaft");
                    let d = well_physical_diameter_m(mb, 24.0, 10.0);
                    built.width_m = d;
                    built.length_m = d;
                    // (e) Çap formülünün iki dalı: footprint = min(rx·2·map_w,
                    // ry·2·map_d).max(0.4). DAL A (≤2.8): d = footprint.clamp(0.55,
                    // 2.8) — küçük ayakizi olduğu gibi. DAL B (>2.8): d =
                    // (footprint·0.28).clamp(0.8, 2.8) — büyük ayakizi oransal küçülür.
                    // Tablo iki geometri taşır (S1/S2) — her satır hangi daldaysa
                    // formül birebir doğrulanır. MUTASYON DENEYİ: dal B çarpanı
                    // 0.28→0.26 yapılınca S2 yakalanır; eşik 2.8→2.7 ise yakalanmaz
                    // (piksel niceleme: footprint 2.5/2.917 adımlarında, 2.7/2.8
                    // ikisini de aynı dala koyar — davranış değişmez).
                    let footprint = (mb.rx * 2.0 * 24.0).min(mb.ry * 2.0 * 10.0).max(0.4);
                    let expected = if footprint <= 2.8 {
                        footprint.clamp(0.55, 2.8)
                    } else {
                        (footprint * 0.28).clamp(0.8, 2.8)
                    };
                    assert!(
                        (d - expected).abs() < 1e-4,
                        "shaft geom=({grx},{gry}): çap formülü dalı (footprint {footprint:.3}, d {d:.3} vs beklenen {expected:.3})"
                    );
                    assert!(
                        (built.width_m - host.width_m).abs() < 1e-4
                            && (built.length_m - host.length_m).abs() < 1e-4,
                        "shaft geom=({grx},{gry}): çap override pipeline çapına eşit"
                    );
                    let mut chambers = vec![built.clone()];
                    expand_volume_keep_floors(&mut chambers, &mut [], 10.0);
                    built = chambers.remove(0);
                    assert!(
                        (built.top_from_surface_m - host.top_from_surface_m).abs() < 1e-4
                            && (built.bottom_from_surface_m - host.bottom_from_surface_m).abs()
                                < 1e-4
                            && (built.bearing_deg - host.bearing_deg).abs() < 1e-3
                            && (built.height_m - host.height_m).abs() < 1e-3
                            && (built.width_m - host.width_m).abs() < 1e-3
                            && (built.length_m - host.length_m).abs() < 1e-3,
                        "shaft: elle build_chamber shaft + çap override + expand == pipeline (top {:.4} vs {:.4}, bottom {:.4} vs {:.4}, çap {:.3} vs {:.3})",
                        built.top_from_surface_m,
                        host.top_from_surface_m,
                        built.bottom_from_surface_m,
                        host.bottom_from_surface_m,
                        built.width_m,
                        host.width_m,
                    );
                    // (b) Çap override'sız build_chamber: FARKLI çap üretir. Yalnızca
                    // DAL A'da (footprint ≤ 2.8): küçük ayakizinde build_chamber shaft
                    // dalının kendi çapı (clamp(0.5, 5.0), büyükse ·0.28) override'sız
                    // büyür, override küçültür. DAL B'de (footprint > 2.8) build_chamber
                    // iç küçültmesi (d > 2.8 → d·0.28) İLE well_physical_diameter_m dal
                    // B'si (footprint·0.28) AYNI formüldür → override no-op olur (doğru
                    // davranış; (a) zaten built == pipeline'ı kanıtlar).
                    if footprint <= 2.8 {
                        let raw = build_chamber(
                            mb,
                            VoidClass::Shaft,
                            false,
                            24.0,
                            10.0,
                            10.0,
                            conf,
                            host.evidence.clone(),
                        )
                        .expect("build_chamber shaft raw");
                        assert!(
                            (raw.width_m - host.width_m).abs() > 1e-3
                                || (raw.length_m - host.length_m).abs() > 1e-3,
                            "shaft: well_physical_diameter_m override çapı değiştirmeli (raw w={:.3})",
                            raw.width_m
                        );
                    }
                    continue;
                }

                if expect == "tunnel" {
                    let host = legacy
                        .tunnels
                        .iter()
                        .find(|t| {
                            t.evidence
                                .reasons
                                .iter()
                                .any(|r| r == "rewrite:red_interior_host")
                        })
                        .expect("host tüneli olmalı");
                    // Aynı evidence + conf ile build_tunnel; expand'ı da uygula
                    let mut built = build_tunnel(
                        &hb,
                        side,
                        24.0,
                        10.0,
                        10.0,
                        host.confidence,
                        host.evidence.clone(),
                        &wall_cues,
                        &s,
                        w,
                        h,
                        calib.metal_thr,
                    )
                    .expect("build_tunnel");
                    let mut tunnels = vec![built.clone()];
                    expand_volume_keep_floors(&mut [], &mut tunnels, 10.0);
                    built = tunnels.remove(0);
                    assert!(
                        (built.crown_from_surface_m - host.crown_from_surface_m).abs() < 1e-4
                            && (built.floor_from_surface_m - host.floor_from_surface_m).abs() < 1e-4
                            && (built.bearing_deg - host.bearing_deg).abs() < 1e-3
                            && (built.height_m - host.height_m).abs() < 1e-3
                            && (built.width_m - host.width_m).abs() < 1e-3,
                        "side={side} geom=({grx},{gry}): elle host → build_tunnel+expand == pipeline (crown {:.4} vs {:.4}, floor {:.4} vs {:.4}, bearing {:.2} vs {:.2})",
                        built.crown_from_surface_m,
                        host.crown_from_surface_m,
                        built.floor_from_surface_m,
                        host.floor_from_surface_m,
                        built.bearing_deg,
                        host.bearing_deg,
                    );
                    // (b) Genişletilmemiş ham blob: FARKLI height/floor
                    let raw = build_tunnel(
                        mb,
                        side,
                        24.0,
                        10.0,
                        10.0,
                        host.confidence,
                        host.evidence.clone(),
                        &wall_cues,
                        &s,
                        w,
                        h,
                        calib.metal_thr,
                    )
                    .expect("build_tunnel raw");
                    assert!(
                        (raw.height_m - host.height_m).abs() > 1e-3
                            || (raw.floor_from_surface_m - host.floor_from_surface_m).abs() > 1e-3,
                        "side={side} geom=({grx},{gry}): 1.4× genişleme height/floor'u değiştirmeli (raw h={:.4} floor={:.4})",
                        raw.height_m,
                        raw.floor_from_surface_m,
                    );
                    // (c) Intensity clamp'sız (0.45): FARKLI crown
                    let mut nc = hb.clone();
                    nc.intensity = mb.intensity;
                    let no_clamp = build_tunnel(
                        &nc,
                        side,
                        24.0,
                        10.0,
                        10.0,
                        host.confidence,
                        host.evidence.clone(),
                        &wall_cues,
                        &s,
                        w,
                        h,
                        calib.metal_thr,
                    )
                    .expect("build_tunnel no_clamp");
                    assert!(
                        (no_clamp.crown_from_surface_m - host.crown_from_surface_m).abs() > 1e-4,
                        "side={side} geom=({grx},{gry}): 0.48 clamp crown'u değiştirmeli (no_clamp crown={:.4})",
                        no_clamp.crown_from_surface_m,
                    );
                    // (d) Bearing rx/ry'den bağımsız (PCA ekseni)
                    assert!(
                        (raw.bearing_deg - host.bearing_deg).abs() < 1e-3,
                        "side={side} geom=({grx},{gry}): bearing rx/ry genişlemesinden bağımsız olmalı"
                    );
                } else {
                    let host = legacy
                        .chambers
                        .iter()
                        .find(|c| {
                            c.evidence
                                .reasons
                                .iter()
                                .any(|r| r == "rewrite:red_interior_host")
                        })
                        .expect("host odası olmalı");
                    // (a) Elle türetilen host blob → build_chamber → expand == pipeline
                    let mut built = build_chamber(
                        &hb,
                        VoidClass::Room,
                        side,
                        24.0,
                        10.0,
                        10.0,
                        host.confidence,
                        host.evidence.clone(),
                    )
                    .expect("build_chamber");
                    let mut chambers = vec![built.clone()];
                    expand_volume_keep_floors(&mut chambers, &mut [], 10.0);
                    built = chambers.remove(0);
                    assert!(
                        (built.top_from_surface_m - host.top_from_surface_m).abs() < 1e-4
                            && (built.bottom_from_surface_m - host.bottom_from_surface_m).abs() < 1e-4
                            && (built.bearing_deg - host.bearing_deg).abs() < 1e-3
                            && (built.height_m - host.height_m).abs() < 1e-3
                            && (built.width_m - host.width_m).abs() < 1e-3
                            && (built.length_m - host.length_m).abs() < 1e-3,
                        "side={side} geom=({grx},{gry}): elle host → build_chamber+expand == pipeline (top {:.4} vs {:.4}, bottom {:.4} vs {:.4}, bearing {:.2} vs {:.2})",
                        built.top_from_surface_m,
                        host.top_from_surface_m,
                        built.bottom_from_surface_m,
                        host.bottom_from_surface_m,
                        built.bearing_deg,
                        host.bearing_deg,
                    );
                    // (b) Genişletilmemiş ham blob: FARKLI top/bottom
                    let raw = build_chamber(
                        mb,
                        VoidClass::Room,
                        side,
                        24.0,
                        10.0,
                        10.0,
                        host.confidence,
                        host.evidence.clone(),
                    )
                    .expect("build_chamber raw");
                    assert!(
                        (raw.top_from_surface_m - host.top_from_surface_m).abs() > 1e-4
                            || (raw.bottom_from_surface_m - host.bottom_from_surface_m).abs() > 1e-4,
                        "side={side} geom=({grx},{gry}): 1.4× genişleme top/bottom'ı değiştirmeli (raw top={:.4} bottom={:.4})",
                        raw.top_from_surface_m,
                        raw.bottom_from_surface_m,
                    );
                    // (c) Intensity clamp'sız (0.45): FARKLI top
                    let mut nc = hb.clone();
                    nc.intensity = mb.intensity;
                    let no_clamp = build_chamber(
                        &nc,
                        VoidClass::Room,
                        side,
                        24.0,
                        10.0,
                        10.0,
                        host.confidence,
                        host.evidence.clone(),
                    )
                    .expect("build_chamber no_clamp");
                    assert!(
                        (no_clamp.top_from_surface_m - host.top_from_surface_m).abs() > 1e-4,
                        "side={side} geom=({grx},{gry}): 0.48 clamp top'u değiştirmeli (no_clamp top={:.4})",
                        no_clamp.top_from_surface_m,
                    );
                    // (d) Bearing rx/ry'den bağımsız
                    assert!(
                        (raw.bearing_deg - host.bearing_deg).abs() < 1e-3,
                        "side={side} geom=({grx},{gry}): bearing rx/ry'den bağımsız olmalı"
                    );
                }
            }
        }
    }

    /// Dal kapsam raporu — HOST_GEOMS'daki her geometrinin hangi build dalını
    /// tetiklediğini bağımsız sayaçlarla doğrular (vakum koruması). Tablo çapraz
    /// kontrolü her satırın pipeline'la eşleştiğini kanıtlar; bu test ise beş dalın
    /// TAMAMININ en az bir geometriyle kapsandığını iddia eder — biri tabloya satır
    /// eklerken yanlışlıkla tek bir dalı çok sayıda satırla kapsayıp bir başkasını
    /// boş bırakırsa burada yakalanır:
    ///   build_tunnel (T), build_chamber PCA boyut (A), build_chamber rx/ry boyut
    ///   (B), well_physical_diameter_m DAL A (S1), DAL B (S2). Her geometri yalnızca
    ///   KENDİ dalına yazılır; hedef ve through_red satıra özgü olabilir (shaft).
    #[test]
    fn metal_rescue_host_geometry_branch_coverage() {
        let w = 48u32;
        let h = 24u32;
        let mut counts: [usize; 5] = [0; 5];
        for &(grx, gry, expect, target, through_red) in &HOST_GEOMS {
            let mut s = vec![0.0f32; (w * h) as usize];
            stamp(&mut s, w, h, 0.35, 0.35, 0.06, 0.06, -0.6);
            stamp(&mut s, w, h, 0.75, 0.75, grx, gry, 0.45);
            let (calib, void_blobs, metal_blobs) = prepare_blobs(&s, w, h, through_red, false);
            assert_eq!(
                metal_blobs.len(),
                1,
                "geom=({grx},{gry}): tek metal blob"
            );
            let mb = &metal_blobs[0];
            let idx = match expect {
                "tunnel" => {
                    let aspect = mb
                        .axis_aspect
                        .max((mb.rx / mb.ry.max(1e-3)).max(mb.ry / mb.rx.max(1e-3)));
                    assert!(
                        aspect >= 2.15,
                        "T geom=({grx},{gry}): build_tunnel için aspect≥2.15 (got {aspect:.3})"
                    );
                    0
                }
                "room" => {
                    if mb.axis_aspect >= 1.2 {
                        // PCA boyut dalı (major = half_len·2·map_avg)
                        assert!(
                            grx < gry,
                            "A geom=({grx},{gry}): PCA dalı için axis_aspect≥1.2 (got {:.3})",
                            mb.axis_aspect
                        );
                        1
                    } else {
                        // rx/ry boyut dalı (width = rx·2·map_w)
                        assert!(
                            grx < gry,
                            "B geom=({grx},{gry}): rx/ry dalı için axis_aspect<1.2 (got {:.3})",
                            mb.axis_aspect
                        );
                        2
                    }
                }
                "shaft" => {
                    let footprint = (mb.rx * 2.0 * 24.0).min(mb.ry * 2.0 * 10.0).max(0.4);
                    if footprint <= 2.8 {
                        assert_eq!(target, "well", "S1: DAL A yalnızca well hedefinde");
                        3
                    } else {
                        assert_eq!(target, "well", "S2: DAL B yalnızca well hedefinde");
                        4
                    }
                }
                _ => unreachable!(),
            };
            counts[idx] += 1;
            // Kapsanan dalın gerçekten pipeline'da üretildiğini doğrula (kör iddia
            // olmasın — sayaç geometriden, host pipeline'dan)
            let legacy = run_legacy(
                &s, w, h, "top", through_red, target, false, false, 0.35, &[], &calib,
                &void_blobs, &metal_blobs,
            );
            let marker = "rewrite:red_interior_host";
            match expect {
                "tunnel" => assert!(
                    legacy.tunnels.iter().any(|t| {
                        t.evidence.reasons.iter().any(|r| r == marker)
                    }),
                    "T geom=({grx},{gry}): pipeline tünel host üretmeli"
                ),
                "room" => assert!(
                    legacy.chambers.iter().any(|c| {
                        c.kind == "room"
                            && c.evidence.reasons.iter().any(|r| r == marker)
                    }),
                    "room geom=({grx},{gry}): pipeline room host üretmeli"
                ),
                "shaft" => assert!(
                    legacy.chambers.iter().any(|c| {
                        c.kind == "shaft"
                            && c.evidence.reasons.iter().any(|r| r == "well_from_metal")
                    }),
                    "shaft geom=({grx},{gry}): pipeline well_from_metal şaftı üretmeli"
                ),
                _ => unreachable!(),
            }
        }
        let names = [
            "build_tunnel",
            "build_chamber PCA boyut",
            "build_chamber rx/ry boyut",
            "well_physical_diameter_m DAL A",
            "well_physical_diameter_m DAL B",
        ];
        for (i, name) in names.iter().enumerate() {
            assert!(
                counts[i] > 0,
                "dal kapsamasız: {name} — HOST_GEOMS'a bu dalı tetikleyen bir satır ekle"
            );
        }
    }

    /// class_allowed kısıtlarını farklı hedef adlarıyla doğrula.
    /// Her hedef (auto/well/room/tunnel/site) için class_allowed'ın beklenen
    /// sınıflara izin verdiğini ve beklenenleri engellediğini test eder.
    #[test]
    fn class_allowed_target_constraints() {
        use super::VoidClass;
        let cases: &[(&str, &[VoidClass], &[VoidClass])] = &[
            // (target, izin_verilen, engellenen)
            ("auto", &[
                VoidClass::Room, VoidClass::Tomb, VoidClass::Tunnel, VoidClass::Shaft,
            ], &[VoidClass::Noise]),
            ("well", &[VoidClass::Shaft], &[
                VoidClass::Room, VoidClass::Tomb, VoidClass::Tunnel, VoidClass::Noise,
            ]),
            ("room", &[
                VoidClass::Room, VoidClass::Tomb, VoidClass::Tunnel,
            ], &[VoidClass::Shaft, VoidClass::Noise]),
            ("tunnel", &[VoidClass::Tunnel], &[
                VoidClass::Room, VoidClass::Tomb, VoidClass::Shaft, VoidClass::Noise,
            ]),
            ("site", &[
                VoidClass::Room, VoidClass::Tomb, VoidClass::Tunnel,
            ], &[VoidClass::Shaft, VoidClass::Noise]),
        ];
        for &(target, allowed, denied) in cases {
            for cls in allowed {
                assert!(
                    class_allowed(target, *cls),
                    "target={target}: {:?} izin verilmeli",
                    cls
                );
            }
            for cls in denied {
                assert!(
                    !class_allowed(target, *cls),
                    "target={target}: {:?} engellenmeli",
                    cls
                );
            }
        }
    }

    /// HOST_GEOMS geometrilerini farklı hedeflerle çalıştırarak class_allowed
    /// kısıtlarının pipeline çıktısına yansıdığını doğrula.
    ///
    /// Örneğin: room geometrisi target=well ile çalıştırıldığında shaft üretilmeli,
    /// target=tunnel ile çalıştırıldığında tünel üretilmeli.
    #[test]
    fn class_allowed_affects_pipeline_output() {
        let w = 48u32;
        let h = 24u32;

        // Room geometrisi (0.05, 0.08)
        let grx = 0.05f32;
        let gry = 0.08f32;
        let mut s = vec![0.0f32; (w * h) as usize];
        stamp(&mut s, w, h, 0.35, 0.35, 0.06, 0.06, -0.6);
        stamp(&mut s, w, h, 0.75, 0.75, grx, gry, 0.45);
        let (calib, void_blobs, metal_blobs) = prepare_blobs(&s, w, h, true, false);

        // target=auto: oda üretilmeli
        let out_auto = run_legacy(
            &s, w, h, "top", true, "auto", false, false, 0.35, &[], &calib,
            &void_blobs, &metal_blobs,
        );
        assert!(
            out_auto.chambers.iter().any(|c| c.kind == "room"),
            "target=auto: room geometrisi oda üretmeli"
        );

        // target=well: şaft üretilmeli (metal → well_from_metal)
        let out_well = run_legacy(
            &s, w, h, "top", true, "well", false, false, 0.35, &[], &calib,
            &void_blobs, &metal_blobs,
        );
        assert!(
            out_well.chambers.iter().any(|c| c.kind == "shaft"),
            "target=well: metal şaft üretmeli"
        );

        // target=tunnel: yalnızca tünel üretilmeli (oda değil)
        let out_tunnel = run_legacy(
            &s, w, h, "top", true, "tunnel", false, false, 0.35, &[], &calib,
            &void_blobs, &metal_blobs,
        );
        // tunnel hedefinde room üretilmemeli
        assert!(
            !out_tunnel.chambers.iter().any(|c| c.kind == "room"),
            "target=tunnel: room üretmemeli"
        );

        // Tunnel geometrisi (0.06, 0.06) — target=tunnel ile tünel üretilmeli
        let mut s2 = vec![0.0f32; (w * h) as usize];
        stamp(&mut s2, w, h, 0.35, 0.35, 0.06, 0.06, -0.6);
        stamp(&mut s2, w, h, 0.75, 0.75, 0.06, 0.06, 0.45);
        let (calib2, void_blobs2, metal_blobs2) = prepare_blobs(&s2, w, h, true, false);
        let out_t2 = run_legacy(
            &s2, w, h, "top", true, "tunnel", false, false, 0.35, &[], &calib2,
            &void_blobs2, &metal_blobs2,
        );
        assert!(
            out_t2.tunnels.len() > 0 || out_t2.chambers.iter().any(|c| c.kind == "shaft"),
            "target=tunnel: tünel geometrisi tünel veya şaft üretmeli"
        );
    }

    /// Marker (`rewrite:red_interior_host`) taşımayan yapıların (oda+tünel) anahtar
    /// seti — metal rescue host'unu doğal içerikten ayırır.
    fn natural_structure_keys(
        out: &UndergroundStructures,
    ) -> Vec<(String, i64, i64, i64, i64, i64, i64, i64, i64, u8)> {
        let mut v: Vec<(String, i64, i64, i64, i64, i64, i64, i64, i64, u8)> = chamber_keys(out)
            .into_iter()
            .zip(out.chambers.iter())
            .filter(|(_, c)| {
                !c.evidence
                    .reasons
                    .iter()
                    .any(|r| r == "rewrite:red_interior_host")
            })
            .map(|(k, _)| k)
            .collect();
        v.extend(
            tunnel_keys(out)
                .into_iter()
                .zip(out.tunnels.iter())
                .filter(|(_, t)| {
                    !t.evidence
                        .reasons
                        .iter()
                        .any(|r| r == "rewrite:red_interior_host")
                })
                .map(|(k, _)| {
                    // Tünel anahtarını oda anahtarı türüne sığdır: (p,q)->(kind=0,
                    // cx,cy, crown,floor,height,width,bearing,tier)
                    let ((x0, y0), (x1, y1), crown, floor, height, width, bearing, tier) = k;
                    (
                        String::from("tunnel"),
                        x0,
                        y0,
                        crown,
                        floor,
                        height,
                        width,
                        bearing,
                        x1,
                        tier,
                    )
                }),
        );
        v
    }

    fn structure_count(out: &UndergroundStructures) -> usize {
        out.chambers.len() + out.tunnels.len()
    }

    fn structure_keys(
        out: &UndergroundStructures,
    ) -> Vec<(String, i64, i64, i64, i64, i64, i64, i64, i64, u8)> {
        let mut v = natural_structure_keys(out);
        // Rescue host'ları da ekle: marker'lı tüm yapılar
        v.extend(
            chamber_keys(out)
                .into_iter()
                .zip(out.chambers.iter())
                .filter(|(_, c)| {
                    c.evidence
                        .reasons
                        .iter()
                        .any(|r| r == "rewrite:red_interior_host")
                })
                .map(|(k, _)| k),
        );
        v.extend(
            tunnel_keys(out)
                .into_iter()
                .zip(out.tunnels.iter())
                .filter(|(_, t)| {
                    t.evidence
                        .reasons
                        .iter()
                        .any(|r| r == "rewrite:red_interior_host")
                })
                .map(|(k, _)| {
                    let ((x0, y0), (x1, y1), crown, floor, height, width, bearing, tier) = k;
                    (
                        String::from("tunnel"),
                        x0,
                        y0,
                        crown,
                        floor,
                        height,
                        width,
                        bearing,
                        x1,
                        tier,
                    )
                }),
        );
        v
    }

    fn metal_rescue_count(out: &UndergroundStructures) -> usize {
        out.chambers
            .iter()
            .flat_map(|c| c.evidence.reasons.iter())
            .chain(out.tunnels.iter().flat_map(|t| t.evidence.reasons.iter()))
            .filter(|r| r.as_str() == "rewrite:red_interior_host")
            .count()
    }

    fn gate_fired(out: &UndergroundStructures) -> bool {
        out.chambers.iter().any(|c| {
            c.evidence
                .reasons
                .iter()
                .any(|r| r == "rewrite:through_red_gate")
        }) || out.tunnels.iter().any(|t| {
            t.evidence
                .reasons
                .iter()
                .any(|r| r == "rewrite:through_red_gate")
        })
    }

    #[test]
    fn shared_through_red_branch_markers_parity() {
        let mut rng = Rng(0x7B0D_2026u64);
        let mut rescue = (0usize, 0usize); // (legacy, vpe)
        let mut gate_rescue = (0usize, 0usize);
        let mut metal_rescue = (0usize, 0usize);
        for side in [false, true] {
            let view = if side { "side" } else { "top" };
            for case in 0..120u64 {
                let (signed, wall_cues) = random_noisy_field(&mut rng, 48, 24, side);
                let (calib, void_blobs, metal_blobs) =
                    prepare_blobs(&signed, 48, 24, true, side);
                let legacy = run_legacy(
                    &signed, 48, 24, view, true, "auto", false, false, 0.35, &wall_cues, &calib,
                    &void_blobs, &metal_blobs,
                );
                let vpe = run_vpe(
                    &signed, 48, 24, view, true, "auto", false, false, 0.35, &wall_cues, &calib,
                    &void_blobs, &metal_blobs,
                );
                assert_pipeline_parity(&legacy, &vpe, side, case, "auto");
                let mut f_r = (0usize, 0usize);
                let mut f_g = (0usize, 0usize);
                for out in [&legacy, &vpe] {
                    let (r, g) = if std::ptr::eq(out, &legacy) {
                        (&mut f_r.0, &mut f_g.0)
                    } else {
                        (&mut f_r.1, &mut f_g.1)
                    };
                    for c in &out.chambers {
                        for reason in &c.evidence.reasons {
                            match reason.as_str() {
                                "rewrite:through_red_rescue" => *r += 1,
                                "rewrite:through_red_gate" => *g += 1,
                                _ => {}
                            }
                        }
                    }
                    for t in &out.tunnels {
                        for reason in &t.evidence.reasons {
                            match reason.as_str() {
                                "rewrite:through_red_rescue" => *r += 1,
                                "rewrite:through_red_gate" => *g += 1,
                                _ => {}
                            }
                        }
                    }
                }
                rescue.0 += f_r.0;
                rescue.1 += f_r.1;
                gate_rescue.0 += f_g.0;
                gate_rescue.1 += f_g.1;
            }
        }
        // Metal rescue (1275) rastgele gürültülü alanlarda nadiren ateşleniyor (metal
        // blob'lar genelde void'lerle kaplı) — deterministik damga ile zorla ateşlet:
        // yalnızca metal (pozitif), void yok → kaplı değil → intensity ≥ 0.38 ve
        // snr ≥ 1.2 → metal etrafında oda/tünel kurtarılır.
        for side in [false, true] {
            let w = 48u32;
            let h = 24u32;
            let mut s = vec![0.0f32; (w * h) as usize];
            stamp(&mut s, w, h, 0.5, 0.5, 0.06, 0.06, 0.6);
            let (calib, void_blobs, metal_blobs) = prepare_blobs(&s, w, h, true, side);
            assert!(!metal_blobs.is_empty(), "metal blob oluşmalı");
            let view = if side { "side" } else { "top" };
            let wall_cues = vec![];
            let legacy = run_legacy(
                &s, w, h, view, true, "auto", false, false, 0.35, &wall_cues, &calib,
                &void_blobs, &metal_blobs,
            );
            let vpe = run_vpe(
                &s, w, h, view, true, "auto", false, false, 0.35, &wall_cues, &calib,
                &void_blobs, &metal_blobs,
            );
            assert_pipeline_parity(&legacy, &vpe, side, 999, "auto");
            for out in [&legacy, &vpe] {
                let (_, _, m) = if std::ptr::eq(out, &legacy) {
                    (&mut rescue.0, &mut gate_rescue.0, &mut metal_rescue.0)
                } else {
                    (&mut rescue.1, &mut gate_rescue.1, &mut metal_rescue.1)
                };
                for c in &out.chambers {
                    for reason in &c.evidence.reasons {
                        if reason == "rewrite:red_interior_host" {
                            *m += 1;
                        }
                    }
                }
                for t in &out.tunnels {
                    for reason in &t.evidence.reasons {
                        if reason == "rewrite:red_interior_host" {
                            *m += 1;
                        }
                    }
                }
            }
        }
        assert_eq!(rescue.0, rescue.1, "rescue ateşleme sayısı legacy==VPE");
        assert_eq!(gate_rescue.0, gate_rescue.1, "gate rescue ateşleme sayısı legacy==VPE");
        assert_eq!(
            metal_rescue.0, metal_rescue.1,
            "metal rescue ateşleme sayısı legacy==VPE"
        );
        assert!(rescue.0 > 0, "vakum: through_red rescue hiç ateşlenmedi");
        assert!(gate_rescue.0 > 0, "vakum: through_red gate rescue hiç ateşlenmedi");
        assert!(metal_rescue.0 > 0, "vakum: metal rescue hiç ateşlenmedi");
    }

    /// Metal kapı denetiminin kalıcı kanıtı (void kapılarındaki conf-tabanı denetiminin
    /// metal eşleniği — bkz. metal_gate_components yorumu). Paylaşılan gövdenin metal
    /// döngüsünde use_vpe dalı YOKTUR: snr (1.4), margin (0.12) ve score_metal
    /// (≥ min_confidence) eşikleri tek kod yolunda, iki taraf için aynı girdiyle
    /// hesaplanır. Engine `decide_metals` kararı ortak gövdede tüketilmez (yalnızca
    /// DecisionBatch rapor sayımları); metal çıktısı oda/tünel paritesinin ardışığıdır
    /// (near_accepted_structure, well_from_metal, attach_metal_to_structure, post-filter).
    /// Yani 'farklı conf tabanı' tuzağı yapısal olarak imkânsız. KALAN RİSK: engine
    /// portu hiçbir süpürmede sınanmıyor — biri motor metal kararlarını tüketmeye
    /// başlarsa portun formülü sapmış olabilir. Bu test portun eşik formülünü paylaşılan
    /// metal_gate_components ile birebir sabitler: kapı yüzeyinde (snr 1.4, margin 0.12,
    /// score_metal vs min_conf, aspect 2.4 dalı) ızgara BlobDto'lar motor kapısından
    /// geçirilir (dev oda → geçenler attach olur) ve her blobda engine kabulü ==
    /// paylaşılan formül + conf eşleşmesi iddia edilir.
    #[test]
    fn metal_gate_engine_parity() {
        use votex_prob::decide::metal::decide_metals;
        use votex_prob::decide::RoomSlot;
        use votex_prob::schema::BlobDto;

        let mut n_attach = 0usize;
        let mut n_reject = 0usize;
        // Tüm ızgara bloblarını kapsayan dev oda: kapıdan geçen her metal attach olur
        // (plan_hit top: dx²+dy² ≤ 1.55² — rx=5.0'ta her konum için < 0.01; yan: erişim
        // çarpanları 1.75/2.1 ile ~8.9/~10.6 — her konum içinde).
        let rooms = vec![RoomSlot {
            id: "r0".into(),
            cx: 0.5,
            cy: 0.5,
            rx: 5.0,
            ry: 5.0,
            width_m: 10.0,
            top: 0.5,
            bottom: 9.5,
            height_m: 9.0,
            intensity: 0.5,
        }];
        for min_conf in [0.35f32, 0.6] {
            for side in [false, true] {
                for i in 0..18 {
                    let intensity = 0.03 + i as f32 * 0.05; // 0.03..0.88 → snr 0.5..14.7
                    for j in 0..9 {
                        let fill = 0.1 + j as f32 * 0.1; // 0.10..0.90
                        for a in 0..7 {
                            let aspect = 1.0 + a as f32 * 0.3; // 1.0..2.8 (2.4 sınırını kapsar)
                            let rx = 0.05f32;
                            let ry = (rx / aspect.max(0.05)).min(1.0);
                            let snr = intensity / 0.06;
                            let dto = BlobDto {
                                id: format!("m{i}_{j}_{a}_{side}_{min_conf}"),
                                cx: 0.3,
                                cy: 0.3,
                                rx,
                                ry,
                                intensity,
                                fill_ratio: fill,
                                aspect,
                                path_s: 0.0,
                                wall_s: 0.0,
                                line_s: 0.0,
                                near_red: false,
                                snr,
                                axis_aspect: aspect,
                                half_len: 0.0,
                            };
                            let dec =
                                decide_metals(&[dto], &rooms, &[], min_conf, false, side, 24.0);
                            let engine_ok = dec[0].action == "attach";
                            let (score_metal, margin) =
                                metal_gate_components(intensity, fill, aspect);
                            let shared_ok =
                                snr >= 1.4 && margin >= 0.12 && score_metal >= min_conf;
                            assert_eq!(
                                engine_ok, shared_ok,
                                "mc={min_conf} side={side} i={i} fill={fill:.2} aspect={aspect:.2} \
                                 snr={snr:.2} score={score_metal:.3} margin={margin:.3}"
                            );
                            if engine_ok {
                                n_attach += 1;
                                assert!(
                                    (dec[0].conf - score_metal.clamp(0.0, 1.0)).abs() < 1e-4,
                                    "conf eşleşmeli: {} vs {}",
                                    dec[0].conf,
                                    score_metal
                                );
                            } else {
                                n_reject += 1;
                            }
                        }
                    }
                }
            }
        }
        // Vakum: kapı yüzeyinin her iki tarafı da gerçekten süpürülmeli (ölçüm:
        // 2 mc × 2 yön × 18 yoğunluk × 9 dolgu × 7 aspect = 4536 blob)
        assert!(n_attach > 0, "kapıdan geçen en az bir metal olmalı");
        assert!(n_reject > 0, "kapıyı reddeden en az bir metal olmalı");
    }


    /// Vakum koruması: staged süpürmesinin gerçekten derin tier yapıları ürettiğini
    /// doğrular (üreteç değişirse test boş geçmesin).
    #[test]
    fn staged_produces_deep_tiers() {
        let mut n_deep = 0usize;
        for (target, seed) in [
            ("auto", 0x51A6_2026u64),
            ("room", 0x51A7_2026u64),
            ("tunnel", 0x51A8_2026u64),
            ("site", 0x51A9_2026u64),
        ] {
            let mut rng = Rng(seed);
            for side in [false, true] {
                for through_red in [false, true] {
                    for _ in 0..80u64 {
                        let w = 48u32;
                        let h = 24u32;
                        let (signed, wall_cues) = random_field(&mut rng, w, h, side);
                        let (calib, void_blobs, metal_blobs) =
                            prepare_blobs(&signed, w, h, through_red, side);
                        let view = if side { "side" } else { "top" };
                        let r = run_legacy(
                            &signed, w, h, view, through_red, target, true, false, 0.35, &wall_cues,
                            &calib, &void_blobs, &metal_blobs,
                        );
                        n_deep += r.chambers.iter().filter(|c| c.tier > 0).count();
                        n_deep += r.tunnels.iter().filter(|t| t.tier > 0).count();
                    }
                }
            }
        }
        assert!(n_deep > 0, "derin tier yapısı üretilmeli, got {n_deep}");
    }

    /// Well_from_metal: dik çekimde güçlü, kompakt kırmızı ayakizi (kapak/ağız)
    /// → şaft gövdesi. İki tarafta da aynı şaft üretilmeli (kind, konum, derinlik).
    #[test]
    fn well_from_metal_deterministic_parity() {
        let w = 48u32;
        let h = 24u32;
        let mut s = vec![0.0f32; (w * h) as usize];
        // Kompakt, güçlü metal — interpret_red_cue "metal" döndürmeli, well_like_plan
        // kompaktlığı karşılamalı (aspect < 2.6, fill ≥ 0.22, çap 0.35..20, intensity ≥ 0.22)
        stamp(&mut s, w, h, 0.5, 0.5, 0.08, 0.07, 0.72);
        // Yanında bir void olsun — near_v → kırmızı yapı ilişkisi net
        stamp(&mut s, w, h, 0.35, 0.5, 0.08, 0.07, -0.6);
        let wall_cues = vec![];
        let through_red = false;
        let side = false;
        let (calib, void_blobs, metal_blobs) = prepare_blobs(&s, w, h, through_red, side);
        assert!(!metal_blobs.is_empty(), "metal blob oluşmalı");
        let legacy = run_legacy(
            &s, w, h, "top", through_red, "well", false, false, 0.35, &wall_cues, &calib, &void_blobs,
            &metal_blobs,
        );
        let vpe = run_vpe(
            &s, w, h, "top", through_red, "well", false, false, 0.35, &wall_cues, &calib, &void_blobs,
            &metal_blobs,
        );
        assert_pipeline_parity(&legacy, &vpe, side, 0, "well");
        // İki tarafta da en az bir şaft üretilmeli (well_from_metal veya fallback)
        assert!(
            legacy.chambers.iter().any(|c| c.kind == "shaft"),
            "legacy şaft üretmeli, got {:?}",
            legacy.chambers.iter().map(|c| &c.kind).collect::<Vec<_>>()
        );
    }

    /// Fallback kuyu: dik + well + şaft yok + metal var → en güçlü ayakizinden şaft.
    #[test]
    fn well_fallback_deterministic_parity() {
        let w = 48u32;
        let h = 24u32;
        let mut s = vec![0.0f32; (w * h) as usize];
        // Sadece metal — void yok → n_shaft=0, fallback devreye girer
        stamp(&mut s, w, h, 0.5, 0.5, 0.08, 0.07, 0.66);
        let wall_cues = vec![];
        let through_red = false;
        let side = false;
        let (calib, void_blobs, metal_blobs) = prepare_blobs(&s, w, h, through_red, side);
        let legacy = run_legacy(
            &s, w, h, "top", through_red, "well", false, false, 0.35, &wall_cues, &calib, &void_blobs,
            &metal_blobs,
        );
        let vpe = run_vpe(
            &s, w, h, "top", through_red, "well", false, false, 0.35, &wall_cues, &calib, &void_blobs,
            &metal_blobs,
        );
        assert_pipeline_parity(&legacy, &vpe, side, 0, "well");
        let n_legacy_shaft = legacy.chambers.iter().filter(|c| c.kind == "shaft").count();
        assert!(
            n_legacy_shaft >= 1,
            "fallback şaft üretmeli, got {}",
            n_legacy_shaft
        );
    }

    /// Yan çekim + well: uzun dikey mavi sütun → şaft (aspect_y ≥ 1.25 || height_m ≥ 1.0).
    /// İki tarafta aynı konumda/derinlikte şaft üretilmeli.
    #[test]
    fn well_side_shaft_deterministic_parity() {
        let w = 48u32;
        let h = 24u32;
        let mut s = vec![0.0f32; (w * h) as usize];
        // Dikey uzamış mavi — yan çekimde dar sütun (rx küçük, ry büyük)
        stamp(&mut s, w, h, 0.5, 0.5, 0.035, 0.12, -0.62);
        let wall_cues = vec![];
        let through_red = false;
        let side = true;
        let (calib, void_blobs, metal_blobs) = prepare_blobs(&s, w, h, through_red, side);
        assert!(!void_blobs.is_empty(), "void blob oluşmalı");
        let legacy = run_legacy(
            &s, w, h, "side", through_red, "well", false, false, 0.35, &wall_cues, &calib, &void_blobs,
            &metal_blobs,
        );
        let vpe = run_vpe(
            &s, w, h, "side", through_red, "well", false, false, 0.35, &wall_cues, &calib, &void_blobs,
            &metal_blobs,
        );
        assert_pipeline_parity(&legacy, &vpe, side, 0, "well");
        assert!(
            legacy.chambers.iter().any(|c| c.kind == "shaft"),
            "yan şaft üretmeli, got {:?}",
            legacy.chambers.iter().map(|c| &c.kind).collect::<Vec<_>>()
        );
    }

    /// Dik çekim + well: kompakt dairesel mavi — well_like_plan forcing'i iki tarafta da
    /// şaft üretir (zorlama kapılardan ÖNCE koşar; rastgele süpürme zayıf adayların
    /// kurtarılma/reddedilme kararının da iki tarafta aynı olduğunu istatistiksel kapsar).
    #[test]
    fn well_pre_gate_force_deterministic_parity() {
        let w = 48u32;
        let h = 24u32;
        let mut s = vec![0.0f32; (w * h) as usize];
        // Kompakt (normalize rx=ry → bbox_aspect 1.0), belirgin intensity, min_area üstü
        stamp(&mut s, w, h, 0.5, 0.5, 0.06, 0.06, -0.56);
        let wall_cues = vec![];
        let through_red = false;
        let side = false;
        let (calib, void_blobs, metal_blobs) = prepare_blobs(&s, w, h, through_red, side);
        let legacy = run_legacy(
            &s, w, h, "top", through_red, "well", false, false, 0.35, &wall_cues, &calib, &void_blobs,
            &metal_blobs,
        );
        let vpe = run_vpe(
            &s, w, h, "top", through_red, "well", false, false, 0.35, &wall_cues, &calib, &void_blobs,
            &metal_blobs,
        );
        assert_pipeline_parity(&legacy, &vpe, side, 0, "well");
        assert!(
            legacy.chambers.iter().any(|c| c.kind == "shaft"),
            "kapı-öncesi zorlamayla şaft üretilmeli, got {:?}",
            legacy.chambers.iter().map(|c| &c.kind).collect::<Vec<_>>()
        );
    }

    /// Vakum koruması: yan çekim üretecinin x-çakışmalı + derinlik bandı çakışan chamber
    /// çiftleri ürettiğini doğrular (üreteç değişirse staged/yan süpürmeleri boş geçmesin).
    #[test]
    fn side_depth_band_overlaps_produced() {
        let mut rng = Rng(0xDE9_2026);
        let mut n_pairs_overlap = 0usize;
        for _ in 0..200u64 {
            let w = 48u32;
            let h = 24u32;
            let (signed, wall_cues) = random_field(&mut rng, w, h, true);
            let (calib, void_blobs, metal_blobs) = prepare_blobs(&signed, w, h, false, true);
            let legacy = run_legacy(
                &signed, w, h, "side", false, "auto", false, false, 0.35, &wall_cues, &calib,
                &void_blobs, &metal_blobs,
            );
            let ch: Vec<_> = legacy
                .chambers
                .iter()
                .filter(|c| c.tier == 0)
                .collect();
            for i in 0..ch.len() {
                for j in (i + 1)..ch.len() {
                    let a = ch[i];
                    let b = ch[j];
                    let x_overlap = (a.cx - b.cx).abs() < a.rx + b.rx;
                    let band_overlap = a.top_from_surface_m < b.bottom_from_surface_m
                        && b.top_from_surface_m < a.bottom_from_surface_m;
                    if x_overlap && band_overlap {
                        n_pairs_overlap += 1;
                    }
                }
            }
        }
        assert!(
            n_pairs_overlap > 0,
            "x-çakışmalı + derinlik bandı çakışan chamber çifti üretilmeli, got {n_pairs_overlap}"
        );
    }

    /// Metal + zayıf void çakışması: zayıf sinyalin merkezi metal tarafından örtülür,
    /// kenar halkası zayıf kalır. Tier-0'da metal yapısı, deep tier'da metal ayakizinin
    /// maskelemesi (veya halkanın yapıya dönüşmesi) iki tarafta aynı olmalı. Düzen
    /// kasıtlı: metalin yakınındaki güçlü void, çekime göre metalin tutunmasını (maske
    /// örter → tier yok) veya düşmesini (halka serbest → deep tier) değiştirir — iki
    /// sonuç da iki tarafta birebir.
    #[test]
    fn metal_over_weak_void_parity() {
        let w = 48u32;
        let h = 24u32;
        let mut n_deep = 0usize;
        let mut n_metal_retained = 0usize;
        for side in [false, true] {
            for through_red in [false, true] {
                let view = if side { "side" } else { "top" };
                let mut s = vec![0.0f32; (w * h) as usize];
                // Zayıf void (deep tier bandında) + merkezini örten güçlü metal
                stamp(&mut s, w, h, 0.5, 0.5, 0.11, 0.11, -0.24);
                stamp(&mut s, w, h, 0.5, 0.5, 0.06, 0.06, 0.62);
                // Metal'e komşu güçlü yapı — host/attach varyantı
                stamp(&mut s, w, h, 0.78, 0.5, 0.09, 0.09, -0.6);
                let wall_cues = vec![];
                let (calib, void_blobs, metal_blobs) =
                    prepare_blobs(&s, w, h, through_red, side);
                assert!(
                    !metal_blobs.is_empty(),
                    "metal blob oluşmalı side={side} through_red={through_red}"
                );
                for target in ["auto", "room", "tunnel", "site"] {
                    for staged in [false, true] {
                        let legacy = run_legacy(
                            &s, w, h, view, through_red, target, staged, false, 0.35, &wall_cues,
                            &calib, &void_blobs, &metal_blobs,
                        );
                        let vpe = run_vpe(
                            &s, w, h, view, through_red, target, staged, false, 0.35, &wall_cues,
                            &calib, &void_blobs, &metal_blobs,
                        );
                        assert_pipeline_parity(&legacy, &vpe, side, 0, target);
                        n_deep += legacy.chambers.iter().filter(|c| c.tier > 0).count()
                            + legacy.tunnels.iter().filter(|t| t.tier > 0).count();
                        n_metal_retained += legacy.metals.len();
                    }
                }
            }
        }
        // Vakum koruması: hem maskeleme (metal tutundu) hem maske-dışı (deep tier) yolları
        // en az bir konfigürasyonda gerçekten çalışmalı
        assert!(n_metal_retained > 0, "metal tutunmalı (maskeleme yolu), got {n_metal_retained}");
        assert!(n_deep > 0, "deep tier üretilmeli (maske-dışı yol), got {n_deep}");
    }

    /// wall_ring_support_with_clarity: net duvar ile bulanık duvar ayrımı.
    /// - Net duvar (clarity ≥ 0.6): güçlü boost, belirsiz etiketi yok
    /// - Bulanık duvar (clarity < 0.3): boost yok, 'uncertain:blurry_walls' etiketi
    #[test]
    fn wall_clarity_distinguishes_clear_vs_blurry() {
        use crate::preprocess::WallCue;
        use super::types_local::Blob;
        let mut b = Blob::default();
        b.cx = 0.5;
        b.cy = 0.5;
        b.rx = 0.06;
        b.ry = 0.06;

        // Net duvarlar: strength=0.8, her noktada duvar var
        let mut clear_walls = Vec::new();
        for i in 0..48 {
            let ang = std::f32::consts::TAU * i as f32 / 48.0;
            clear_walls.push(WallCue {
                x: 0.5 + 0.08 * ang.cos(),
                y: 0.5 + 0.08 * ang.sin(),
                strength: 0.8,
                near_void: false,
                green_line: false,
            });
        }
        let (sup_clear, clr_clear) = wall_ring_support_with_clarity(&b, &clear_walls);
        assert!(sup_clear >= 0.3, "net duvar desteği yüksek olmalı: {sup_clear}");
        assert!(clr_clear >= 0.6, "net duvar netliği yüksek olmalı: {clr_clear}");

        // Bulanık duvarlar: strength=0.3, sadece bazı noktalarda
        let mut blurry_walls = Vec::new();
        for i in 0..48 {
            if i % 3 != 0 { continue; } // sadece her 3. noktada
            let ang = std::f32::consts::TAU * i as f32 / 48.0;
            blurry_walls.push(WallCue {
                x: 0.5 + 0.08 * ang.cos(),
                y: 0.5 + 0.08 * ang.sin(),
                strength: 0.3,
                near_void: false,
                green_line: false,
            });
        }
        let (sup_blurry, clr_blurry) = wall_ring_support_with_clarity(&b, &blurry_walls);
        assert!(sup_blurry < sup_clear, "bulanık duvar desteği daha düşük olmalı");
        assert!(clr_blurry < 0.3, "bulanık duvar netliği düşük olmalı: {clr_blurry}");
    }
}
