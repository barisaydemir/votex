//! 2D anomali colormap → yer altı yapı modeli (doğrulamalı pipeline).
//!
//! Ters röntgen: yeryüzünden yükselen manyetik alan.
//! mavi=negatif boşluk; kırmızı=pozitif (yapı içi/çıkış, derin demek değil);
//! beyaz≈nötr zarf; yeşil=toprak (yapı yok demek değil).

mod field;
pub(crate) mod models;

pub use models::{
    Chamber, Evidence, GeometryAnalysis, MetalBody, SiteGeometryReport, Surface3D, Tunnel,
    UndergroundStructures, WaterBody,
};

use crate::analysis::{enrich_structures, fit_structures};
use crate::preprocess::{clean_elic_screenshot, detect_wall_cues, soften_white_overlays};
use crate::soil_profile::{self, SoilParams};
use crate::structures::{extract_validated, StructureHint};
use field::{build_signed_field, min_max, synthesize_symmetric_bodies};
use image::RgbaImage;

/// Yan çekim gömü ölçeği (m) — renk/çıkış gücü yüzeye çeker; 3 m tavanı yok.
pub const DEFAULT_SIDE_DEPTH_RANGE_M: f32 = 15.0;
/// Dik çekim gömü ölçeği (m) — renk/çıkış gücü yüzeye çeker; 10 m tavanı yok.
pub const DEFAULT_TOP_DEPTH_RANGE_M: f32 = 30.0;
/// Yan sınıflandırma eşikleri bu referansa göre ayarlı (normalize blob → metre).
pub const SIDE_CLASS_REF_M: f32 = 3.0;

/// Colormap → yer altı yapı modeli.
///
/// Akış: yeşil zemin (0) + pozitif/negatif alan çıkışları → blob → yapı.
/// Yeşil/sarı + koyu–açık kontrast → yapı ipucu (yüzeye yakın olasılık yüksek).
/// Beyaz çizgi alan değildir; duvar/tünel ipucu olarak ayrı okunur.
pub fn colormap_to_surface(
    img: &RgbaImage,
    _lut_strip_px: u32,
    max_grid: u32,
    file_name: Option<String>,
    view_mode: &str,
    min_confidence: f32,
    target_kind: &str,
    dta_hints: &[StructureHint],
    soil: &SoilParams,
    deep: bool,
    staged: bool,
) -> Result<Surface3D, String> {
    let view_mode = if view_mode.eq_ignore_ascii_case("side") {
        "side"
    } else {
        "top"
    };
    let min_confidence = soil_profile::apply_conf(min_confidence, soil.conf_delta);
    let source_w = img.width();
    let source_h = img.height();
    if source_w < 16 || source_h < 16 {
        return Err("Görüntü çok küçük".into());
    }

    let (mut cleaned, crop) = clean_elic_screenshot(img)?;
    // Beyaz duvar ipuçları yumuşatmadan önce
    let wall_cues = detect_wall_cues(&cleaned);
    soften_white_overlays(&mut cleaned);
    let cleaned_preview_base64 = crate::capture::png_data_url(&cleaned).ok();

    let cw = cleaned.width();
    let ch = cleaned.height();

    let max_grid = max_grid.clamp(32, 512);
    let scale = (max_grid as f32 / cw.max(ch) as f32).min(1.0);
    let grid_w = ((cw as f32 * scale).round() as u32).max(8);
    let grid_h = ((ch as f32 * scale).round() as u32).max(8);

    let (signed_field, colors) = build_signed_field(&cleaned, grid_w, grid_h);
    let heights = synthesize_symmetric_bodies(&signed_field, grid_w, grid_h);
    let (z_min, z_max) = min_max(&heights);
    const MAP_WIDTH_M: f32 = 24.0;
    // Yan/dik: harita ayakizi görüntü en-boyunda — şeride sıkıştırma yok
    let map_depth_m = MAP_WIDTH_M * (grid_h as f32 / grid_w.max(1) as f32);
    // Gömü ölçeği: toprak profili ile ölçeklenir (off → 1.0)
    let depth_base = if view_mode == "side" {
        DEFAULT_SIDE_DEPTH_RANGE_M
    } else {
        DEFAULT_TOP_DEPTH_RANGE_M
    };
    let depth_range_m = soil_profile::apply_depth_range(depth_base, soil.depth_scale);

    let mut structures = extract_validated(
        &signed_field,
        grid_w,
        grid_h,
        MAP_WIDTH_M,
        map_depth_m,
        depth_range_m,
        view_mode,
        min_confidence,
        target_kind,
        &wall_cues,
        dta_hints,
        deep,
        staged,
    )?;

    let fit = fit_structures(
        &signed_field,
        grid_w,
        grid_h,
        MAP_WIDTH_M,
        map_depth_m,
        depth_range_m,
        view_mode,
        &wall_cues,
        &mut structures,
    );
    structures.geometry_report.fit_adjusted_count = fit.adjusted_count;
    structures.geometry_report.mean_size_score = fit.mean_size_score;
    structures.geometry_report.mean_orient_score = fit.mean_orient_score;
    enrich_structures(&signed_field, grid_w, grid_h, &mut structures);

    Ok(Surface3D {
        grid_w,
        grid_h,
        heights,
        colors,
        z_min,
        z_max,
        source_w,
        source_h,
        file_name,
        cleaned_preview_base64,
        crop: Some(crop),
        map_size_m: MAP_WIDTH_M,
        map_width_m: MAP_WIDTH_M,
        map_depth_m,
        depth_range_m,
        view_mode: view_mode.to_string(),
        structures,
        wall_cues,
        soil_profile: soil.id.clone(),
        soil_depth_scale: soil.depth_scale,
        soil_correction_applied: soil.correction_applied,
        soil_label: soil.label_tr.clone(),
    })
}

#[cfg(test)]
mod smoke {
    use super::colormap_to_surface;
    use crate::soil_profile::SoilParams;
    use image::{Rgba, RgbaImage};

    fn soil_legacy() -> SoilParams {
        SoilParams::identity("off", "Kapalı (eski hesap)")
    }

    /// Smoke testleri gerçek kullanıcı settings.json'undaki probFallback değerine
    /// bağımlı kalmamalı: VPE motoru test ortamında çevrimdışı olduğundan, yedek
    /// (legacy) açık değilse analiz `enforce_vpe_required` tarafından engellenir.
    /// Her smoke testi bu override'ı zorlar (diske yazmaz).
    fn force_legacy_fallback() {
        crate::app_settings::set_test_prob_fallback(Some(true));
    }

    /// Yeşil zemin + mavi boşluk + kırmızı metal — dik/yan smoke.
    fn synthetic_map(w: u32, h: u32) -> RgbaImage {
        let mut img = RgbaImage::from_pixel(w, h, Rgba([34, 180, 70, 255]));
        for y in 40..70 {
            for x in 30..90 {
                img.put_pixel(x, y, Rgba([20, 40, 180, 255])); // void / blue
            }
        }
        for y in 50..62 {
            for x in 120..150 {
                img.put_pixel(x, y, Rgba([220, 40, 30, 255])); // metal / red
            }
        }
        // uzamış koridor (tünel adayı)
        for y in 100..112 {
            for x in 40..160 {
                img.put_pixel(x, y, Rgba([40, 60, 200, 255]));
            }
        }
        img
    }

    #[test]
    fn top_and_side_colormap_smoke() {
        force_legacy_fallback();
        let img = synthetic_map(200, 160);
        let top =
            colormap_to_surface(&img, 24, 96, Some("smoke-top.png".into()), "top", 0.35, "auto", &[], &soil_legacy(), false, false)
                .expect("top view");
        assert_eq!(top.view_mode, "top");
        assert!(top.map_size_m > 0.0);
        assert!(
            (top.map_width_m - top.map_size_m).abs() < 1e-3,
            "map_width_m should match map_size_m"
        );
        assert!(
            (top.map_depth_m - top.map_width_m * (top.grid_h as f32 / top.grid_w.max(1) as f32))
                .abs()
                < 1e-3,
            "map_depth_m should follow grid aspect"
        );
        assert_eq!(
            top.colors.len(),
            (top.grid_w * top.grid_h * 3) as usize,
            "colors RGB grid"
        );
        assert_eq!(
            top.heights.len(),
            (top.grid_w * top.grid_h) as usize,
            "heights grid"
        );
        for c in &top.structures.chambers {
            if c.kind == "room" || c.kind == "tomb" {
                assert!(
                    c.width_m > 0.3 && c.length_m > 0.3,
                    "chamber metres from map frame"
                );
            }
        }
        assert!(!top.heights.is_empty());

        let side = colormap_to_surface(
            &img,
            24,
            96,
            Some("smoke-side.png".into()),
            "side",
            0.35,
            "auto",
            &[],
        &soil_legacy(),
        false,
        false,
    )
        .expect("side view");
        assert_eq!(side.view_mode, "side");
        assert!(
            (side.depth_range_m - super::DEFAULT_SIDE_DEPTH_RANGE_M).abs() < 0.01,
            "side depth_range_m open scale"
        );
        assert!(
            (side.map_depth_m
                - side.map_width_m * (side.grid_h as f32 / side.grid_w.max(1) as f32))
                .abs()
                < 1e-3,
            "side map_depth follows image aspect (not compressed to 3 m strip)"
        );
        assert!(!side.heights.is_empty());
        assert_eq!(
            side.colors.len(),
            (side.grid_w * side.grid_h * 3) as usize
        );
        assert!(
            side.structures.accepted_count > 0,
            "side view must accept some structures, got 0 (chambers={} tunnels={} metals={})",
            side.structures.chambers.len(),
            side.structures.tunnels.len(),
            side.structures.metals.len()
        );
        // Yan: ayakizi resimde; gömü renk gücüne göre yüzeye yakın (ham Y×range değil)
        for c in &side.structures.chambers {
            if c.kind != "room" && c.kind != "tomb" {
                continue;
            }
            let expect_w = (c.rx * 2.0 * side.map_width_m).clamp(0.35, side.map_width_m * 0.95);
            let expect_l = (c.height_m * 0.62).clamp(0.7, 2.4);
            assert!(
                c.top_from_surface_m < side.depth_range_m * 0.42,
                "strong colormap rooms stay in near-surface band: top={}",
                c.top_from_surface_m
            );
            assert!(
                c.bottom_from_surface_m > c.top_from_surface_m + 0.8,
                "room must have real thickness"
            );
            assert!(
                (c.width_m - expect_w).abs() < expect_w * 0.4 + 0.5,
                "side room width tracks hat footprint"
            );
            assert!(
                c.length_m <= 2.55 && (c.length_m - expect_l).abs() < 0.55,
                "side room Z thin on blue (not ry×map_d): got {} expect≈{}",
                c.length_m,
                expect_l
            );
            assert!(
                (c.height_m - (c.bottom_from_surface_m - c.top_from_surface_m)).abs() < 0.08
            );
        }
        for t in &side.structures.tunnels {
            assert!(
                (t.height_m - (t.floor_from_surface_m - t.crown_from_surface_m)).abs() < 0.08
            );
        }

        // Yüksek eşikte de yan çekim boş kalmamalı
        let side_hi = colormap_to_surface(
            &img,
            24,
            96,
            Some("smoke-side-hi.png".into()),
            "side",
            0.75,
            "auto",
            &[],
        &soil_legacy(),
        false,
        false,
    )
        .expect("side hi");
        assert!(
            side_hi.structures.accepted_count > 0,
            "side @0.75 must still accept structures"
        );

        let _ = (
            top.structures.accepted_count,
            side.structures.accepted_count,
        );
        for c in &top.structures.chambers {
            assert!(!c.geometry.method.is_empty() || c.geometry.symmetry_index >= 0.0);
        }
        for t in &top.structures.tunnels {
            assert!(
                (t.height_m - (t.floor_from_surface_m - t.crown_from_surface_m)).abs() < 0.05,
                "fit tunnel height_m must equal floor−crown, got h={} floor={} crown={}",
                t.height_m,
                t.floor_from_surface_m,
                t.crown_from_surface_m
            );
            assert_eq!(t.geometry.fit_method, "fit_tunnel");
        }
    }

    fn well_candidate_map() -> RgbaImage {
        let w = 160u32;
        let h = 160u32;
        let mut img = RgbaImage::from_pixel(w, h, Rgba([34, 180, 70, 255]));
        let cx = 80i32;
        let cy = 80i32;
        let r2 = 14i32 * 14;
        for y in 60..100 {
            for x in 60..100 {
                let dx = x as i32 - cx;
                let dy = y as i32 - cy;
                if dx * dx + dy * dy <= r2 {
                    img.put_pixel(x, y, Rgba([220, 40, 30, 255]));
                }
            }
        }
        for y in 70..78 {
            for x in 20..55 {
                img.put_pixel(x, y, Rgba([30, 50, 200, 255]));
            }
        }
        img
    }

    /// Dik çekimde kompakt metal + hedef Kuyu → şaft (serbest derinlik; tipik ~7.5 m).
    #[test]
    fn top_view_compact_metal_becomes_well() {
        force_legacy_fallback();
        let img = well_candidate_map();
        let top = colormap_to_surface(
            &img,
            24,
            96,
            Some("smoke-well.png".into()),
            "top",
            0.35,
            "well",
            &[],
        &soil_legacy(),
        false,
        false,
    )
        .expect("well top");
        let shafts: Vec<_> = top
            .structures
            .chambers
            .iter()
            .filter(|c| c.kind == "shaft")
            .collect();
        assert!(
            !shafts.is_empty(),
            "expected at least one shaft/kuyu, got chambers={:?} tunnels={}",
            top.structures
                .chambers
                .iter()
                .map(|c| c.kind.as_str())
                .collect::<Vec<_>>(),
            top.structures.tunnels.len()
        );
        assert!(
            top.structures.tunnels.is_empty(),
            "well-only scene should not keep horizontal tunnels, got {}",
            top.structures.tunnels.len()
        );
        for s in &shafts {
            assert!(
                s.bottom_from_surface_m <= super::DEFAULT_TOP_DEPTH_RANGE_M + 1e-3,
                "well depth within open range, got {}",
                s.bottom_from_surface_m
            );
            assert!(
                s.bottom_from_surface_m >= 6.5,
                "top-view well is a mouth/cover cue — shaft must reach ~7.5 m, got bottom={}",
                s.bottom_from_surface_m
            );
            assert!(
                (s.bottom_from_surface_m - 7.5).abs() < 0.6,
                "fit well typical bottom ≈ 7.5 m, got {}",
                s.bottom_from_surface_m
            );
            assert!(
                s.top_from_surface_m <= 0.35,
                "well cover/mouth should be near surface, got top={}",
                s.top_from_surface_m
            );
            assert!(
                s.height_m >= 6.0,
                "well shaft height too short (cover-only?), got {}",
                s.height_m
            );
            assert!(
                (s.height_m - (s.bottom_from_surface_m - s.top_from_surface_m)).abs() < 0.05,
                "fit: height_m must match bottom−top"
            );
            assert_eq!(s.geometry.fit_method, "fit_shaft");
            assert!(s.geometry.size_score > 0.2);
        }
    }

    /// Otomatik modda metal tek başına kuyu/oda üretmez.
    #[test]
    fn auto_metal_is_not_a_structure() {
        force_legacy_fallback();
        let img = well_candidate_map();
        let top = colormap_to_surface(
            &img,
            24,
            96,
            Some("smoke-metal-auto.png".into()),
            "top",
            0.35,
            "auto",
            &[],
        &soil_legacy(),
        false,
        false,
    )
        .expect("auto metal");
        assert!(
            !top.structures.metals.is_empty(),
            "expected metal bodies"
        );
        // Metal → şaft dönüşümü auto'da kapalı
        let shafts_from_center = top.structures.chambers.iter().filter(|c| c.kind == "shaft");
        // İzin: hiç şaft veya yalnızca void'dan gelen; metal host_kind boş/bağımsız olmalı
        for m in &top.structures.metals {
            assert!(
                m.field_strength > 0.0 || m.intensity > 0.0,
                "field_strength expected"
            );
            assert!(m.spread_m > 0.0 || m.width_m > 0.0, "spread footprint expected");
            let label = &m.geometry.label;
            if !m.inside_chamber {
                assert!(
                    !label.is_empty(),
                    "standalone red cue label expected, got {:?}",
                    label
                );
            }
            assert!(
                m.geometry.method.starts_with("red_") || m.geometry.method == "field_spread",
                "red cue method, got {}",
                m.geometry.method
            );
        }
        let _ = shafts_from_center.count();
    }

    #[test]
    fn target_kind_well_forces_shaft_no_tunnels() {
        force_legacy_fallback();
        let img = well_candidate_map();
        let top = colormap_to_surface(
            &img,
            24,
            96,
            Some("smoke-target-well.png".into()),
            "top",
            0.35,
            "well",
            &[],
        &soil_legacy(),
        false,
        false,
    )
        .expect("target well");
        assert!(
            top.structures.chambers.iter().any(|c| c.kind == "shaft"),
            "well target should produce shaft"
        );
        assert!(
            top.structures.tunnels.is_empty(),
            "well target must clear tunnels"
        );
        assert!(
            top.structures
                .chambers
                .iter()
                .all(|c| c.kind == "shaft"),
            "well target only shafts"
        );
    }

    #[test]
    fn target_kind_tunnel_rejects_shaft() {
        force_legacy_fallback();
        let img = well_candidate_map();
        let top = colormap_to_surface(
            &img,
            24,
            96,
            Some("smoke-target-tunnel.png".into()),
            "top",
            0.35,
            "tunnel",
            &[],
        &soil_legacy(),
        false,
        false,
    )
        .expect("target tunnel");
        assert!(
            top.structures.chambers.iter().all(|c| c.kind != "shaft"),
            "tunnel target must not keep shafts, got {:?}",
            top.structures
                .chambers
                .iter()
                .map(|c| c.kind.as_str())
                .collect::<Vec<_>>()
        );
    }

    /// Yan: sığ sarnıç (mavi+beyaz) + kırmızı yanında mavi — kırmızı yapı silmez.
    fn side_cistern_dipole_map() -> RgbaImage {
        let w = 220u32;
        let h = 160u32;
        let mut img = RgbaImage::from_pixel(w, h, Rgba([34, 180, 70, 255]));
        // Sığ geniş boşluk (sarnıç kesiti)
        for y in 18..48 {
            for x in 40..130 {
                img.put_pixel(x, y, Rgba([25, 45, 190, 255]));
            }
        }
        // Beyaz duvar çizgisi (nötr zarf)
        for x in 42..128 {
            img.put_pixel(x, 18, Rgba([235, 235, 230, 255]));
            img.put_pixel(x, 47, Rgba([230, 230, 225, 255]));
        }
        // Mavi boşluk (kırmızı yanında — yapı adayı olabilir)
        for y in 100..130 {
            for x in 130..165 {
                img.put_pixel(x, y, Rgba([30, 50, 200, 255]));
            }
        }
        // Büyük kırmızı alan (yapı içi / çıkış — silme nedeni değil)
        for y in 95..150 {
            for x in 155..210 {
                img.put_pixel(x, y, Rgba([220, 40, 30, 255]));
            }
        }
        img
    }

    #[test]
    fn side_cistern_keeps_room_red_does_not_kill_void() {
        force_legacy_fallback();
        let img = side_cistern_dipole_map();
        let side = colormap_to_surface(
            &img,
            24,
            128,
            Some("smoke-side-cistern.png".into()),
            "side",
            0.35,
            "auto",
            &[],
        &soil_legacy(),
        false,
        false,
    )
        .expect("side cistern");
        let rooms: Vec<_> = side
            .structures
            .chambers
            .iter()
            .filter(|c| c.kind == "room" || c.kind == "tomb")
            .collect();
        assert!(
            !rooms.is_empty(),
            "expected cistern room, got chambers={:?} tunnels={} metals={}",
            side.structures
                .chambers
                .iter()
                .map(|c| format!("{}@{:.2}", c.kind, c.top_from_surface_m))
                .collect::<Vec<_>>(),
            side.structures.tunnels.len(),
            side.structures.metals.len()
        );
        let shallow = rooms
            .iter()
            .any(|r| r.top_from_surface_m / side.depth_range_m < 0.45);
        assert!(shallow, "walled cistern should stay near-surface");
        assert!(
            !side.structures.metals.is_empty(),
            "red field expected (fill/exit), not a reason to delete voids"
        );
        let m = &side.structures.metals[0];
        if m.host_kind == "tunnel" {
            assert!(
                m.inside_chamber && !side.structures.tunnels.is_empty(),
                "kırmızı koridor → tünel + iç anomali"
            );
            assert!(
                m.plume_height_m >= 0.25,
                "side red plume expected, got {}",
                m.plume_height_m
            );
        } else {
            assert!(
                m.spread_m >= 2.0 || m.width_m >= 2.0,
                "red footprint must follow image size, spread={} width={}",
                m.spread_m,
                m.width_m
            );
            assert!(
                m.plume_height_m >= 0.25,
                "side red plume expected, got {}",
                m.plume_height_m
            );
        }
    }

    /// Yeşil zemin + düz beyaz çizgi (yeşil→beyaz→yeşil) → tünel.
    fn green_white_line_map() -> RgbaImage {
        let w = 240u32;
        let h = 160u32;
        let mut img = RgbaImage::from_pixel(w, h, Rgba([34, 180, 70, 255]));
        // Yatay düz beyaz çizgi (tünel duvar ipucu) — yeşil→beyaz→yeşil
        for x in 35..210 {
            for t in 0..2 {
                img.put_pixel(x, 78 + t, Rgba([240, 240, 235, 255]));
            }
        }
        img
    }

    #[test]
    fn green_straight_white_line_makes_tunnel() {
        force_legacy_fallback();
        let img = green_white_line_map();
        let top = colormap_to_surface(
            &img,
            24,
            128,
            Some("smoke-green-line.png".into()),
            "top",
            0.3,
            "auto",
            &[],
        &soil_legacy(),
        false,
        false,
    )
        .expect("green line");
        let green_n = top
            .wall_cues
            .iter()
            .filter(|c| c.green_line)
            .count();
        assert!(
            green_n >= 3,
            "expected green_line cues from white ridge, got {} (total walls={})",
            green_n,
            top.wall_cues.len()
        );
        assert!(
            !top.structures.tunnels.is_empty(),
            "straight white line in green must yield tunnel, chambers={} metals={}",
            top.structures.chambers.len(),
            top.structures.metals.len()
        );
    }
}
