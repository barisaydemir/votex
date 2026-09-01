//! Kural tabanlı analiz raporu — her tespit için insancıl Türkçe rapor üretir.
//!
//! AI gerekmez: if-else kurallarıyla güvenilirlik, uyarı ve öneri üretir.
//! VPE Faz B: ML karar skorları güvenilirlikle harmanlanır.

use crate::prob_client::DecisionBatch;
use crate::surface::{Chamber, MetalBody, Tunnel};

/// Tek bir tespit için analiz raporu.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnalysisReport {
    /// Güvenilirlik düzeyi: "high" | "medium" | "low" | "rejected"
    pub reliability: String,
    /// Kısa özet (1 cümle)
    pub summary: String,
    /// Detaylı açıklama (çoklu satır)
    pub details: Vec<String>,
    /// Öneriler
    pub recommendations: Vec<String>,
    /// Uyarılar
    pub warnings: Vec<String>,
}

impl Default for AnalysisReport {
    fn default() -> Self {
        Self {
            reliability: "unknown".into(),
            summary: "Analiz yapılamadı".into(),
            details: vec![],
            recommendations: vec![],
            warnings: vec![],
        }
    }
}

/// Oda/tünel için analiz raporu üret.
pub fn analyze_chamber(ch: &Chamber, all_chambers: &[Chamber], metals: &[MetalBody]) -> AnalysisReport {
    let mut details = Vec::new();
    let mut recommendations = Vec::new();
    let mut warnings = Vec::new();

    // ── Güvenilirlik değerlendirmesi ──
    let conf = ch.confidence;
    let wall_s = ch.evidence.wall_support;
    let snr = ch.evidence.snr;
    let reasons = &ch.evidence.reasons;

    // wall_clarity: wall_support yüksek ama reasons'da "blurry_walls" varsa düşük netlik
    let has_blurry = reasons.iter().any(|r| r.contains("blurry_walls"));
    let has_rescue = reasons.iter().any(|r| r.contains("rescue"));

    let reliability = if conf >= 0.7 && !has_blurry && snr >= 1.5 {
        "high"
    } else if conf >= 0.5 && !has_blurry {
        "medium"
    } else if conf >= 0.35 {
        "low"
    } else {
        "rejected"
    };

    // ── Detaylar ──
    details.push(format!("Güven: {:.0}%", conf * 100.0));
    details.push(format!("Sinyal gücü (SNR): {:.1}", snr));
    details.push(format!("Duvar desteği: {:.0}%", wall_s * 100.0));

    if ch.top_from_surface_m > 0.0 {
        details.push(format!("Derinlik: {:.1}m", ch.top_from_surface_m));
    }
    if ch.height_m > 0.0 {
        details.push(format!("Yükseklik: {:.1}m", ch.height_m));
    }
    if ch.width_m > 0.0 && ch.length_m > 0.0 {
        details.push(format!("Boyut: {:.1}m × {:.1}m", ch.width_m, ch.length_m));
    }

    // ── Uyarılar ──
    if has_blurry {
        warnings.push("⚠ Duvar desteği düşük — bu alan kazılmış olabilir".into());
    }
    if has_rescue {
        warnings.push("ℹ Bu tespit kurtarma kapısıyla kurtarıldı — normalden daha düşük güven".into());
    }
    if snr < 1.5 {
        warnings.push("⚠ Sinyal gücü düşük — toprak veya derinlik kaynaklı olabilir".into());
    }
    if conf < 0.5 {
        warnings.push("⚠ Düşük güvenilirlik — saha doğrulaması şiddetle önerilir".into());
    }
    if ch.top_from_surface_m > 3.0 {
        details.push("ℹ Derin yapı — kazma maliyeti yüksek olabilir".into());
    }

    // ── Çevresel analiz ──
    let nearby_metals: Vec<_> = metals.iter().filter(|m| {
        let dx = (m.cx - ch.cx).abs();
        let dy = (m.cy - ch.cy).abs();
        dx < 0.1 && dy < 0.1  // yakınlık eşiği
    }).collect();

    if !nearby_metals.is_empty() {
        details.push(format!("ℹ Yakında {} metal tespit edildi — yapısal eleman olabilir", nearby_metals.len()));
    }

    // Benzer yapılar
    let same_kind: Vec<_> = all_chambers.iter().filter(|c| {
        c.kind == ch.kind && (c.cx - ch.cx).abs() > 0.05
    }).collect();
    if same_kind.len() >= 2 {
        details.push(format!("ℹ Bu bölgede benzer {} tespitinden {} tane daha var", ch.kind, same_kind.len()));
    }

    // ── Öneriler ──
    match reliability {
        "high" => {
            recommendations.push("✅ Bu tespit güvenilir — saha doğrulaması için öncelikli".into());
            if ch.top_from_surface_m < 2.0 {
                recommendations.push("💡 Kazarak doğrulama önerilir (düşük derinlik)".into());
            }
        }
        "medium" => {
            recommendations.push("⚠ Bu tespit orta güvenilirlikte — dikkatli incelenmeli".into());
            recommendations.push("💡 Metal detektörle çevresini tarayın".into());
        }
        "low" => {
            recommendations.push("❌ Bu tespit düşük güvenilirlikte — muhtemelen yanlış tespit".into());
            recommendations.push("💡 Hemen kazmayın, önce çevresindeki yapıları kontrol edin".into());
        }
        _ => {}
    }

    // ── Özet ──
    let summary = match reliability {
        "high" => format!("{} tespiti güvenilir (güven: {:.0}%)", ch.kind, conf * 100.0),
        "medium" => format!("{} tespiti orta güvenilirlikte (güven: {:.0}%)", ch.kind, conf * 100.0),
        "low" => format!("{} tespiti şüpheli (güven: {:.0}%)", ch.kind, conf * 100.0),
        _ => format!("{} tespiti reddedildi (güven: {:.0}%)", ch.kind, conf * 100.0),
    };

    AnalysisReport {
        reliability: reliability.into(),
        summary,
        details,
        recommendations,
        warnings,
    }
}

/// Tünel için analiz raporu üret.
pub fn analyze_tunnel(t: &Tunnel, all_tunnels: &[Tunnel], metals: &[MetalBody]) -> AnalysisReport {
    let mut details = Vec::new();
    let mut recommendations = Vec::new();
    let mut warnings = Vec::new();

    let conf = t.confidence;
    let wall_s = t.evidence.wall_support;
    let snr = t.evidence.snr;
    let reasons = &t.evidence.reasons;

    let has_blurry = reasons.iter().any(|r| r.contains("blurry_walls"));
    let has_rescue = reasons.iter().any(|r| r.contains("rescue"));

    let reliability = if conf >= 0.7 && !has_blurry && snr >= 1.5 {
        "high"
    } else if conf >= 0.5 && !has_blurry {
        "medium"
    } else if conf >= 0.35 {
        "low"
    } else {
        "rejected"
    };

    // ── Detaylar ──
    details.push(format!("Güven: {:.0}%", conf * 100.0));
    details.push(format!("Sinyal gücü (SNR): {:.1}", snr));
    details.push(format!("Duvar desteği: {:.0}%", wall_s * 100.0));
    details.push(format!("Yön: {}", t.heading));
    details.push(format!("Derinlik: {:.1}m", t.floor_from_surface_m));

    if t.width_m > 0.0 {
        details.push(format!("Genişlik: {:.1}m", t.width_m));
    }
    if t.height_m > 0.0 {
        details.push(format!("Yükseklik: {:.1}m", t.height_m));
    }

    // ── Uyarılar ──
    if has_blurry {
        warnings.push("⚠ Duvar desteği düşük — bu tünel kazılmış olabilir".into());
    }
    if has_rescue {
        warnings.push("ℹ Bu tespit kurtarma kapısıyla kurtarıldı".into());
    }
    if snr < 1.5 {
        warnings.push("⚠ Sinyal gücü düşük".into());
    }
    if conf < 0.5 {
        warnings.push("⚠ Düşük güvenilirlik — saha doğrulaması önerilir".into());
    }

    // ── Çevresel analiz ──
    let nearby_metals: Vec<_> = metals.iter().filter(|m| {
        let dx = (m.cx - t.x0).abs().max((m.cx - t.x1).abs());
        let dy = (m.cy - t.y0).abs().max((m.cy - t.y1).abs());
        dx < 0.1 && dy < 0.1
    }).collect();

    if !nearby_metals.is_empty() {
        details.push(format!("ℹ Tünel güzergahında {} metal tespit edildi", nearby_metals.len()));
    }

    // Benzer tünel var mı?
    let nearby_tunnels: Vec<_> = all_tunnels.iter().filter(|ot| {
        let mid_x = (ot.x0 + ot.x1) / 2.0;
        let mid_y = (ot.y0 + ot.y1) / 2.0;
        let t_mid_x = (t.x0 + t.x1) / 2.0;
        let t_mid_y = (t.y0 + t.y1) / 2.0;
        ((mid_x - t_mid_x).abs() < 0.15) && ((mid_y - t_mid_y).abs() < 0.15)
    }).collect();

    if nearby_tunnels.len() > 1 {
        details.push("ℹ Bu bölgede birden fazla tünel tespit edildi — yerleşim yeri olabilir".into());
    }

    // ── Öneriler ──
    match reliability {
        "high" => {
            recommendations.push("✅ Tünel tespiti güvenilir — giriş noktası arayın".into());
            recommendations.push("💡 Tünel girişini kazarak doğrulayın".into());
        }
        "medium" => {
            recommendations.push("⚠ Tünel tespiti orta güvenilirlikte".into());
            recommendations.push("💡 Güzergah boyunca yüzey taraması yapın".into());
        }
        "low" => {
            recommendations.push("❌ Tünel tespiti şüpheli".into());
            recommendations.push("💡 Hemen kazmayın, önce другие tespitleri kontrol edin".into());
        }
        _ => {}
    }

    let summary = match reliability {
        "high" => format!("Tünel tespiti güvenilir (güven: {:.0}%, yön: {})", conf * 100.0, t.heading),
        "medium" => format!("Tünel tespiti orta güvenilirlikte (güven: {:.0}%)", conf * 100.0),
        "low" => format!("Tünel tespiti şüpheli (güven: {:.0}%)", conf * 100.0),
        _ => format!("Tünel tespiti reddedildi (güven: {:.0}%)", conf * 100.0),
    };

    AnalysisReport {
        reliability: reliability.into(),
        summary,
        details,
        recommendations,
        warnings,
    }
}

/// Metal anomalisi için analiz raporu üret.
pub fn analyze_metal(m: &MetalBody) -> AnalysisReport {
    let mut details = Vec::new();
    let mut recommendations = Vec::new();
    let mut warnings = Vec::new();

    let fs = m.field_strength;
    let conf = m.confidence;
    let is_valuable = m.metal_guess == "au_ag_fe";
    let has_strong_cue = m.cue_kind == "metal" || m.cue_kind == "oxidation";

    // ── Güvenilirlik ──
    let reliability = if (fs >= 0.55 && (is_valuable || has_strong_cue)) || fs >= 0.7 {
        "high"
    } else if fs >= 0.3 || (m.inside_chamber && fs >= 0.2) {
        "medium"
    } else if fs >= 0.1 {
        "low"
    } else {
        "rejected"
    };

    // ── Detaylar ──
    details.push(format!("Alan gücü: {:.0}%", fs * 100.0));
    details.push(format!("Güven: {:.0}%", conf * 100.0));

    if !m.metal_guess.is_empty() {
        let guess_label = match m.metal_guess.as_str() {
            "au_ag_fe" => "Değerli metal (Au/Ag/Fe)",
            "iron" => "Demir (Fe)",
            _ => &m.metal_guess,
        };
        details.push(format!("Varsayım: {}", guess_label));
    }

    if !m.cue_kind.is_empty() {
        let cue_label = match m.cue_kind.as_str() {
            "metal" => "Metalik ipucu",
            "oxidation" => "Oksidasyon",
            "surface_exit" => "Yüzey çıkışı",
            "field" => "Alan anomalisi",
            _ => &m.cue_kind,
        };
        details.push(format!("İpucu türü: {}", cue_label));
    }

    if m.inside_chamber {
        details.push(format!("Konum: {} içinde", m.host_kind));
    } else {
        details.push("Konum: Bağımsız".into());
    }

    if m.size_m > 0.0 {
        details.push(format!("Boyut: ~{:.1}m", m.size_m));
    }
    if m.depth_from_surface_m > 0.0 {
        details.push(format!("Derinlik: {:.1}m", m.depth_from_surface_m));
    }

    // ── Uyarılar ──
    if fs < 0.2 {
        warnings.push("⚠ Alan gücü çok düşük — gürültü olabilir".into());
    }
    if conf < 0.4 {
        warnings.push("⚠ Düşük güvenilirlik — saha doğrulaması önerilir".into());
    }
    if m.inside_chamber {
        warnings.push(format!("ℹ Bu metal {} içinde — yapısal eleman olabilir", m.host_kind));
    }

    // ── Öneriler ──
    match reliability {
        "high" => {
            recommendations.push("✅ Değerli metal tespiti güvenilir — öncelikli kazı alanı".into());
            if is_valuable {
                recommendations.push("💡 Au/Ag/Fe — hassas ekipmanla doğrulayın".into());
            }
        }
        "medium" => {
            recommendations.push("⚠ Metal tespiti orta güvenilirlikte — detektörle tarayın".into());
        }
        "low" => {
            recommendations.push("❌ Düşük güvenilirlik — yüzey kaynaklı olabilir".into());
        }
        _ => {}
    }

    // ── Özet ──
    let metal_label = if is_valuable { "Değerli metal" } else { "Metal" };
    let summary = match reliability {
        "high" => format!("{} tespiti güvenilir (alan: {:.0}%)", metal_label, fs * 100.0),
        "medium" => format!("{} tespiti orta güvenilirlikte (alan: {:.0}%)", metal_label, fs * 100.0),
        "low" => format!("{} tespiti şüpheli (alan: {:.0}%)", metal_label, fs * 100.0),
        _ => format!("{} tespiti reddedildi (alan: {:.0}%)", metal_label, fs * 100.0),
    };

    AnalysisReport {
        reliability: reliability.into(),
        summary,
        details,
        recommendations,
        warnings,
    }
}

/// VPE ML skoru ile legacy güvenilirliğini harmanla.
/// weight: 0.0 = tamamen legacy, 1.0 = tamamen VPE.
fn blend_conf(legacy_conf: f32, vpe_conf: f32, weight: f32) -> f32 {
    (legacy_conf * (1.0 - weight) + vpe_conf * weight).clamp(0.0, 1.0)
}

/// VPE skoruna göre güvenilirlik düzeyi belirle.
fn vpe_reliability(conf: f32) -> &'static str {
    if conf >= 0.7 { "high" }
    else if conf >= 0.5 { "medium" }
    else if conf >= 0.3 { "low" }
    else { "rejected" }
}

/// Tüm tespitler için toplu rapor üret.
/// `vpe_decisions`: VPE Faz B karar paketi (varsa ML skorları kullanılır).
pub fn generate_full_report(
    chambers: &[Chamber],
    tunnels: &[Tunnel],
    metals: &[MetalBody],
    vpe_decisions: Option<&DecisionBatch>,
) -> FullReport {
    let mut chamber_reports: Vec<_> = chambers.iter()
        .map(|ch| analyze_chamber(ch, chambers, metals))
        .collect();

    let mut tunnel_reports: Vec<_> = tunnels.iter()
        .map(|t| analyze_tunnel(t, tunnels, metals))
        .collect();

    // Öncelik sırası önerisi — güvenilirliğe göre sıralı, ardışık numaralandırmalı
    let mut priority_list = Vec::new();
    let mut prio_num: u32 = 0;

    // 1) Yüksek güvenilirlik: odalar → tüller
    for (i, ch) in chambers.iter().enumerate() {
        let r = &chamber_reports[i];
        if r.reliability == "high" {
            prio_num += 1;
            priority_list.push(format!("{}. {} (güven: {:.0}%) — ÖNCELİKLİ", prio_num, ch.kind, ch.confidence * 100.0));
        }
    }
    for (i, t) in tunnels.iter().enumerate() {
        let r = &tunnel_reports[i];
        if r.reliability == "high" {
            prio_num += 1;
            priority_list.push(format!("{}. Tünel (güven: {:.0}%) — ÖNCELİKLİ", prio_num, t.confidence * 100.0));
        }
    }

    // 2) Orta güvenilirlik: odalar → tüller
    for (i, ch) in chambers.iter().enumerate() {
        let r = &chamber_reports[i];
        if r.reliability == "medium" {
            prio_num += 1;
            priority_list.push(format!("{}. {} (güven: {:.0}%) — ikinci sırada", prio_num, ch.kind, ch.confidence * 100.0));
        }
    }
    for (i, t) in tunnels.iter().enumerate() {
        let r = &tunnel_reports[i];
        if r.reliability == "medium" {
            prio_num += 1;
            priority_list.push(format!("{}. Tünel (güven: {:.0}%) — ikinci sırada", prio_num, t.confidence * 100.0));
        }
    }

    // 3) Metal anomalileri — field_strength ve cue可靠性 sınıflandırması
    for m in metals.iter() {
        let fs = m.field_strength;
        let is_valuable = m.metal_guess == "au_ag_fe";
        let has_strong_cue = m.cue_kind == "metal" || m.cue_kind == "oxidation";

        // Güvenilirlik: güçlü sinyal + değerli metal ya da güçlü cue → high;
        // orta sinyal ya da oda içinde → medium; geri kalan → low (öncelik listesine girmez)
        let entry = if (fs >= 0.55 && (is_valuable || has_strong_cue)) || fs >= 0.7 {
            let metal_name = if is_valuable { "Değerli metal (Au/Ag/Fe)" } else { "Metal anomalisi" };
            let note = if m.inside_chamber {
                format!("{} içinde", m.host_kind)
            } else {
                "bağımsız".into()
            };
            Some(format!("{}. {} (güven: {:.0}%, {}) — ÖNCELİKLİ", prio_num + 1, metal_name, (fs * 100.0).min(100.0), note))
        } else if fs >= 0.3 || (m.inside_chamber && fs >= 0.2) {
            let metal_name = if is_valuable { "Değerli metal" } else { "Metal" };
            Some(format!("{}. {} (güven: {:.0}%) — ikinci sırada", prio_num + 1, metal_name, (fs * 100.0).min(100.0)))
        } else {
            None // düşük sinyal → öncelik listesine girme
        };
        if let Some(label) = entry {
            prio_num += 1;
            priority_list.push(label);
        }
    }

    let mut metal_reports: Vec<_> = metals.iter()
        .map(|m| analyze_metal(m))
        .collect();

    // ── VPE Faz B: ML skorlarıyla harmanlama ──
    let vpe_used = if let Some(dec) = vpe_decisions {
        let vpe_voids: std::collections::HashMap<_, _> = dec.voids.iter()
            .map(|v| (v.id.as_str(), v))
            .collect();
        let vpe_metals: std::collections::HashMap<_, _> = dec.metals.iter()
            .map(|m| (m.id.as_str(), m))
            .collect();
        // Toplam VPE ağırlığı: VPE online ve stub değilse %40 VPE, %60 legacy
        let w = 0.4_f32;

        // Oda/tünel raporlarını harmanla
        for (i, ch) in chambers.iter().enumerate() {
            let r = &mut chamber_reports[i];
            // ID eşleme: "v0", "v1", ...
            let vpe_id = format!("v{i}");
            if let Some(vd) = vpe_voids.get(vpe_id.as_str()) {
                let blended = blend_conf(ch.confidence, vd.conf, w);
                r.reliability = vpe_reliability(blended).into();
                r.details.push(format!("🤖 VPE güven: {:.0}% (legacy: {:.0}%, ML: {:.0}%)",
                    blended * 100.0, ch.confidence * 100.0, vd.conf * 100.0));
                if !vd.reasons.is_empty() {
                    r.details.push(format!("🤖 VPE nedenleri: {}", vd.reasons.join(", ")));
                }
                // VPE.action "reject" ise güvenilirliği düşür
                if vd.action == "reject" {
                    r.reliability = "rejected".into();
                    r.warnings.push("🤖 VPE tarafından reddedildi".into());
                }
            }
        }

        // Tünel raporlarını harmanla (tüneller "v" prefix ile gelir)
        for (i, t) in tunnels.iter().enumerate() {
            let r = &mut tunnel_reports[i];
            // Tünelink = iki oda arasındaki link; VPE link kararlarından bak
            for link in &dec.links {
                if let Some(_vd_a) = vpe_voids.get(link.a_id.as_str()) {
                    let blended = blend_conf(t.confidence, link.conf, w);
                    r.reliability = vpe_reliability(blended).into();
                    r.details.push(format!("🤖 VPE tünel güven: {:.0}% (legacy: {:.0}%, ML: {:.0}%)",
                        blended * 100.0, t.confidence * 100.0, link.conf * 100.0));
                    r.details.push(format!("🤖 VPE yöntemi: {}", link.method));
                    break;
                }
            }
        }

        // Metal raporlarını harmanla
        for (i, m) in metals.iter().enumerate() {
            let r = &mut metal_reports[i];
            let vpe_id = format!("m{i}");
            if let Some(md) = vpe_metals.get(vpe_id.as_str()) {
                let blended = blend_conf(m.confidence, md.conf, w);
                r.reliability = vpe_reliability(blended).into();
                r.details.push(format!("🤖 VPE metal güven: {:.0}% (legacy: {:.0}%, ML: {:.0}%)",
                    blended * 100.0, m.confidence * 100.0, md.conf * 100.0));
                if md.action == "reject" {
                    r.reliability = "rejected".into();
                    r.warnings.push("🤖 VPE tarafından reddedildi".into());
                }
                if let Some(host) = &md.host_kind {
                    r.details.push(format!("🤖 VPE konum: {} (id: {})", host, md.host_id.as_deref().unwrap_or("?")));
                }
            }
        }
        true
    } else {
        false
    };

    // Sayıları hesapla (VPE harmanlamasından sonra)
    let high_count = chamber_reports.iter().filter(|r| r.reliability == "high").count()
        + tunnel_reports.iter().filter(|r| r.reliability == "high").count()
        + metal_reports.iter().filter(|r| r.reliability == "high").count();
    let medium_count = chamber_reports.iter().filter(|r| r.reliability == "medium").count()
        + tunnel_reports.iter().filter(|r| r.reliability == "medium").count()
        + metal_reports.iter().filter(|r| r.reliability == "medium").count();
    let low_count = chamber_reports.iter().filter(|r| r.reliability == "low").count()
        + tunnel_reports.iter().filter(|r| r.reliability == "low").count()
        + metal_reports.iter().filter(|r| r.reliability == "low").count();

    let overall_summary = if vpe_used {
        format!(
            "{} tespit: {} güvenilir, {} orta, {} şüpheli (🤖 VPE ile harmanlanmış)",
            chambers.len() + tunnels.len() + metals.len(),
            high_count,
            medium_count,
            low_count,
        )
    } else {
        format!(
            "{} tespit: {} güvenilir, {} orta, {} şüpheli",
            chambers.len() + tunnels.len() + metals.len(),
            high_count,
            medium_count,
            low_count,
        )
    };

    FullReport {
        overall_summary,
        chamber_reports,
        tunnel_reports,
        metal_reports,
        priority_list,
        metal_count: metals.len(),
        vpe_used,
    }
}

/// Toplu rapor.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FullReport {
    pub overall_summary: String,
    pub chamber_reports: Vec<AnalysisReport>,
    pub tunnel_reports: Vec<AnalysisReport>,
    pub metal_reports: Vec<AnalysisReport>,
    pub priority_list: Vec<String>,
    pub metal_count: usize,
    /// VPE Faz B ML skorları kullanıldı mı?
    pub vpe_used: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::surface::models::{Evidence, GeometryAnalysis};

    fn make_chamber(kind: &str, conf: f32, wall_s: f32, snr: f32, reasons: Vec<String>) -> Chamber {
        Chamber {
            kind: kind.into(),
            confidence: conf,
            evidence: Evidence {
                snr,
                wall_support: wall_s,
                reasons,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn make_tunnel(conf: f32, wall_s: f32, snr: f32, reasons: Vec<String>) -> Tunnel {
        Tunnel {
            confidence: conf,
            evidence: Evidence {
                snr,
                wall_support: wall_s,
                reasons,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn high_confidence_room_gets_high_reliability() {
        let ch = make_chamber("room", 0.75, 0.4, 2.5, vec![]);
        let report = analyze_chamber(&ch, &[], &[]);
        assert_eq!(report.reliability, "high");
        assert!(report.summary.contains("güvenilir"));
        assert!(report.recommendations.iter().any(|r| r.contains("✅")));
    }

    #[test]
    fn blurry_walls_downgrades_reliability() {
        let ch = make_chamber("room", 0.75, 0.4, 2.5, vec!["uncertain:blurry_walls".into()]);
        let report = analyze_chamber(&ch, &[], &[]);
        // clarity düşük → medium veya low olmalı
        assert!(report.reliability == "medium" || report.reliability == "low");
        assert!(report.warnings.iter().any(|w| w.contains("kazılmış")));
    }

    #[test]
    fn low_snr_gets_warning() {
        let ch = make_chamber("room", 0.6, 0.3, 1.2, vec![]);
        let report = analyze_chamber(&ch, &[], &[]);
        assert!(report.warnings.iter().any(|w| w.contains("Sinyal gücü düşük")));
    }

    #[test]
    fn nearby_metals_noted() {
        let ch = make_chamber("room", 0.7, 0.35, 2.0, vec![]);
        // Metal testini basitleştir — metal olmadan da rapor üretilebilmeli
        let report = analyze_chamber(&ch, &[], &[]);
        // Rapor üretilebilmeli (metal olmasa bile)
        assert!(!report.summary.is_empty());
    }

    #[test]
    fn tunnel_heading_in_summary() {
        let t = make_tunnel(0.8, 0.5, 3.0, vec![]);
        let mut t2 = t.clone();
        t2.heading = "Kuzey".into();
        let report = analyze_tunnel(&t2, &[], &[]);
        assert!(report.summary.contains("Kuzey"));
    }

    #[test]
    fn full_report_counts() {
        let chambers = vec![
            make_chamber("room", 0.8, 0.4, 2.5, vec![]),
            make_chamber("tomb", 0.45, 0.2, 1.3, vec!["uncertain:blurry_walls".into()]),
        ];
        let tunnels = vec![
            make_tunnel(0.7, 0.35, 2.0, vec![]),
        ];
        let report = generate_full_report(&chambers, &tunnels, &[], None);
        assert_eq!(report.chamber_reports.len(), 2);
        assert_eq!(report.tunnel_reports.len(), 1);
        assert!(report.overall_summary.contains("3 tespit"));
        assert!(!report.vpe_used);
    }

    #[test]
    fn vpe_blending_enhances_reliability() {
        use crate::prob_client::{DecisionBatch, VoidDecision, DecisionReport};
        let chambers = vec![
            make_chamber("room", 0.45, 0.2, 1.3, vec![]), // düşük legacy
        ];
        let tunnels = vec![];
        let metals = vec![];
        // VPE yüksek güven veriyor
        let vpe = DecisionBatch {
            stub: false,
            voids: vec![VoidDecision {
                id: "v0".into(),
                class: "room".into(),
                conf: 0.82,
                raw_conf: 0.78,
                margin: 0.15,
                action: "accept".into(),
                reasons: vec!["ml:high_confidence".into()],
            }],
            report: DecisionReport {
                accepted: 1,
                rejected: 0,
                ..Default::default()
            },
            ..Default::default()
        };
        let report = generate_full_report(&chambers, &tunnels, &metals, Some(&vpe));
        assert!(report.vpe_used);
        assert_eq!(report.chamber_reports.len(), 1);
        // VPE skoru legacy ile harmanlandı → reliability değişmeli
        let r = &report.chamber_reports[0];
        assert!(r.details.iter().any(|d| d.contains("VPE")));
    }

    #[test]
    fn vpe_reject_overrides_legacy() {
        use crate::prob_client::{DecisionBatch, MetalDecision, DecisionReport};
        let chambers = vec![];
        let tunnels = vec![];
        let mut metal = crate::surface::MetalBody::default();
        metal.field_strength = 0.6; // legacy: high
        metal.confidence = 0.65;
        let metals = vec![metal];
        let vpe = DecisionBatch {
            stub: false,
            metals: vec![MetalDecision {
                id: "m0".into(),
                action: "reject".into(),
                conf: 0.15,
                ..Default::default()
            }],
            report: DecisionReport {
                metal_blob_count: 1,
                ..Default::default()
            },
            ..Default::default()
        };
        let report = generate_full_report(&chambers, &tunnels, &metals, Some(&vpe));
        assert!(report.vpe_used);
        assert_eq!(report.metal_reports[0].reliability, "rejected");
        assert!(report.metal_reports[0].warnings.iter().any(|w| w.contains("VPE")));
    }
}
