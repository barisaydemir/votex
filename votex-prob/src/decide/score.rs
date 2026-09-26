//! L2 sınıf skorları (legacy classify_void_side/top ile hizalı).

use crate::schema::BlobDto;

pub fn score_void(
    b: &BlobDto,
    side: bool,
    map_w_m: f32,
    map_d_m: f32,
    _depth_range_m: f32,
    through_red: bool,
) -> (String, f32, f32, Vec<String>) {
    if side {
        score_side(b, map_w_m, through_red)
    } else {
        score_top(b, map_w_m, map_d_m, through_red)
    }
}

fn score_side(b: &BlobDto, map_w_m: f32, through_red: bool) -> (String, f32, f32, Vec<String>) {
    let span_x_m = b.rx * 2.0 * map_w_m;
    const REF: f32 = 3.0;
    let measured_h = (b.ry * 2.0 * REF).max(0.35);
    let aspect_x = b.rx / b.ry.max(1e-3);
    let aspect_y = b.ry / b.rx.max(1e-3);
    let path_s = b.path_s;

    let narrow_column = span_x_m <= 1.15 && aspect_y >= 2.35 && aspect_x <= 0.55;
    let mut score_shaft = if narrow_column {
        0.52 + (aspect_y - 2.35).min(2.0) * 0.1 + b.intensity * 0.14 + b.fill_ratio * 0.08
    } else {
        0.02
    };
    if span_x_m >= 1.25 || aspect_x >= 0.8 || measured_h < span_x_m * 1.6 {
        score_shaft *= 0.12;
    }

    let path_ok_thin = if through_red { 0.14 } else { 0.28 };
    let path_ok_backup = if through_red { 0.1 } else { 0.2 };
    let thin_gallery = aspect_x >= 2.55
        && measured_h <= 1.25
        && span_x_m >= measured_h * 2.6
        && path_s >= path_ok_thin;
    let mut score_tunnel = if thin_gallery {
        0.4 + path_s * 0.3 + b.intensity * 0.16 + (aspect_x - 2.55).min(2.0) * 0.08
    } else if aspect_x >= 2.4 && measured_h <= 1.35 && path_s >= path_ok_backup {
        0.28 + path_s * 0.25 + b.intensity * 0.12
    } else if through_red && aspect_x >= 2.1 && path_s >= 0.08 {
        // Kırmızı içinde/çıkışında koridor — düşük eşikle üçüncü dal
        0.24 + path_s * 0.22 + b.intensity * 0.1
    } else {
        0.02
    };
    if measured_h >= 1.15 || aspect_x < 2.5 {
        score_tunnel *= if through_red && aspect_x >= 2.1 { 0.55 } else { 0.2 };
    }

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

    if b.intensity >= 0.4 && measured_h >= 0.85 && aspect_x < 2.8 {
        score_tunnel *= 0.25;
        score_room += 0.18;
    }
    if span_x_m >= 1.0 && measured_h >= 0.7 {
        score_room += 0.22;
        score_tomb += 0.1;
        score_shaft *= 0.15;
    }
    if measured_h >= 0.7 && aspect_x >= 0.7 {
        score_room += 0.14;
    }
    if b.cy <= 0.55 && b.intensity >= 0.28 && span_x_m >= 0.65 {
        score_room += 0.2;
        score_tomb += 0.08;
        score_tunnel *= 0.55;
        score_shaft *= 0.35;
    }
    if !narrow_column && aspect_y >= 1.2 && span_x_m >= 0.9 {
        score_room += 0.12;
        score_shaft *= 0.2;
    }
    // Geniş yan kesit: oda mezarın üstünde net kalsın (margin gate / altın set)
    if span_x_m >= 1.35 && measured_h >= 0.85 && aspect_x < 2.0 {
        score_tomb *= 0.88;
    }

    let score_noise = (0.48 - b.intensity).max(0.0) * 0.55;

    pick(&[
        ("room", score_room.clamp(0.0, 1.0)),
        ("tomb", score_tomb.clamp(0.0, 1.0)),
        ("tunnel", score_tunnel.clamp(0.0, 1.0)),
        ("shaft", score_shaft.clamp(0.0, 1.0)),
        ("noise", score_noise.clamp(0.0, 1.0)),
    ])
}

fn score_top(b: &BlobDto, map_w_m: f32, map_d_m: f32, through_red: bool) -> (String, f32, f32, Vec<String>) {
    let bbox_aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
    let aspect = b.aspect.max(bbox_aspect);
    let area_n = (b.rx * b.ry * std::f32::consts::PI).clamp(0.0, 0.08);
    let diam_m = (b.rx * 2.0 * map_w_m)
        .min(b.ry * 2.0 * map_d_m)
        .max(0.3);
    let path_s = b.path_s;

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
        // Kırmızı path'i kesmez — tünel skorunu yükselt
        score_tunnel = score_tunnel.max(0.32 + path_s * 0.2);
    }
    if compact && well_size {
        score_tunnel *= 0.2;
    }

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

    pick(&[
        ("shaft", score_shaft.clamp(0.0, 1.0)),
        ("tunnel", score_tunnel.clamp(0.0, 1.0)),
        ("tomb", score_tomb.clamp(0.0, 1.0)),
        ("room", score_room.clamp(0.0, 1.0)),
        ("noise", score_noise.clamp(0.0, 1.0)),
    ])
}

fn pick(scores: &[(&str, f32)]) -> (String, f32, f32, Vec<String>) {
    let mut sorted: Vec<_> = scores.to_vec();
    sorted.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let best = sorted[0];
    let second = sorted.get(1).map(|s| s.1).unwrap_or(0.0);
    (
        best.0.to_string(),
        best.1,
        best.1 - second,
        vec![format!("score:{}", best.0)],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::BlobDto;

    fn dto(rx: f32, ry: f32, intensity: f32, path_s: f32) -> BlobDto {
        BlobDto {
            id: "v0".into(),
            cx: 0.5,
            cy: 0.4,
            rx,
            ry,
            intensity,
            fill_ratio: 0.55,
            aspect: (rx / ry.max(1e-3)).max(ry / rx.max(1e-3)),
            path_s,
            ..Default::default()
        }
    }

    /// Yan: aspect_x ∈ [2.1, 2.4) + zayıf boya — normalde oda kazanır;
    /// through_red'de 3. tünel dalı koridoru kurtarır (legacy classify ile aynı).
    #[test]
    fn through_red_third_tunnel_branch_rescues_corridor() {
        let b = dto(0.011, 0.005, 0.3, 1.0);
        let (class_off, _, _, _) = score_void(&b, true, 24.0, 24.0, 10.0, false);
        let (class_on, conf_on, _, _) = score_void(&b, true, 24.0, 24.0, 10.0, true);
        assert_eq!(class_off, "room", "normal modda oda beklenir, got {class_off}");
        assert_eq!(class_on, "tunnel", "through_red koridoru tünel yapmalı, got {class_on}");
        assert!(conf_on > 0.2, "3. dal skoru beklenir, got {conf_on}");
    }

    /// Dik: düşük path_s — through_red path_floor'u (0.22) düşürür, 0.75 çarpanı
    /// ve max dalı (0.32 + path*0.2) tünel skorunu yükseltir.
    #[test]
    fn through_red_top_tunnel_max_branch_raises_score() {
        let b = dto(0.15, 0.03, 0.65, 0.2);
        let (class_off, conf_off, _, _) = score_void(&b, false, 24.0, 24.0, 10.0, false);
        let (class_on, conf_on, _, _) = score_void(&b, false, 24.0, 24.0, 10.0, true);
        assert_eq!(class_off, "tunnel");
        assert_eq!(class_on, "tunnel");
        assert!(
            conf_on > conf_off,
            "through_red tünel skorunu artırmalı: off={conf_off} on={conf_on}"
        );
    }

    /// Yan: ikinci dal (aspect_x ∈ [2.4, 2.5)) + çarpan (0.55 vs 0.2).
    /// aspect_x < 2.5 olduğundan çarpan uygulanır; cy=0.6 oda bonusunu
    /// (cy <= 0.55) tetiklemez → through_red'de koridor odayı geçer.
    #[test]
    fn through_red_side_multiplier_raises_tunnel() {
        let b = BlobDto {
            id: "v0".into(),
            cx: 0.5,
            cy: 0.6,
            rx: 0.0245,
            ry: 0.01,
            intensity: 0.3,
            fill_ratio: 0.55,
            aspect: 2.45,
            path_s: 1.0,
            ..Default::default()
        };
        let (class_off, conf_off, _, _) = score_void(&b, true, 24.0, 24.0, 10.0, false);
        let (class_on, conf_on, _, _) = score_void(&b, true, 24.0, 24.0, 10.0, true);
        assert_eq!(class_off, "room", "0.2 çarpanı tüneli ezer, oda kazanır, got {class_off}");
        assert_eq!(class_on, "tunnel", "0.55 çarpanı koridoru kurtarır, got {class_on}");
        assert!(
            conf_on > conf_off,
            "through_red çarpanı tünel skorunu artırmalı: off={conf_off} on={conf_on}"
        );
    }
}
