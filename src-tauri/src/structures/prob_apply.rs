//! VOTEX → VPE kanıt paketi + karar uygulama (Faz B).

use std::collections::HashMap;

use crate::app_settings::load_settings;
use crate::preprocess::WallCue;
use crate::prob_client::{
    self, BlobDto, DecisionBatch, EvidenceBatch, PairPath, VoidDecision, SCHEMA_VERSION,
};
use crate::structures::cues::{green_line_tunnel_support, near_metal_blob, wall_ring_support};
use crate::structures::path::{
    path_corridor_support, path_structure_support, path_void_support, tunnel_path_endpoints,
};
use crate::structures::types_local::{Blob, FieldCalib, VoidClass};
use crate::surface::{Evidence, Tunnel};

/// VPE zorunlu mod (yedek kapalı) kuralı: motor yoksa analiz engellenir.
/// Yedek açıkken motor yokluğu engel değildir (legacy devam eder).
fn enforce_vpe_required(fallback_enabled: bool, engine_online: bool) -> Result<(), String> {
    if !fallback_enabled && !engine_online {
        return Err(
            "VPE hesap motoru çevrimdışı ve yerel yedek (legacy) kapalı — analiz için VPE gerekiyor"
                .into(),
        );
    }
    Ok(())
}

/// Blob listesinden EvidenceBatch üret ve VPE decide çağır.
/// `through_red` (kırmızı yapıyı engellemesin) skor eşiklerini gevşetir —
/// legacy `classify`'daki dallarla birebir hizalıdır.
/// Ok(Some) → VPE kararı; Ok(None) → legacy devam (yedek açık);
/// Err → VPE zorunlu modda (yedek kapalı) analiz engeli.
pub fn try_vpe_decide(
    void_blobs: &[Blob],
    metal_blobs: &[Blob],
    signed: &[f32],
    w: u32,
    h: u32,
    calib: &FieldCalib,
    wall_cues: &[WallCue],
    map_width_m: f32,
    map_depth_m: f32,
    depth_range_m: f32,
    view_mode: &str,
    target_kind: &str,
    min_confidence: f32,
    through_red: bool,
    deep: bool,
) -> Result<Option<DecisionBatch>, String> {
    let s = load_settings();
    // Yedek kapalıysa VPE zorunlu: motor çevrimdışıysa analizi gerçekten engelle
    enforce_vpe_required(s.prob_fallback, prob_client::health().is_ok())?;
    let batch = build_evidence_batch(
        void_blobs,
        metal_blobs,
        signed,
        w,
        h,
        calib,
        wall_cues,
        map_width_m,
        map_depth_m,
        depth_range_m,
        view_mode,
        target_kind,
        min_confidence,
        through_red,
        deep,
    );

    match prob_client::decide(&batch) {
        Ok(dec) if !dec.stub => Ok(Some(dec)),
        Ok(dec) => {
            // Stub: motor çalışıyor ama karar veremiyor — yedek kapalıysa bu da engel
            if !s.prob_fallback {
                return Err(format!(
                    "VPE motoru karar veremiyor (stub: {}) ve yerel yedek kapalı",
                    dec.message
                ));
            }
            eprintln!("[votex] VPE stub yanıt — legacy: {}", dec.message);
            Ok(None)
        }
        Err(e) => {
            if !s.prob_fallback {
                Err(format!("VPE decide hatası ve yerel yedek kapalı: {e}"))
            } else {
                eprintln!("[votex] VPE decide fail — legacy yedek: {e}");
                Ok(None)
            }
        }
    }
}

/// Blob listesinden VPE'ye gönderilen kanıt paketini üret. `try_vpe_decide` bunu ağa
/// gönderir; pipeline parite testleri aynı paketi in-process `votex_prob::decide` ile
/// çalıştırır (tel protokolü birebir: serde_json round-trip).
pub fn build_evidence_batch(
    void_blobs: &[Blob],
    metal_blobs: &[Blob],
    signed: &[f32],
    w: u32,
    h: u32,
    calib: &FieldCalib,
    wall_cues: &[WallCue],
    map_width_m: f32,
    map_depth_m: f32,
    depth_range_m: f32,
    view_mode: &str,
    target_kind: &str,
    min_confidence: f32,
    through_red: bool,
    deep: bool,
) -> EvidenceBatch {
    let s = load_settings();
    let side = view_mode.eq_ignore_ascii_case("side");
    let mut void_dtos = Vec::new();
    for (i, b) in void_blobs.iter().enumerate() {
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
        let wall_s = wall_ring_support(b, wall_cues);
        let line_s = green_line_tunnel_support(b, wall_cues);
        let near_red = near_metal_blob(b, metal_blobs);
        let aspect = b
            .axis_aspect
            .max((b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3)));
        let snr = b.intensity / calib.noise_std.max(0.04);
        void_dtos.push(BlobDto {
            id: format!("v{i}"),
            cx: b.cx,
            cy: b.cy,
            rx: b.rx,
            ry: b.ry,
            intensity: b.intensity,
            fill_ratio: b.fill_ratio,
            aspect,
            path_s,
            wall_s,
            line_s,
            near_red,
            snr,
            axis_aspect: b.axis_aspect,
            half_len: b.half_len,
        });
    }
    let mut metal_dtos = Vec::new();
    for (i, b) in metal_blobs.iter().enumerate() {
        let aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
        metal_dtos.push(BlobDto {
            id: format!("m{i}"),
            cx: b.cx,
            cy: b.cy,
            rx: b.rx,
            ry: b.ry,
            intensity: b.intensity,
            fill_ratio: b.fill_ratio,
            aspect,
            path_s: 0.0,
            wall_s: 0.0,
            line_s: 0.0,
            near_red: false,
            snr: b.intensity / calib.noise_std.max(0.04),
            axis_aspect: b.axis_aspect,
            half_len: b.half_len,
        });
    }

    // Geçici oda çift path'leri: tüm void çiftleri (VPE link odaları seçince kullanır)
    let mut pair_paths = Vec::new();
    for i in 0..void_dtos.len() {
        for j in (i + 1)..void_dtos.len() {
            let a = &void_dtos[i];
            let b = &void_dtos[j];
            let path = if side || through_red {
                path_corridor_support(signed, w, h, a.cx, a.cy, b.cx, b.cy, calib.void_thr)
            } else {
                path_void_support(signed, w, h, a.cx, a.cy, b.cx, b.cy, calib.void_thr)
            };
            pair_paths.push(PairPath {
                a_id: a.id.clone(),
                b_id: b.id.clone(),
                path_s: path,
            });
        }
    }

    EvidenceBatch {
        schema_version: SCHEMA_VERSION.into(),
        view_mode: if side { "side".into() } else { "top".into() },
        target: target_kind.into(),
        policy_id: Some(s.prob_profile.clone()),
        depth_range_m,
        map_width_m,
        map_depth_m,
        min_confidence,
        through_red,
        deep,
        void_blobs: void_dtos,
        metal_blobs: metal_dtos,
        pair_paths,
    }
}

pub fn void_decision_map(dec: &DecisionBatch) -> HashMap<String, VoidDecision> {
    dec.voids
        .iter()
        .map(|v| (v.id.clone(), v.clone()))
        .collect()
}

pub fn class_from_vpe(name: &str) -> Option<VoidClass> {
    match name {
        "room" => Some(VoidClass::Room),
        "tomb" => Some(VoidClass::Tomb),
        "tunnel" => Some(VoidClass::Tunnel),
        "shaft" => Some(VoidClass::Shaft),
        "noise" => Some(VoidClass::Noise),
        _ => None,
    }
}

/// VPE link kararlarından Tunnel DTO üret (oda cx/cy/depth map ile).
pub fn tunnels_from_vpe_links(
    dec: &DecisionBatch,
    id_to_blob: &HashMap<String, &Blob>,
    depth_of: &HashMap<String, (f32, f32, f32)>, // cover, floor, height
    depth_range_m: f32,
    side: bool,
) -> Vec<Tunnel> {
    let mut out = Vec::new();
    for link in &dec.links {
        let Some(a) = id_to_blob.get(&link.a_id) else {
            continue;
        };
        let Some(b) = id_to_blob.get(&link.b_id) else {
            continue;
        };
        let (ca, fa, _) = depth_of
            .get(&link.a_id)
            .copied()
            .unwrap_or((0.4, 2.4, 2.0));
        let (cb, fb, _) = depth_of
            .get(&link.b_id)
            .copied()
            .unwrap_or((0.4, 2.4, 2.0));
        let floor = fa.max(fb).clamp(0.5, depth_range_m);
        let cover = ((ca + cb) * 0.5).min(floor - 0.7).clamp(0.05, floor - 0.7);
        let height_m = (floor - cover).clamp(0.7, 4.2);
        let width_m = ((a.rx.min(b.rx)) * 2.0 * 24.0 * 0.55).clamp(0.55, 2.2);
        let mut geom = crate::surface::GeometryAnalysis::default();
        geom.method = link.method.clone();
        geom.label = format!("VPE · {}", link.method);
        out.push(Tunnel {
            x0: a.cx,
            y0: a.cy,
            x1: b.cx,
            y1: b.cy,
            radius: 0.025,
            depth: ((cover + height_m * 0.5) / depth_range_m).clamp(0.05, 0.95),
            bearing_deg: 0.0,
            direction: String::new(),
            heading: String::new(),
            width_m,
            floor_from_surface_m: floor,
            crown_from_surface_m: cover,
            height_m,
            confidence: link.conf,
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence {
                snr: 1.0,
                path_support: link.conf,
                class_margin: 0.1,
                wall_support: if side { 0.35 } else { 0.0 },
                reasons: vec![
                    format!("vpe:{}", link.method),
                    format!("conf:{:.0}%", link.conf * 100.0),
                ],
            },
            geometry: geom,
            outline: Vec::new(),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::enforce_vpe_required;

    #[test]
    fn vpe_required_blocks_when_engine_offline() {
        // Yedek kapalı + motor yok → analiz engellenir
        assert!(enforce_vpe_required(false, false).is_err());
    }

    #[test]
    fn vpe_required_allows_when_engine_online() {
        // Yedek kapalı ama motor çalışıyor → analiz devam eder (VPE kullanılır)
        assert!(enforce_vpe_required(false, true).is_ok());
    }

    #[test]
    fn fallback_allows_legacy_when_engine_offline() {
        // Yedek açık + motor yok → legacy devam (engel yok)
        assert!(enforce_vpe_required(true, false).is_ok());
        assert!(enforce_vpe_required(true, true).is_ok());
    }
}
