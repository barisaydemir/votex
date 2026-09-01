//! Toprak profili → derinlik / güven kalibrasyon çarpanları (geri alınabilir).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SoilProfileId {
    Off,
    Sand,
    Loam,
    WetClay,
    Laterite,
    Organic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoilParams {
    pub id: String,
    pub label_tr: String,
    pub depth_scale: f32,
    pub conf_delta: f32,
    /// Düzeltme fiilen uygulandı mı (off / bayrak kapalı → false)
    pub correction_applied: bool,
}

impl SoilParams {
    pub fn identity(id: &str, label: &str) -> Self {
        Self {
            id: id.into(),
            label_tr: label.into(),
            depth_scale: 1.0,
            conf_delta: 0.0,
            correction_applied: false,
        }
    }
}

/// Bilinmeyen id → off (güvenli: davranış değişmesin).
pub fn normalize_profile(raw: &str) -> SoilProfileId {
    match raw.trim().to_ascii_lowercase().as_str() {
        "sand" | "kum" | "dry_sand" => SoilProfileId::Sand,
        "loam" | "tin" | "tın" | "neutral" => SoilProfileId::Loam,
        "wet_clay" | "clay" | "kil" | "nemli_kil" => SoilProfileId::WetClay,
        "laterite" | "laterit" | "iron" | "demirli" => SoilProfileId::Laterite,
        "organic" | "humus" | "organik" => SoilProfileId::Organic,
        "off" | "closed" | "kapali" | "kapalı" | "legacy" | "" => SoilProfileId::Off,
        _ => SoilProfileId::Off,
    }
}

pub fn profile_id_str(id: SoilProfileId) -> &'static str {
    match id {
        SoilProfileId::Off => "off",
        SoilProfileId::Sand => "sand",
        SoilProfileId::Loam => "loam",
        SoilProfileId::WetClay => "wet_clay",
        SoilProfileId::Laterite => "laterite",
        SoilProfileId::Organic => "organic",
    }
}

fn base_params(id: SoilProfileId) -> (f32, f32, &'static str) {
    match id {
        SoilProfileId::Off => (1.0, 0.0, "Kapalı (eski hesap)"),
        SoilProfileId::Sand => (1.10, -0.03, "Kuru kum / çakıl"),
        SoilProfileId::Loam => (1.00, 0.0, "Tın / nötr"),
        SoilProfileId::WetClay => (0.85, 0.04, "Nemli kil"),
        SoilProfileId::Laterite => (0.70, 0.08, "Laterit / demirli"),
        SoilProfileId::Organic => (0.95, 0.02, "Organik / humus"),
    }
}

/// `correction_enabled == false` veya profil Off → identity (legacy).
pub fn resolve_params(raw_profile: &str, correction_enabled: bool) -> SoilParams {
    let id = normalize_profile(raw_profile);
    let (scale, delta, label) = base_params(id);
    if !correction_enabled || id == SoilProfileId::Off {
        return SoilParams {
            id: profile_id_str(id).into(),
            label_tr: if !correction_enabled {
                format!("{label} · düzeltme kapalı")
            } else {
                label.into()
            },
            depth_scale: 1.0,
            conf_delta: 0.0,
            correction_applied: false,
        };
    }
    SoilParams {
        id: profile_id_str(id).into(),
        label_tr: label.into(),
        depth_scale: scale,
        conf_delta: delta,
        correction_applied: true,
    }
}

pub fn apply_conf(min_confidence: f32, delta: f32) -> f32 {
    (min_confidence + delta).clamp(0.15, 0.9)
}

pub fn apply_depth_range(base: f32, scale: f32) -> f32 {
    (base * scale).clamp(2.0, 60.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_is_off() {
        assert_eq!(normalize_profile("xyz"), SoilProfileId::Off);
    }

    #[test]
    fn laterite_scales_when_on() {
        let p = resolve_params("laterite", true);
        assert!(p.correction_applied);
        assert!((p.depth_scale - 0.70).abs() < 1e-6);
    }

    #[test]
    fn flag_off_forces_identity() {
        let p = resolve_params("laterite", false);
        assert!(!p.correction_applied);
        assert!((p.depth_scale - 1.0).abs() < 1e-6);
    }
}
