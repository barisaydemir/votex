//! DTA / harici yönlendirme ipuçları — eksik oda/tünel/metal enjekte veya güçlendir.
//!
//! Ek olarak, DTA analizinin tespit ettiği yapıları StructureHint'e çevirip
//! 3D haritada göstermek için kullanılır.

use crate::surface::{Chamber, Evidence, MetalBody, Tunnel};

use super::compass::compass_from_segment;

/// Normalize harita (0–1) konumunda yapı tercihi (DTA → VOTEX).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureHint {
    /// room | tomb | tunnel | metal | shaft
    pub kind: String,
    pub cx: f32,
    pub cy: f32,
    #[serde(default = "default_r")]
    pub rx: f32,
    #[serde(default = "default_r")]
    pub ry: f32,
    #[serde(default)]
    pub label: String,
}

fn default_r() -> f32 {
    0.06
}

/// İpucu yakınındaki mevcut odayı güçlendir veya yeni oda/tünel/metal ekle.
pub fn apply_structure_hints(
    chambers: &mut Vec<Chamber>,
    tunnels: &mut Vec<Tunnel>,
    metals: &mut Vec<MetalBody>,
    hints: &[StructureHint],
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    side: bool,
) {
    if hints.is_empty() {
        return;
    }
    for (i, h) in hints.iter().enumerate() {
        let kind = h.kind.trim().to_ascii_lowercase();
        let cx = h.cx.clamp(0.02, 0.98);
        let cy = h.cy.clamp(0.02, 0.98);
        let rx = h.rx.clamp(0.02, 0.25);
        let ry = h.ry.clamp(0.02, 0.25);
        let label = if h.label.is_empty() {
            format!("DTA yönlendirme {}", i + 1)
        } else {
            h.label.clone()
        };

        match kind.as_str() {
            "room" | "tomb" | "oda" | "mezar" => {
                let want = if kind == "tomb" || kind == "mezar" {
                    "tomb"
                } else {
                    "room"
                };
                if let Some(c) = chambers.iter_mut().find(|c| {
                    (c.kind == "room" || c.kind == "tomb")
                        && ((c.cx - cx).powi(2) + (c.cy - cy).powi(2)).sqrt() < (c.rx + rx) * 1.2
                }) {
                    c.confidence = c.confidence.max(0.88);
                    c.geometry.label = label;
                    c.geometry.method = "dta_hint_boost".into();
                    continue;
                }
                if let Some(c) = build_hint_chamber(want, cx, cy, rx, ry, map_w_m, map_d_m, depth_range_m, side, label)
                {
                    chambers.push(c);
                }
            }
            "tunnel" | "tunel" | "tünel" | "koridor" => {
                if tunnels.iter().any(|t| {
                    let mx = (t.x0 + t.x1) * 0.5;
                    let my = (t.y0 + t.y1) * 0.5;
                    ((mx - cx).powi(2) + (my - cy).powi(2)).sqrt() < 0.1
                }) {
                    continue;
                }
                if let Some(t) = build_hint_tunnel(cx, cy, rx, ry, map_w_m, map_d_m, depth_range_m, side, label)
                {
                    tunnels.push(t);
                }
            }
            "metal" | "field" | "anomali" => {
                if metals.iter().any(|m| {
                    ((m.cx - cx).powi(2) + (m.cy - cy).powi(2)).sqrt() < (m.rx + rx).max(0.05)
                }) {
                    continue;
                }
                metals.push(build_hint_metal(cx, cy, rx, ry, map_w_m, map_d_m, depth_range_m, side, label));
            }
            "shaft" | "kuyu" | "well" => {
                if chambers.iter().any(|c| {
                    c.kind == "shaft"
                        && ((c.cx - cx).powi(2) + (c.cy - cy).powi(2)).sqrt() < 0.12
                }) {
                    continue;
                }
                if let Some(c) =
                    build_hint_chamber("shaft", cx, cy, rx, ry, map_w_m, map_d_m, depth_range_m, side, label)
                {
                    chambers.push(c);
                }
            }
            _ => {}
        }
    }
}

fn build_hint_chamber(
    kind: &str,
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    side: bool,
    label: String,
) -> Option<Chamber> {
    let (top_m, bottom_m, width_m, length_m) = if side {
        let fake = super::types_local::Blob {
            cx,
            cy,
            rx,
            ry,
            intensity: 0.82,
            max_intensity: 0.85,
            area_px: 100,
            fill_ratio: 0.6,
            dir_x: 1.0,
            dir_y: 0.0,
            half_len: rx.max(ry),
            axis_aspect: 1.0,
            outline: Vec::new(),
        };
        let (top, bot) = super::build::side_cover_floor_m(&fake, depth_range_m);
        let w = (rx * 2.0 * map_w_m).clamp(0.6, map_w_m * 0.5);
        let l = ((bot - top) * 0.62).clamp(0.7, 2.4);
        (top, bot, w, l)
    } else {
        let e = super::build::emergence_with_cue(0.82, 0.6, 0.35);
        let deep_cap = (depth_range_m * 0.28).max(0.7);
        let top = super::build::burial_from_emergence(e, 0.2, deep_cap);
        let h = 2.0f32.min(depth_range_m - top);
        let w = (rx * 2.0 * map_w_m).clamp(0.8, 6.0);
        let l = (ry * 2.0 * map_d_m).clamp(0.8, 6.0);
        (top, top + h, w, l)
    };
    let height_m = (bottom_m - top_m).max(0.4);
    let mut geom = crate::surface::GeometryAnalysis::default();
    geom.method = "dta_hint".into();
    geom.label = label;
    Some(Chamber {
        kind: kind.into(),
        cx,
        cy,
        rx,
        ry,
        depth: ((top_m + bottom_m) * 0.5 / depth_range_m).clamp(0.05, 0.98),
        height: (height_m / depth_range_m).clamp(0.08, 0.9),
        intensity: 0.82,
        width_m,
        length_m: if kind == "shaft" {
            width_m.min(length_m)
        } else {
            length_m
        },
        top_from_surface_m: top_m,
        bottom_from_surface_m: bottom_m,
        height_m,
        bearing_deg: 0.0,
        confidence: 0.9,
        tier: 0,
        depth_estimate_m: 0.0,
        evidence: Evidence {
            snr: 4.0,
            path_support: 0.5,
            class_margin: 0.35,
            wall_support: 0.2,
            reasons: vec!["dta_hint".into()],
        },
        geometry: geom,
        outline: Vec::new(),
    })
}

fn build_hint_tunnel(
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
    map_w_m: f32,
    _map_d_m: f32,
    depth_range_m: f32,
    side: bool,
    label: String,
) -> Option<Tunnel> {
    let x0 = (cx - rx).clamp(0.0, 1.0);
    let x1 = (cx + rx).clamp(0.0, 1.0);
    if (x1 - x0).abs() < 0.04 {
        return None;
    }
    let y0 = cy;
    let y1 = cy;
    let (crown, floor, width_m) = if side {
        let fake = super::types_local::Blob {
            cx,
            cy,
            rx,
            ry,
            intensity: 0.82,
            max_intensity: 0.85,
            area_px: 100,
            fill_ratio: 0.6,
            dir_x: 1.0,
            dir_y: 0.0,
            half_len: rx.max(ry),
            axis_aspect: 1.0,
            outline: Vec::new(),
        };
        let (crown, floor) = super::build::side_cover_floor_m(&fake, depth_range_m);
        let width_m = ((floor - crown) * 0.85).clamp(0.65, 2.0);
        (crown, floor, width_m)
    } else {
        let e = super::build::emergence_with_cue(0.82, 0.55, 0.4);
        let deep_cap = (depth_range_m * 0.24).max(0.55);
        let crown = super::build::burial_from_emergence(e, 0.18, deep_cap);
        let height = 1.5;
        let width_m = (rx * 2.0 * map_w_m).clamp(0.7, 2.5);
        (crown, crown + height, width_m)
    };
    let height_m = (floor - crown).max(0.4);
    let (bearing_deg, heading, direction) = compass_from_segment(x0, y0, x1, y1);
    let mut geom = crate::surface::GeometryAnalysis::default();
    geom.method = "dta_hint".into();
    geom.label = label;
    Some(Tunnel {
        x0,
        y0,
        x1,
        y1,
        radius: rx.clamp(0.01, 0.08),
        depth: ((crown + height_m * 0.5) / depth_range_m).clamp(0.05, 0.98),
        bearing_deg,
        direction,
        heading,
        width_m,
        floor_from_surface_m: floor,
        crown_from_surface_m: crown,
        height_m,
        confidence: 0.88,
        tier: 0,
        depth_estimate_m: 0.0,
        evidence: Evidence {
            snr: 3.5,
            path_support: 0.55,
            class_margin: 0.3,
            wall_support: 0.15,
            reasons: vec!["dta_hint_tunnel".into()],
        },
        geometry: geom,
        outline: Vec::new(),
    })
}

fn build_hint_metal(
    cx: f32,
    cy: f32,
    rx: f32,
    ry: f32,
    map_w_m: f32,
    map_d_m: f32,
    depth_range_m: f32,
    side: bool,
    label: String,
) -> MetalBody {
    let width_m = (rx * 2.0 * map_w_m).clamp(0.4, 4.0);
    let (length_m, plume, depth_m) = if side {
        let plume = 0.45f32;
        let along = (ry * 2.0 * map_d_m).clamp(0.35, 2.0);
        let e = super::build::surface_emergence(0.7, 0.5);
        let depth_m = super::build::burial_from_emergence(e, 0.2, depth_range_m * 0.35);
        (along, plume, depth_m)
    } else {
        let length_m = (ry * 2.0 * map_d_m).max(0.35);
        let e = super::build::surface_emergence(0.7, 0.5);
        let depth_m = super::build::burial_from_emergence(e, 0.25, depth_range_m * 0.28);
        (length_m, 0.45, depth_m)
    };
    let mut geom = crate::surface::GeometryAnalysis::default();
    geom.method = "dta_hint".into();
    geom.label = label;
    MetalBody {
        cx,
        cy,
        rx,
        ry,
        depth: (depth_m / depth_range_m).clamp(0.02, 0.95),
        intensity: 0.7,
        width_m,
        length_m,
        size_m: width_m.min(length_m),
        depth_from_surface_m: depth_m,
        inside_chamber: false,
        host_kind: String::new(),
        spread_m: width_m.max(length_m) * 0.5,
        spread_ratio: 1.0,
        field_strength: 0.7,
        bearing_deg: 0.0,
        plume_height_m: plume,
        cue_kind: "field".into(),
        metal_guess: String::new(),
        confidence: 0.85,
        tier: 0,
        depth_estimate_m: 0.0,
        evidence: Evidence {
            snr: 3.0,
            path_support: 0.4,
            class_margin: 0.25,
            wall_support: 0.0,
            reasons: vec!["dta_hint_metal".into()],
        },
        geometry: geom,
    }
}

/// DTA analizinin tespit ettiği yapıları StructureHint listesine çevir.
/// Bu ipuçları 3D haritada göstermek için kullanılır.
pub fn structures_to_hints(
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    metals: &[MetalBody],
) -> Vec<StructureHint> {
    let mut hints = Vec::new();

    // Odaları ipuca çevir
    for (i, ch) in chambers.iter().enumerate() {
        let kind = match ch.kind.as_str() {
            "tomb" | "mezar" => "tomb".to_string(),
            "shaft" | "kuyu" => "shaft".to_string(),
            _ => "room".to_string(),
        };
        let label = if ch.geometry.label.is_empty() {
            format!("{} #{} (güven: {:.0}%)", ch.kind, i + 1, ch.confidence * 100.0)
        } else {
            ch.geometry.label.clone()
        };
        hints.push(StructureHint {
            kind,
            cx: ch.cx.clamp(0.02, 0.98),
            cy: ch.cy.clamp(0.02, 0.98),
            rx: ch.rx.clamp(0.02, 0.25),
            ry: ch.ry.clamp(0.02, 0.25),
            label,
        });
    }

    // Tülleri ipuca çevir
    for (i, t) in tunnels.iter().enumerate() {
        let cx = ((t.x0 + t.x1) * 0.5).clamp(0.02, 0.98);
        let cy = ((t.y0 + t.y1) * 0.5).clamp(0.02, 0.98);
        let rx = ((t.x1 - t.x0).abs() * 0.5).clamp(0.02, 0.25);
        let ry = ((t.y1 - t.y0).abs() * 0.5).clamp(0.02, 0.25);
        let label = if t.geometry.label.is_empty() {
            format!("Tünel #{} (güven: {:.0}%, {})", i + 1, t.confidence * 100.0, t.heading)
        } else {
            t.geometry.label.clone()
        };
        hints.push(StructureHint {
            kind: "tunnel".to_string(),
            cx,
            cy,
            rx,
            ry,
            label,
        });
    }

    // Metal adresleri ipuca çevir
    for (i, m) in metals.iter().enumerate() {
        let label = if m.metal_guess.is_empty() {
            format!("Metal #{} (güven: {:.0}%)", i + 1, m.confidence * 100.0)
        } else {
            format!("{} #{} (güven: {:.0}%)", m.metal_guess, i + 1, m.confidence * 100.0)
        };
        hints.push(StructureHint {
            kind: "metal".to_string(),
            cx: m.cx.clamp(0.02, 0.98),
            cy: m.cy.clamp(0.02, 0.98),
            rx: m.rx.clamp(0.02, 0.25),
            ry: m.ry.clamp(0.02, 0.25),
            label,
        });
    }

    hints
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structures_to_hints_converts_chambers() {
        let chambers = vec![Chamber {
            kind: "room".into(),
            cx: 0.5,
            cy: 0.5,
            rx: 0.08,
            ry: 0.06,
            confidence: 0.85,
            geometry: crate::surface::GeometryAnalysis {
                label: "Oda #1".into(),
                ..Default::default()
            },
            ..Default::default()
        }];
        let hints = structures_to_hints(&chambers, &[], &[]);
        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].kind, "room");
        assert!(hints[0].label.contains("Oda"));
    }

    #[test]
    fn structures_to_hints_converts_tunnels() {
        let tunnels = vec![Tunnel {
            x0: 0.2,
            y0: 0.5,
            x1: 0.8,
            y1: 0.5,
            confidence: 0.78,
            heading: "Doğu".into(),
            geometry: crate::surface::GeometryAnalysis {
                label: "Koridor".into(),
                ..Default::default()
            },
            ..Default::default()
        }];
        let hints = structures_to_hints(&[], &tunnels, &[]);
        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].kind, "tunnel");
        assert!(hints[0].label.contains("Koridor"));
    }

    #[test]
    fn structures_to_hints_converts_metals() {
        let metals = vec![MetalBody {
            cx: 0.6,
            cy: 0.4,
            rx: 0.05,
            ry: 0.04,
            confidence: 0.92,
            metal_guess: "Au/Ag".into(),
            depth: 0.5,
            intensity: 0.7,
            width_m: 1.0,
            length_m: 1.5,
            size_m: 1.0,
            depth_from_surface_m: 3.0,
            inside_chamber: false,
            host_kind: String::new(),
            spread_m: 0.5,
            spread_ratio: 1.0,
            field_strength: 0.7,
            bearing_deg: 0.0,
            plume_height_m: 0.45,
            cue_kind: "field".into(),
            tier: 0,
            depth_estimate_m: 0.0,
            evidence: Evidence {
                snr: 3.0,
                path_support: 0.4,
                class_margin: 0.25,
                wall_support: 0.0,
                reasons: vec![],
            },
            geometry: crate::surface::GeometryAnalysis::default(),
        }];
        let hints = structures_to_hints(&[], &[], &metals);
        assert_eq!(hints.len(), 1);
        assert_eq!(hints[0].kind, "metal");
        assert!(hints[0].label.contains("Au/Ag"));
    }
}
