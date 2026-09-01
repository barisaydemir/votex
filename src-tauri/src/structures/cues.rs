//! Beyaz duvar / nötr zarf (yapı çevresi) + kırmızı pozitif ipucu sınıfları.
//!
//! Renk öğretisi:
//! - kırmızı = pozitif (metal) → yapı içi dolgu, tünel çıkışı veya yapıda metal olabilir
//! - mavi = negatif (boşluk) → oda / tünel adayı; kırmızı yanında diye silinmez
//! - beyaza yakın = yoğun nötr zarf → oda/tünel güçlenir
//! - yeşil = önünde engel yok, toprak; yapı yok demek değildir

use crate::preprocess::WallCue;

use super::types_local::Blob;

/// Blob çevresindeki beyaz / nötr zarf desteği (0–1) — oda/tünel güçlendirici.
pub fn wall_ring_support(b: &Blob, walls: &[WallCue]) -> f32 {
    wall_ring_support_with_clarity(b, walls).0
}

/// Blob çevresindeki beyaz / nötr zarf desteği (0–1) + duvar netliği (0–1).
/// wall_clarity: güçlü duvar vuruşlarının toplam vuruşa oranı.
///   - ≥ 0.6: net, keskin duvarlar (gerçek oda)
///   - < 0.3: bulanık, dağınık lekeler (dolgu alanı olabilir)
pub fn wall_ring_support_with_clarity(b: &Blob, walls: &[WallCue]) -> (f32, f32) {
    if walls.is_empty() {
        return (0.0, 0.0);
    }
    let n = 48;
    let mut hit = 0u32;
    let mut weight = 0.0f32;
    let mut strong_hits = 0u32; // strength ≥ 0.5 olan vuruşlar
    let rx = b.rx.max(0.012) * 1.22;
    let ry = b.ry.max(0.012) * 1.22;
    let tol = ((rx + ry) * 0.48).clamp(0.032, 0.11);
    for i in 0..n {
        let ang = std::f32::consts::TAU * i as f32 / n as f32;
        let px = b.cx + rx * ang.cos();
        let py = b.cy + ry * ang.sin();
        let mut best = 0.0f32;
        for w in walls {
            let dx = w.x - px;
            let dy = w.y - py;
            if dx * dx + dy * dy > tol * tol {
                continue;
            }
            let s = if w.green_line {
                w.strength * 0.85
            } else {
                w.strength.max(0.35)
            };
            best = best.max(s);
        }
        if best > 0.0 {
            hit += 1;
            weight += best;
            if best >= 0.5 {
                strong_hits += 1;
            }
        }
    }
    let cover = hit as f32 / n as f32;
    let strength = (weight / n as f32).clamp(0.0, 1.0);
    let support = (cover * 0.55 + strength * 0.55).clamp(0.0, 1.0);
    // Duvar netliği: güçlü vuruşların oranı (0–1)
    let clarity = if hit > 0 {
        strong_hits as f32 / hit as f32
    } else {
        0.0
    };
    (support, clarity)
}

/// Duvar ipuçlarından plan bbox — yalnızca blob çevresindeki noktalar.
pub fn wall_bounds_around(b: &Blob, walls: &[WallCue]) -> Option<(f32, f32, f32, f32)> {
    let y_lo = (b.cy - b.ry * 1.55).clamp(0.0, 1.0);
    let y_hi = (b.cy + b.ry * 1.55).clamp(0.0, 1.0);
    let x_lo = (b.cx - b.rx * 1.55).clamp(0.0, 1.0);
    let x_hi = (b.cx + b.rx * 1.55).clamp(0.0, 1.0);
    let mut xs = Vec::new();
    let mut ys = Vec::new();
    for w in walls {
        if w.x >= x_lo && w.x <= x_hi && w.y >= y_lo && w.y <= y_hi {
            xs.push(w.x);
            ys.push(w.y);
        }
    }
    if xs.len() < 3 {
        return None;
    }
    let min_x = xs.iter().cloned().fold(1.0f32, f32::min);
    let max_x = xs.iter().cloned().fold(0.0f32, f32::max);
    let min_y = ys.iter().cloned().fold(1.0f32, f32::min);
    let max_y = ys.iter().cloned().fold(0.0f32, f32::max);
    if max_x - min_x < 0.015 || max_y - min_y < 0.012 {
        return None;
    }
    Some((min_x, min_y, max_x, max_y))
}

/// Blob eksenine hizalı yeşil-içı beyaz çizgi desteği (0–1) → tünel.
/// Yeşil zemin = toprak; çizgi void yanında da yapı ipucu olabilir.
pub fn green_line_tunnel_support(b: &Blob, walls: &[WallCue]) -> f32 {
    let lines: Vec<_> = walls.iter().filter(|w| w.green_line).collect();
    if lines.len() < 2 {
        return 0.0;
    }
    let (dx, dy, hl) = if b.half_len > 0.02 && b.axis_aspect >= 1.2 {
        (b.dir_x, b.dir_y, b.half_len.max(b.rx.max(b.ry)))
    } else if b.rx >= b.ry {
        (1.0, 0.0, b.rx)
    } else {
        (0.0, 1.0, b.ry)
    };
    let tol = ((b.rx + b.ry) * 0.55).clamp(0.035, 0.12);
    let mut hit = 0u32;
    let mut strength_sum = 0.0f32;
    let n = 28;
    for i in 0..n {
        let t = (i as f32 / (n - 1) as f32) * 2.0 - 1.0;
        let px = b.cx + dx * hl * t;
        let py = b.cy + dy * hl * t;
        let mut best = 0.0f32;
        for w in &lines {
            let ddx = w.x - px;
            let ddy = w.y - py;
            if ddx * ddx + ddy * ddy <= tol * tol {
                best = best.max(w.strength.max(0.4));
            }
        }
        if best > 0.0 {
            hit += 1;
            strength_sum += best;
        }
    }
    let cover = hit as f32 / n as f32;
    let strength = (strength_sum / n as f32).clamp(0.0, 1.0);
    (cover * 0.6 + strength * 0.5).clamp(0.0, 1.0)
}

/// Boşluğa komşu mu? (yapı içi metal / tünel çıkışı / duvar teması)
pub fn near_void_blob(b: &Blob, voids: &[Blob]) -> bool {
    voids.iter().any(|v| {
        let dx = (b.cx - v.cx) / (b.rx + v.rx + 0.02).max(1e-3);
        let dy = (b.cy - v.cy) / (b.ry + v.ry + 0.02).max(1e-3);
        dx * dx + dy * dy < 2.2
    })
}

/// Kırmızı blob, mavi boşluğa komşu mu? (silme nedeni değil — bağ / dolgu ipucu)
pub fn near_metal_blob(b: &Blob, metals: &[Blob]) -> bool {
    metals.iter().any(|m| {
        let dx = (b.cx - m.cx) / (b.rx + m.rx + 0.02).max(1e-3);
        let dy = (b.cy - m.cy) / (b.ry + m.ry + 0.02).max(1e-3);
        dx * dx + dy * dy < 2.4
    })
}

/// Eski dipol silme kapısı — kırmızı komşuluk artık yapı silmez (geriye uyum).
#[allow(dead_code)]
pub fn is_side_dipole_lobe(
    _b: &Blob,
    _metals: &[Blob],
    _wall_s: f32,
    _depth_range_m: f32,
) -> bool {
    false
}

/// Kırmızı / beyaz-sıcak anomali yorumu.
#[derive(Debug, Clone)]
pub struct RedCueInterp {
    /// metal | oxidation | surface_exit | field
    pub cue: &'static str,
    /// "" | iron | au_ag_fe — güçlü merkez varsayımı
    pub metal_guess: &'static str,
    /// Kısa Türkçe yorum
    pub label: String,
}

/// Pozitif fışkırma halkası (beyaza varan çıkışlar) blob çevresinde mi?
pub fn positive_bloom_ring(
    b: &Blob,
    signed: &[f32],
    w: u32,
    h: u32,
    walls: &[WallCue],
) -> f32 {
    let n = 28;
    let rx = b.rx.max(0.015) * 1.35;
    let ry = b.ry.max(0.015) * 1.35;
    let mut hot = 0u32;
    for i in 0..n {
        let ang = std::f32::consts::TAU * i as f32 / n as f32;
        let px = (b.cx + rx * ang.cos()).clamp(0.0, 1.0);
        let py = (b.cy + ry * ang.sin()).clamp(0.0, 1.0);
        let gx = (px * (w - 1) as f32).round() as i32;
        let gy = (py * (h - 1) as f32).round() as i32;
        if gx < 0 || gy < 0 || gx >= w as i32 || gy >= h as i32 {
            continue;
        }
        let v = signed[(gy as u32 * w + gx as u32) as usize];
        if v >= 0.62 {
            hot += 1;
        }
    }
    let field_ring = hot as f32 / n as f32;
    // Beyaz ipucu noktaları (alan zirvesi / fışkırma) blob halkasında
    let _tol = ((rx + ry) * 0.4).clamp(0.03, 0.1);
    let mut wh = 0u32;
    let mut wn = 0u32;
    for c in walls {
        let dx = (c.x - b.cx) / rx.max(1e-3);
        let dy = (c.y - b.cy) / ry.max(1e-3);
        let d2 = dx * dx + dy * dy;
        if d2 < 0.55 || d2 > 2.8 {
            continue;
        }
        wn += 1;
        if c.strength >= 0.35 && !c.green_line {
            wh += 1;
        }
    }
    let cue_ring = if wn > 0 {
        wh as f32 / wn as f32
    } else {
        0.0
    };
    (field_ring * 0.65 + cue_ring * 0.45).clamp(0.0, 1.0)
}

/// Kırmızı merkez + çevrede beyaz/nötr zarf → metal / yapı içi / tünel çıkışı.
/// Yoğun kırmızı ≠ “çok derin”; yapı dolgusu veya çıkış olabilir.
/// Güçlü kompakt / yüksek yoğunluk → Au/Ag/Fe varsayımı; tünel yanında da korunur.
pub fn interpret_red_cue(
    b: &Blob,
    side: bool,
    depth_m: f32,
    depth_range_m: f32,
    near_void: bool,
    white_bloom: f32,
) -> RedCueInterp {
    let aspect = (b.rx / b.ry.max(1e-3)).max(b.ry / b.rx.max(1e-3));
    let compact = b.fill_ratio >= 0.42 && aspect < 1.9;
    let depth_frac = (depth_m / depth_range_m.max(1e-3)).clamp(0.0, 1.0);
    let shallow = if side {
        b.cy < 0.38
    } else {
        depth_frac < 0.28
    };
    let strong_core = compact && b.intensity >= 0.52;
    let very_strong = b.intensity >= 0.68 && (compact || b.fill_ratio >= 0.38);
    let bloom = white_bloom >= 0.18;
    let in_cavity = near_void || (bloom && white_bloom >= 0.28);

    let metal_guess_for = |intensity: f32| -> &'static str {
        if intensity >= 0.68 {
            "au_ag_fe"
        } else if intensity >= 0.52 {
            "iron"
        } else if intensity >= 0.4 {
            "iron"
        } else {
            ""
        }
    };

    // 1) Güçlü merkez ÖNCE — yapı/tünel yanında da Au/Ag/Fe kaybolmasın
    if strong_core || very_strong {
        let metal_guess = metal_guess_for(b.intensity);
        let mut label = if metal_guess == "au_ag_fe" {
            "Güçlü metal merkezi — altın / gümüş / demir varsayımı".to_string()
        } else {
            "Ferromanyetik metal merkezi — demir varsayımı".to_string()
        };
        if in_cavity {
            label.push_str(" · oda/tünel içinde dolgu olabilir");
        }
        if bloom {
            label.push_str(" · çevrede beyaz/nötr zarf");
        }
        return RedCueInterp {
            cue: "metal",
            metal_guess,
            label,
        };
    }

    // 2) Boşluk/oda yanında uzamış kırmızı → tünel çıkışı / koridor; yoğunsa yine metal
    if near_void && aspect >= 1.75 {
        let guess = metal_guess_for(b.intensity);
        if guess == "au_ag_fe" || (guess == "iron" && b.intensity >= 0.55 && b.fill_ratio >= 0.4) {
            let mut label = if guess == "au_ag_fe" {
                "Güçlü metal — altın / gümüş / demir · yapı/tünel ilişkili".to_string()
            } else {
                "Ferromanyetik metal — demir · yapı/tünel ilişkili".to_string()
            };
            if bloom {
                label.push_str(" · pozitif zarf");
            }
            return RedCueInterp {
                cue: "metal",
                metal_guess: guess,
                label,
            };
        }
        return RedCueInterp {
            cue: "surface_exit",
            metal_guess: guess,
            label: "Tünel/çıkış veya koridor dolgusu — pozitif alan yapıyla ilişkili".into(),
        };
    }

    // 3) Boşluk yanında yayılmış kırmızı → yapı içi / kenar dolgusu
    if near_void {
        let guess = metal_guess_for(b.intensity);
        if compact && b.intensity >= 0.4 {
            let label = if guess == "au_ag_fe" {
                "Oda/tünel içi güçlü metal — altın / gümüş / demir".into()
            } else {
                "Oda/tünel içi metal veya dolgu — demir varsayımı".into()
            };
            return RedCueInterp {
                cue: "metal",
                metal_guess: if guess.is_empty() { "iron" } else { guess },
                label,
            };
        }
        let label = if bloom {
            "Yapı içi veya kenar pozitif alan — beyaz/nötr zarfla".to_string()
        } else {
            "Yapı ile ilişkili pozitif alan — oda/tünel dolgusu veya çıkış".to_string()
        };
        return RedCueInterp {
            cue: "oxidation",
            metal_guess: "",
            label,
        };
    }

    // 4) Beyaza varan yoğun pozitif çıkış (kompakt merkez yok)
    if bloom || (shallow && b.intensity >= 0.4) || b.intensity >= 0.75 {
        let guess = metal_guess_for(b.intensity);
        // Çok yoğun bağımsız pik → metal (Au/Ag/Fe), sadece zayıf bloom = çıkış
        if b.intensity >= 0.68 {
            return RedCueInterp {
                cue: "metal",
                metal_guess: "au_ag_fe",
                label: "Güçlü metal merkezi — altın / gümüş / demir varsayımı".into(),
            };
        }
        return RedCueInterp {
            cue: "surface_exit",
            metal_guess: guess,
            label: "Yoğun pozitif alan çıkışı (beyaza varan) — tünel ağzı olabilir".into(),
        };
    }

    if aspect >= 1.9 || b.fill_ratio < 0.42 {
        return RedCueInterp {
            cue: "oxidation",
            metal_guess: "",
            label: "Yayılmış pozitif alan / oksitlenme".into(),
        };
    }

    RedCueInterp {
        cue: "field",
        metal_guess: "",
        label: "Pozitif manyetik alan".into(),
    }
}

/// Geriye uyumlu sarmalayıcı.
#[allow(dead_code)]
pub fn classify_red_cue(
    b: &Blob,
    side: bool,
    depth_m: f32,
    depth_range_m: f32,
    near_void: bool,
) -> &'static str {
    interpret_red_cue(b, side, depth_m, depth_range_m, near_void, 0.0).cue
}

#[cfg(test)]
mod red_interp_tests {
    use super::*;
    use crate::structures::types_local::Blob;

    fn blob(intensity: f32, fill: f32, aspect_rx: f32, aspect_ry: f32) -> Blob {
        Blob {
            cx: 0.5,
            cy: 0.5,
            rx: aspect_rx,
            ry: aspect_ry,
            intensity,
            max_intensity: intensity,
            area_px: 80,
            fill_ratio: fill,
            dir_x: 1.0,
            dir_y: 0.0,
            half_len: aspect_rx,
            axis_aspect: (aspect_rx / aspect_ry).max(aspect_ry / aspect_rx),
            outline: Vec::new(),
        }
    }

    #[test]
    fn strong_core_guesses_au_ag_fe() {
        let b = blob(0.82, 0.6, 0.06, 0.05);
        let i = interpret_red_cue(&b, false, 2.0, 10.0, true, 0.35);
        assert_eq!(i.cue, "metal");
        assert_eq!(i.metal_guess, "au_ag_fe");
        assert!(i.label.contains("altın") || i.label.contains("Au"));
        assert!(i.label.contains("oda") || i.label.contains("tünel") || i.label.contains("içinde"));
    }

    #[test]
    fn elongated_near_void_strong_keeps_au_ag_fe() {
        // Eski hata: aspect≥1.75 + near_void → surface_exit + iron (altın kayboluyordu)
        let b = blob(0.83, 0.5, 0.12, 0.05);
        let i = interpret_red_cue(&b, false, 0.8, 15.0, true, 0.25);
        assert_eq!(i.cue, "metal");
        assert_eq!(i.metal_guess, "au_ag_fe");
        assert!(i.label.contains("altın") || i.label.contains("Au") || i.label.contains("gümüş"));
    }

    #[test]
    fn bloom_near_void_is_oxidation_or_cavity_metal() {
        let b = blob(0.4, 0.35, 0.12, 0.05);
        let i = interpret_red_cue(&b, false, 3.0, 10.0, true, 0.4);
        assert!(
            i.cue == "oxidation" || i.cue == "metal" || i.cue == "surface_exit",
            "near-void red = fill/exit, got {}",
            i.cue
        );
    }

    #[test]
    fn compact_near_void_is_cavity_metal() {
        let b = blob(0.45, 0.5, 0.06, 0.055);
        let i = interpret_red_cue(&b, false, 2.0, 10.0, true, 0.3);
        assert!(
            i.cue == "metal" || i.cue == "oxidation",
            "compact near void = cavity fill, got {}",
            i.cue
        );
    }
}
