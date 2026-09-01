//! Void classification (top / side view).

use super::path::{path_structure_support, tunnel_path_endpoints};
use super::types_local::{Blob, VoidClass};

/// Dik planda kuyu ağzı: kompakt/yuvarlak; manyetik ayakizi fiziksel çaptan büyük olabilir.
pub fn well_like_plan(b: &Blob, map_w_m: f32, map_d_m: f32) -> bool {
    let bbox_aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
    // PCA bazen hafif ovali uzatır; bbox ile yumuşat
    let aspect = bbox_aspect.min(b.axis_aspect.max(bbox_aspect * 0.85));
    let diam_m = (b.rx * 2.0 * map_w_m)
        .min(b.ry * 2.0 * map_d_m)
        .max(0.3);
    aspect < 2.6
        && b.fill_ratio >= 0.22
        && diam_m >= 0.35
        && diam_m <= 20.0
        && b.intensity >= 0.22
}

/// Manyetik ayakizinden fiziksel kuyu çapı (m) — alan şişkinliğini kes.
pub fn well_physical_diameter_m(b: &Blob, map_w_m: f32, map_d_m: f32) -> f32 {
    let footprint = (b.rx * 2.0 * map_w_m)
        .min(b.ry * 2.0 * map_d_m)
        .max(0.4);
    // Tipik kuyu 0.6–2.5 m; büyük ayakizi → oransal küçült
    if footprint <= 2.8 {
        footprint.clamp(0.55, 2.8)
    } else {
        (footprint * 0.28).clamp(0.8, 2.8)
    }
}

pub fn classify_void_top(
    b: &Blob,
    signed: &[f32],
    w: u32,
    h: u32,
    thr: f32,
    map_w_m: f32,
    map_d_m: f32,
    through_red: bool,
) -> (VoidClass, f32, f32, f32) {
    let bbox_aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
    let aspect = b.axis_aspect.max(bbox_aspect);
    let area_n = (b.rx * b.ry * std::f32::consts::PI).clamp(0.0, 0.08);
    let diam_m = (b.rx * 2.0 * map_w_m)
        .min(b.ry * 2.0 * map_d_m)
        .max(0.3);
    let (x0, y0, x1, y1) = tunnel_path_endpoints(b, false);
    let path_s = path_structure_support(signed, w, h, x0, y0, x1, y1, thr, through_red);

    // --- Kuyu / dikey şaft (dik çekim planı: kompakt + dairesel) ---
    let compact = aspect < 1.65 && b.fill_ratio >= 0.38;
    let well_size = diam_m >= 0.5 && diam_m <= 6.0;
    let mut score_shaft = if compact && well_size {
        let roundness = (1.65 - aspect).clamp(0.0, 0.65) / 0.65;
        let fill_b = ((b.fill_ratio - 0.35) / 0.55).clamp(0.0, 1.0);
        0.48 + roundness * 0.28 + fill_b * 0.22 + b.intensity * 0.2
    } else if aspect < 1.5 && diam_m <= 4.0 && area_n < 0.022 {
        0.4 + (1.5 - aspect) * 0.24 + b.intensity * 0.22 + b.fill_ratio * 0.15
    } else {
        0.04
    };
    if compact && path_s < 0.35 {
        score_shaft += 0.14;
    }
    if path_s >= 0.55 && aspect >= 2.3 {
        score_shaft *= 0.5;
    }

    // --- Tünel: yalnızca belirgin koridor (yüksek aspect + path) ---
    let path_floor = if through_red { 0.22 } else { 0.35 };
    let mut score_tunnel = if aspect >= 2.15 {
        0.22 + (aspect - 2.15).min(2.5) * 0.16 + path_s * 0.32 + b.intensity * 0.1
    } else {
        0.02
    };
    if path_s >= 0.42 {
        score_tunnel += 0.06;
    }
    if path_s < path_floor || aspect < 2.3 {
        score_tunnel *= if through_red { 0.75 } else { 0.55 };
    }
    if through_red && aspect >= 2.0 && path_s >= 0.18 {
        score_tunnel = score_tunnel.max(0.32 + path_s * 0.2);
    }
    if compact && well_size {
        score_tunnel *= 0.2;
    }

    // --- Mezar / oda: dikdörtgen plan; dairesel kuyudan uzak ---
    let mut score_tomb = if aspect < 1.85 && area_n > 0.01 && !compact {
        0.3 + area_n * 7.5 + b.fill_ratio * 0.22 + b.intensity * 0.18
    } else if aspect < 1.7 && area_n > 0.012 && b.fill_ratio < 0.55 {
        0.22 + area_n * 5.0
    } else {
        0.05
    };

    let mut score_room = if aspect < 1.85 && area_n >= 0.004 && area_n <= 0.02 && !compact {
        0.3 + b.fill_ratio * 0.28 + b.intensity * 0.22
    } else if aspect < 1.7 && !compact {
        0.18 + b.fill_ratio * 0.18
    } else {
        0.03
    };

    if compact && well_size {
        score_tomb *= 0.25;
        score_room *= 0.22;
    }

    let score_noise = (0.55 - b.intensity).max(0.0) * 0.7 + (1.0 - b.fill_ratio) * 0.25;

    pick_class(
        &[
            (VoidClass::Shaft, score_shaft.clamp(0.0, 1.0)),
            (VoidClass::Tunnel, score_tunnel.clamp(0.0, 1.0)),
            (VoidClass::Tomb, score_tomb.clamp(0.0, 1.0)),
            (VoidClass::Room, score_room.clamp(0.0, 1.0)),
            (VoidClass::Noise, score_noise.clamp(0.0, 1.0)),
        ],
        path_s,
    )
}

pub fn classify_void_side(
    b: &Blob,
    signed: &[f32],
    w: u32,
    h: u32,
    thr: f32,
    map_w_m: f32,
    depth_range_m: f32,
    through_red: bool,
) -> (VoidClass, f32, f32, f32) {
    let _ = depth_range_m;
    let span_x_m = b.rx * 2.0 * map_w_m;
    // Eşikler eski 3 m kalibrasyonuna göre; raporlanan metre depth_range ile ayrı ölçeklenir.
    const REF: f32 = crate::surface::SIDE_CLASS_REF_M;
    let measured_h = (b.ry * 2.0 * REF).max(0.35);
    let aspect_x = b.rx / b.ry.max(1e-3);
    let aspect_y = b.ry / b.rx.max(1e-3);
    let (x0, y0, x1, y1) = tunnel_path_endpoints(b, true);
    let path_s = path_structure_support(signed, w, h, x0, y0, x1, y1, thr, through_red);

    // Yan çekim: mavi çoğu zaman oda/mezar kesiti.
    // Kuyu yalnızca çok dar + belirgin dikey sütun (geniş kesit ≠ şaft).
    let narrow_column =
        span_x_m <= 1.15 && aspect_y >= 2.35 && aspect_x <= 0.55;
    let mut score_shaft = if narrow_column {
        0.52 + (aspect_y - 2.35).min(2.0) * 0.1 + b.intensity * 0.14 + b.fill_ratio * 0.08
    } else {
        0.02
    };
    if span_x_m >= 1.25 || aspect_x >= 0.8 || measured_h < span_x_m * 1.6 {
        score_shaft *= 0.12;
    }

    // Tünel: yalnızca ince yatay koridor (oda kesiti değil)
    // path_s: through_red iken kırmızı dolgu da sayılır
    let path_ok_thin = if through_red { 0.14 } else { 0.28 };
    let path_ok_backup = if through_red { 0.1 } else { 0.2 };
    let thin_gallery = aspect_x >= 2.55
        && measured_h <= 1.25
        && span_x_m >= measured_h * 2.6
        && path_s >= path_ok_thin;
    let mut score_tunnel = if thin_gallery {
        0.4 + path_s * 0.3 + b.intensity * 0.16 + (aspect_x - 2.55).min(2.0) * 0.08
    } else if aspect_x >= 2.4 && measured_h <= 1.35 && path_s >= path_ok_backup {
        // Kırmızı ile bölünmüş koridor yedek skor
        0.28 + path_s * 0.25 + b.intensity * 0.12
    } else if through_red && aspect_x >= 2.1 && path_s >= 0.08 {
        0.24 + path_s * 0.22 + b.intensity * 0.1
    } else {
        0.02
    };
    if measured_h >= 1.15 || aspect_x < 2.5 {
        score_tunnel *= if through_red && aspect_x >= 2.1 { 0.55 } else { 0.2 };
    }

    // Oda / mezar: yan kesitte varsayılan yapı
    let mut score_tomb = if measured_h >= 1.3 && span_x_m >= 1.2 && aspect_x < 3.2 {
        0.52 + b.fill_ratio * 0.22 + b.intensity * 0.2
    } else {
        0.08
    };
    let mut score_room = if measured_h >= 0.45 && span_x_m >= 0.55 {
        0.58 + b.fill_ratio * 0.24 + b.intensity * 0.22
    } else if b.intensity >= 0.35 && b.fill_ratio >= 0.3 {
        0.48 + b.intensity * 0.2
    } else {
        0.14
    };
    // Güçlü / kompakt mavi boya → oda (tünel skorunu ez)
    if b.intensity >= 0.4 && measured_h >= 0.85 && aspect_x < 2.8 {
        score_tunnel *= 0.25;
        score_room += 0.18;
    }
    // Geniş / karemsi kesit → oda (şaft değil)
    if span_x_m >= 1.0 && measured_h >= 0.7 {
        score_room += 0.22;
        score_tomb += 0.1;
        score_shaft *= 0.15;
    }
    if measured_h >= 0.7 && aspect_x >= 0.7 {
        score_room += 0.14;
    }
    // Üst yarı / güçlü boya → oda
    if b.cy <= 0.55 && b.intensity >= 0.28 && span_x_m >= 0.65 {
        score_room += 0.2;
        score_tomb += 0.08;
        score_tunnel *= 0.55;
        score_shaft *= 0.35;
    }
    // Eski hata: “dikey görünüyor = kuyu” — yan çekimde bu oda kesitidir
    if !narrow_column && aspect_y >= 1.2 && span_x_m >= 0.9 {
        score_room += 0.12;
        score_shaft *= 0.2;
    }
    // Geniş yan kesit: oda mezarın üstünde net kalsın (margin gate)
    if span_x_m >= 1.35 && measured_h >= 0.85 && aspect_x < 2.0 {
        score_tomb *= 0.88;
    }

    let score_noise = (0.48 - b.intensity).max(0.0) * 0.55;

    pick_class(
        &[
            (VoidClass::Room, score_room.clamp(0.0, 1.0)),
            (VoidClass::Tomb, score_tomb.clamp(0.0, 1.0)),
            (VoidClass::Tunnel, score_tunnel.clamp(0.0, 1.0)),
            (VoidClass::Shaft, score_shaft.clamp(0.0, 1.0)),
            (VoidClass::Noise, score_noise.clamp(0.0, 1.0)),
        ],
        path_s,
    )
}

#[cfg(test)]
mod side_class_tests {
    use super::*;
    use crate::structures::types_local::Blob;

    fn blob(rx: f32, ry: f32, intensity: f32) -> Blob {
        Blob {
            cx: 0.5,
            cy: 0.35,
            rx,
            ry,
            intensity,
            max_intensity: intensity,
            area_px: 80,
            fill_ratio: 0.55,
            dir_x: 0.0,
            dir_y: 1.0,
            half_len: ry.max(rx),
            axis_aspect: (ry / rx.max(1e-3)).max(rx / ry.max(1e-3)),
            outline: Vec::new(),
        }
    }

    #[test]
    fn side_wide_void_prefers_room_not_shaft() {
        // ~1.6 m geniş × ~2+ m yüksek kesit → oda (kuyu değil)
        let b = blob(1.6 / (2.0 * 24.0), 0.22, 0.7);
        let signed = vec![0.0f32; 64];
        let (class, conf, _, _) = classify_void_side(&b, &signed, 8, 8, 0.2, 24.0, 10.0, false);
        assert_eq!(class, VoidClass::Room, "wide side void must be room, got {class:?}");
        assert!(conf >= 0.45, "room conf, got {conf}");
    }

    #[test]
    fn side_narrow_column_can_be_shaft() {
        let b = blob(0.9 / (2.0 * 24.0), 0.28, 0.65);
        let signed = vec![0.0f32; 64];
        let (class, _, _, _) = classify_void_side(&b, &signed, 8, 8, 0.2, 24.0, 10.0, false);
        // Dar dikey sütun şaft olabilir; geniş değilse en azından oda da kabul
        assert!(
            matches!(class, VoidClass::Shaft | VoidClass::Room),
            "got {class:?}"
        );
    }
}

pub fn pick_class(scores: &[(VoidClass, f32)], path_s: f32) -> (VoidClass, f32, f32, f32) {
    let mut sorted = scores.to_vec();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let best = sorted[0];
    let second = sorted.get(1).map(|s| s.1).unwrap_or(0.0);
    let margin = best.1 - second;
    (best.0, best.1, margin, path_s)
}

#[cfg(test)]
mod parity_tests {
    //! VPE (votex-prob `decide::score`) ile legacy `classify` arası parite.
    //! Her iki taraf da aynı formülü kullanmalı — hem normal hem `through_red`
    //! (kırmızı yapıyı engellemesin) modunda. Drift olursa bu test VPE güncellenmeden önce yakalar.

    use super::{classify_void_side, classify_void_top};
    use crate::structures::path::{path_structure_support, tunnel_path_endpoints};
    use crate::structures::types_local::{Blob, VoidClass};
    use votex_prob::decide::score::score_void;
    use votex_prob::schema::BlobDto;

    const THR: f32 = 0.22;
    const MAP_W_M: f32 = 24.0;
    const MAP_D_M: f32 = 24.0;
    const DEPTH_RANGE_M: f32 = 10.0;

    fn make_blob(
        cx: f32,
        cy: f32,
        rx: f32,
        ry: f32,
        intensity: f32,
        fill_ratio: f32,
        axis_aspect: f32,
        horizontal: bool,
    ) -> Blob {
        Blob {
            cx,
            cy,
            rx,
            ry,
            intensity,
            max_intensity: intensity,
            area_px: 80,
            fill_ratio,
            dir_x: if horizontal { 1.0 } else { 0.0 },
            dir_y: if horizontal { 0.0 } else { 1.0 },
            half_len: if horizontal { rx } else { ry },
            axis_aspect,
            outline: Vec::new(),
        }
    }

    /// Blob bbox'ını negatif (mavi) bantla doldur — eksen path skoru yüksek olur.
    fn axis_void_field(w: u32, h: u32, b: &Blob, value: f32) -> Vec<f32> {
        let mut field = vec![0.0f32; (w * h) as usize];
        let wf = (w - 1) as f32;
        let hf = (h - 1) as f32;
        let x0 = ((b.cx - b.rx).clamp(0.0, 1.0) * wf).floor() as i32;
        let x1 = ((b.cx + b.rx).clamp(0.0, 1.0) * wf).ceil() as i32;
        let y0 = ((b.cy - b.ry).clamp(0.0, 1.0) * hf).floor() as i32;
        let y1 = ((b.cy + b.ry).clamp(0.0, 1.0) * hf).ceil() as i32;
        for y in y0..=y1 {
            for x in x0..=x1 {
                field[(y as u32 * w + x as u32) as usize] = value;
            }
        }
        field
    }

    fn class_name(c: VoidClass) -> &'static str {
        match c {
            VoidClass::Room => "room",
            VoidClass::Tomb => "tomb",
            VoidClass::Tunnel => "tunnel",
            VoidClass::Shaft => "shaft",
            VoidClass::Noise => "noise",
        }
    }

    /// Bir blobu hem legacy hem VPE ile skorla; sonuçlar birebir aynı olmalı.
    fn assert_parity(
        label: &str,
        b: &Blob,
        side: bool,
        w: u32,
        h: u32,
        field: &[f32],
        through_red: bool,
    ) {
        // Legacy: path_s'i kendi içinde hesaplar (through_red'e göre koridor/void modu)
        let (legacy_class, legacy_conf, legacy_margin, legacy_path) = if side {
            classify_void_side(b, field, w, h, THR, MAP_W_M, DEPTH_RANGE_M, through_red)
        } else {
            classify_void_top(b, field, w, h, THR, MAP_W_M, MAP_D_M, through_red)
        };

        // VPE: legacy'nin iç hesabıyla aynı path_s (through_red'e göre)
        let (x0, y0, x1, y1) = tunnel_path_endpoints(b, side);
        let path_s = path_structure_support(field, w, h, x0, y0, x1, y1, THR, through_red);
        assert!(
            (path_s - legacy_path).abs() < 1e-6,
            "{label}: path_s uyuşmazlığı legacy={legacy_path} vpe={path_s}"
        );

        let bbox_aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
        let dto = BlobDto {
            id: "v0".into(),
            cx: b.cx,
            cy: b.cy,
            rx: b.rx,
            ry: b.ry,
            intensity: b.intensity,
            fill_ratio: b.fill_ratio,
            aspect: b.axis_aspect.max(bbox_aspect),
            path_s,
            wall_s: 0.0,
            line_s: 0.0,
            near_red: false,
            snr: 8.0,
            axis_aspect: b.axis_aspect,
            half_len: b.half_len,
        };
        let (vpe_class, vpe_conf, vpe_margin, _reasons) =
            score_void(&dto, side, MAP_W_M, MAP_D_M, DEPTH_RANGE_M, through_red);

        assert_eq!(
            vpe_class,
            class_name(legacy_class),
            "{label}: sınıf uyuşmazlığı legacy={:?} vpe={vpe_class}",
            legacy_class
        );
        assert!(
            (vpe_conf - legacy_conf).abs() < 1e-4,
            "{label}: conf uyuşmazlığı legacy={legacy_conf} vpe={vpe_conf}"
        );
        assert!(
            (vpe_margin - legacy_margin).abs() < 1e-4,
            "{label}: margin uyuşmazlığı legacy={legacy_margin} vpe={vpe_margin}"
        );
    }

    fn sweep(side: bool, cases: &[(f32, f32, f32, f32, f32, f32, f32, bool)]) {
        const W: u32 = 96;
        const H: u32 = 96;
        for (i, &(cx, cy, rx, ry, intensity, fill, aspect, horizontal)) in cases.iter().enumerate() {
            let b = make_blob(cx, cy, rx, ry, intensity, fill, aspect, horizontal);
            // Eksen path'li (mavi bant) ve path'siz (yeşil zemin) iki varyant,
            // ayrıca normal ve through_red modu
            for with_band in [true, false] {
                let field = if with_band {
                    axis_void_field(W, H, &b, -0.5)
                } else {
                    vec![0.0f32; (W * H) as usize]
                };
                for through_red in [false, true] {
                    assert_parity(
                        &format!("case {i} side={side} band={with_band} through_red={through_red}"),
                        &b,
                        side,
                        W,
                        H,
                        &field,
                        through_red,
                    );
                }
            }
        }
    }

    #[test]
    fn side_scoring_parity_with_legacy() {
        let cases: &[(f32, f32, f32, f32, f32, f32, f32, bool)] = &[
            // Geniş oda kesiti
            (0.50, 0.40, 0.12, 0.09, 0.70, 0.55, 1.4, true),
            // Dar dikey sütun → şaft
            (0.50, 0.40, 0.02, 0.30, 0.65, 0.50, 15.0, false),
            // İnce yatay galeri → tünel
            (0.50, 0.40, 0.15, 0.025, 0.65, 0.60, 6.0, true),
            // Mezar kesiti
            (0.50, 0.40, 0.06, 0.09, 0.60, 0.55, 1.5, true),
            // Zayıf sinyal
            (0.50, 0.40, 0.015, 0.015, 0.25, 0.30, 1.0, true),
            // Üst bölge + güçlü boya
            (0.30, 0.30, 0.05, 0.06, 0.50, 0.60, 1.2, true),
            // Orta aspect — through_red'de 3. tünel dalını (aspect_x ∈ [2.1, 2.4)) tetikler
            (0.50, 0.40, 0.055, 0.025, 0.60, 0.55, 2.2, true),
            // Alt bölge (cy > 0.55)
            (0.50, 0.62, 0.08, 0.08, 0.70, 0.55, 1.1, true),
        ];
        sweep(true, cases);
    }

    #[test]
    fn top_scoring_parity_with_legacy() {
        let cases: &[(f32, f32, f32, f32, f32, f32, f32, bool)] = &[
            // Kompakt dairesel → şaft adayı
            (0.50, 0.50, 0.025, 0.03, 0.70, 0.60, 1.2, true),
            // Uzamış → tünel
            (0.50, 0.50, 0.15, 0.03, 0.65, 0.60, 5.0, true),
            // Dikdörtgen plan → oda/mezar
            (0.50, 0.50, 0.07, 0.05, 0.60, 0.50, 1.4, true),
            // Büyük blob
            (0.50, 0.50, 0.20, 0.20, 0.50, 0.50, 1.0, true),
            // Merkez dışı
            (0.30, 0.50, 0.05, 0.03, 0.45, 0.40, 1.6, true),
            // Dikey eksenli tünel
            (0.50, 0.50, 0.03, 0.15, 0.65, 0.60, 5.0, false),
        ];
        sweep(false, cases);
    }
}
