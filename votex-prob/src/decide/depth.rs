//! L4 derinlik / emergence — legacy `build::build_chamber` derinlik formülleriyle
//! bit düzeyinde aynı (pipeline parite testi geometri meta verisini karşılaştırır).

use crate::schema::BlobDto;

const MIN_COVER_M: f32 = 0.28;

/// (cover, floor, emergence)
/// `structure_cue` legacy chamber cue'sudur: `wall_s.max(line_s).max(path_s*0.5)`
/// (tüneller için path dahil) — build_chamber'ın `evidence.wall_support.max(
/// evidence.path_support*0.5)` karşılığı.
pub fn estimate_depth(
    b: &BlobDto,
    side: bool,
    depth_range_m: f32,
    structure_cue: f32,
    class: &str,
    map_w_m: f32,
    map_d_m: f32,
) -> (f32, f32, f32) {
    let e = emergence_with_cue(b.intensity, b.fill_ratio, structure_cue);
    if side {
        // Legacy build::side_cover_floor_cued ile birebir
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
        let span_n = (b.ry * 2.0).clamp(0.05, 0.75);
        let h_avail = ((depth_range_m - top) * 0.9).max(1.0);
        let h_lo = 1.1f32.min(h_avail);
        let h_hi = h_avail.min(5.0).max(h_lo);
        let height = (span_n * depth_range_m * 0.48).clamp(h_lo, h_hi);
        let bottom = (top + height).min(depth_range_m.max(top + height));
        (top, bottom.max(top + h_lo), e)
    } else {
        // Legacy build_chamber dik dalı: ayakizi (PCA) → span → kind yüksekliği →
        // deep_cap → gömü; şaft kendi WELL_TYPICAL_M=7.5 dalına gider.
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
        if class == "shaft" {
            // Legacy build_chamber kuyu dalı (dik): ağız haritada, gövde ~7.5 m iner.
            const WELL_TYPICAL_M: f32 = 7.5;
            let well_cap = max_depth.max(WELL_TYPICAL_M + 1.0);
            let d = diam.clamp(0.5, 5.0);
            // Legacy build_chamber well path: footprint > 2.8 → d*0.28
            let _d = if d > 2.8 { (d * 0.28).clamp(0.8, 2.8) } else { d };
            let cover = (0.05 + (1.0 - b.intensity) * 0.14).clamp(0.04, 0.28);
            let strength = (b.intensity * 0.7 + b.fill_ratio * 0.3).clamp(0.0, 1.0);
            let bottom = (WELL_TYPICAL_M - (1.0 - strength) * 2.0).clamp(cover + 5.5, well_cap);
            let h = (bottom - cover).clamp(5.5, well_cap - cover);
            let bottom = (cover + h).min(well_cap);
            (cover, bottom, e)
        } else {
            let span = diam.max(0.6);
            let height_m = match class {
                "tomb" => (span * 0.48).clamp(1.4, 3.2),
                _ => (span * 0.45).clamp(1.2, 3.0),
            };
            let deep_cap = (max_depth * (0.22 + (1.0 - e).powf(1.4) * 0.28))
                .max(0.5)
                .min((max_depth - height_m).max(0.4));
            let cover = burial_from_emergence(e, MIN_COVER_M, deep_cap)
                .clamp(MIN_COVER_M, (max_depth - height_m).max(0.75));
            let bottom = (cover + height_m).min(max_depth);
            (cover, bottom, e)
        }
    }
}

fn surface_emergence(intensity: f32, fill: f32) -> f32 {
    (intensity * 0.74 + fill * 0.26).clamp(0.0, 1.0).powf(0.95)
}

fn emergence_with_cue(intensity: f32, fill: f32, structure_cue: f32) -> f32 {
    let base = surface_emergence(intensity, fill);
    (base + structure_cue.clamp(0.0, 1.0) * 0.2).clamp(0.0, 1.0)
}

fn burial_from_emergence(emergence: f32, shallow: f32, deep: f32) -> f32 {
    let e = emergence.clamp(0.0, 1.0);
    let depth_frac = (1.0 - e).powf(1.4);
    (shallow + depth_frac * (deep - shallow)).clamp(shallow.min(deep), deep.max(shallow))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::BlobDto;

    fn dto(rx: f32, ry: f32, intensity: f32, fill: f32, axis_aspect: f32, half_len: f32) -> BlobDto {
        BlobDto {
            id: "v0".into(),
            cx: 0.5,
            cy: 0.35,
            rx,
            ry,
            intensity,
            fill_ratio: fill,
            axis_aspect,
            half_len,
            ..Default::default()
        }
    }

    /// Dik: PCA genişlemesi (axis_aspect >= 1.2) span'ı büyütür → height artar.
    /// f32 çıkarması (floor - cover) gürültü ürettiği için iki konfigürasyon
    /// karşılaştırılarak doğrulanır (mutlak 1.2 eşiği float-noise'a takılır).
    #[test]
    fn top_depth_uses_pca_span() {
        let b_pca = dto(0.03, 0.02, 0.6, 0.5, 2.4, 0.25);
        let b_plain = dto(0.03, 0.02, 0.6, 0.5, 1.0, 0.05);
        let (c_pca, f_pca, _) = estimate_depth(&b_pca, false, 10.0, 0.1, "room", 24.0, 10.0);
        let (c_plain, f_plain, _) = estimate_depth(&b_plain, false, 10.0, 0.1, "room", 24.0, 10.0);
        let h_pca = f_pca - c_pca;
        let h_plain = f_plain - c_plain;
        // PCA span 3.54 → height 1.59; düz ayakiz span 0.6 → 1.2 (clamp altı)
        assert!(
            h_pca > h_plain + 0.2,
            "PCA span height'ı büyütmeli: plain={h_plain} pca={h_pca}"
        );
        assert!(h_pca < 3.0, "room height span tabanlı, got {h_pca}");
        assert!(c_pca >= 0.28, "cover min 0.28, got {c_pca}");
    }

    /// Dik: mezar yüksekliği odadan büyük (tomb 0.48 vs room 0.45 çarpanı).
    #[test]
    fn top_tomb_taller_than_room() {
        let b = dto(0.03, 0.02, 0.6, 0.5, 1.0, 0.05);
        let (_, f_room, _) = estimate_depth(&b, false, 10.0, 0.1, "room", 24.0, 10.0);
        let (_, f_tomb, _) = estimate_depth(&b, false, 10.0, 0.1, "tomb", 24.0, 10.0);
        assert!(f_tomb - f_room > 0.0, "tomb daha uzun: room={f_room} tomb={f_tomb}");
    }

    /// Yan: güçlü cue yüzeye yakınlaştırır (emergence yükselir → cover düşer).
    #[test]
    fn side_cue_reduces_cover() {
        let b = dto(0.04, 0.03, 0.4, 0.4, 1.0, 0.04);
        let (c0, _, _) = estimate_depth(&b, true, 10.0, 0.0, "room", 24.0, 10.0);
        let (c1, _, _) = estimate_depth(&b, true, 10.0, 0.8, "room", 24.0, 10.0);
        assert!(c1 < c0, "cue cover'ı düşürmeli: c0={c0} c1={c1}");
    }
}
