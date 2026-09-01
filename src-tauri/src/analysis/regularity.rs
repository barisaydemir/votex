//! Regularity helpers: rectangularity, elongation, circularity, corridor.

/// Dikdörtgene yakınlık ≈ fill_ratio (0–1).
pub fn rectangularity(fill_ratio: f32) -> f32 {
    fill_ratio.clamp(0.0, 1.0)
}

/// Plan uzaması w/l.
pub fn elongation_wh(width_m: f32, length_m: f32) -> f32 {
    let a = width_m.max(1e-3);
    let b = length_m.max(1e-3);
    (a.max(b) / a.min(b)).max(1.0)
}

/// Dairesellik: 1 − CV(yarıçaplar).
pub fn circularity_from_radii(radii: &[f32]) -> f32 {
    if radii.len() < 6 {
        return 0.0;
    }
    let n = radii.len() as f32;
    let mean = radii.iter().sum::<f32>() / n;
    if mean < 1e-6 {
        return 0.0;
    }
    let var = radii.iter().map(|r| (r - mean).powi(2)).sum::<f32>() / n;
    let cv = var.sqrt() / mean;
    (1.0 - cv).clamp(0.0, 1.0)
}

/// Koridor enine genişlik kararlılığı: 1 − CV(w).
pub fn corridor_stability(widths: &[f32]) -> f32 {
    if widths.len() < 4 {
        return 0.0;
    }
    let n = widths.len() as f32;
    let mean = widths.iter().sum::<f32>() / n;
    if mean < 1e-6 {
        return 0.0;
    }
    let var = widths.iter().map(|w| (w - mean).powi(2)).sum::<f32>() / n;
    let cv = var.sqrt() / mean;
    (1.0 - cv * 0.85).clamp(0.0, 1.0)
}

pub fn label_for(method: &str, score: f32) -> String {
    let pct = (score * 100.0).round() as i32;
    match method {
        "bilateral" => {
            if score >= 0.75 {
                format!("Plan simetrisi yüksek (%{pct})")
            } else if score >= 0.55 {
                format!("Plan simetrisi orta (%{pct})")
            } else {
                format!("Plan asimetrik (%{pct})")
            }
        }
        "radial" => {
            if score >= 0.75 {
                format!("Kuyu profili dairesel (%{pct})")
            } else if score >= 0.55 {
                format!("Kuyu / şaft daireselliği orta (%{pct})")
            } else {
                format!("Dairesellik düşük (%{pct})")
            }
        }
        "axial" => {
            if score >= 0.75 {
                format!("Koridor düzenli (%{pct})")
            } else if score >= 0.55 {
                format!("Koridor kısmen düzenli (%{pct})")
            } else {
                format!("Koridor düzensiz (%{pct})")
            }
        }
        _ => {
            if score >= 0.7 {
                format!("Kompakt düzenli (%{pct})")
            } else {
                format!("Kompaktlık orta (%{pct})")
            }
        }
    }
}

/// Kırmızı ipucu + metal varsayımı + konuk yapı etiketi.
pub fn label_metal_placement(
    cue_kind: &str,
    host_kind: &str,
    metal_guess: &str,
    score: f32,
) -> String {
    let pct = (score * 100.0).round() as i32;
    let host = match host_kind {
        "room" => " · oda içi",
        "tomb" => " · mezar içi",
        "shaft" => " · kuyu içi",
        "tunnel" => " · tünel içi",
        _ => "",
    };
    let guess = match metal_guess {
        "au_ag_fe" => " · Au/Ag/Fe varsayımı",
        "iron" => " · demir varsayımı",
        _ => "",
    };
    let base = match cue_kind {
        "metal" => {
            if metal_guess == "au_ag_fe" {
                format!("Güçlü metal merkezi (%{pct})")
            } else {
                format!("Ferromanyetik metal (%{pct})")
            }
        }
        "oxidation" => format!("Oksitlenme izi (%{pct})"),
        "surface_exit" => {
            // Host varsa yapı içi; yoksa pozitif alan çıkışı (eski “fışkırma” tabiri kaldırıldı)
            if matches!(host_kind, "room" | "tomb" | "shaft" | "tunnel") {
                format!("Yapı içi manyetik anomali (%{pct})")
            } else {
                format!("Pozitif alan çıkışı (%{pct})")
            }
        }
        _ => format!("Manyetik alan yayılımı (%{pct})"),
    };
    format!("{base}{guess}{host}")
}
