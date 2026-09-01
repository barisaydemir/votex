//! Field calibration from signed anomaly map.

use super::types_local::FieldCalib;

pub fn calibrate_field(signed: &[f32], w: u32, h: u32) -> FieldCalib {
    let mut voids = Vec::new();
    let mut metals = Vec::new();
    for &v in signed {
        if v < -0.05 {
            voids.push((-v).min(1.0));
        } else if v > 0.05 {
            metals.push(v.min(1.0));
        }
    }
    let void_p70 = percentile(&mut voids, 0.70).max(0.12);
    let metal_p70 = percentile(&mut metals, 0.70).max(0.12);
    // Ortam gürültüsü: tüm alanın MAD'ı (×1.4826) — blob'lara dayanıklı, çoğunluğu
    // (arka plan) ölçer. Eski nötr-bant (|v| ≤ 0.05) std'si yapısal olarak ≤ 0.025'e
    // kilitliydi (clamp 0.03); bu, SNR kapısını (1.05/1.35) her alanda erişilemez
    // yapıyordu (tespit edilen her blob SNR ≥ 0.12/0.04 = 3.0). Gürültülü alanlarda
    // MAD gerçek σ'yu verir; temiz alanlarda (arka plan 0.0) 0.03 tabanına düşer —
    // eski davranışla birebir. Yoğun blob kaplamalı alanlarda MAD blob yayılımını
    // ölçebilir; 0.25 üst kıskacı sınırlar.
    let noise_std = {
        let mut vals: Vec<f32> = signed.iter().copied().collect();
        vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let med = vals[vals.len() / 2];
        let mut devs: Vec<f32> = vals.iter().map(|x| (x - med).abs()).collect();
        devs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        (1.4826 * devs[devs.len() / 2]).clamp(0.03, 0.25)
    };
    let pixels = (w * h) as f32;
    let min_area = ((pixels * 0.00035).round() as u32).clamp(10, 48);
    FieldCalib {
        void_thr: void_p70.clamp(0.12, 0.42),
        metal_thr: metal_p70.clamp(0.12, 0.45),
        noise_std,
        min_area,
    }
}

pub fn percentile(vals: &mut [f32], p: f32) -> f32 {
    if vals.is_empty() {
        return 0.0;
    }
    vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let i = ((vals.len() - 1) as f32 * p.clamp(0.0, 1.0)).round() as usize;
    vals[i.min(vals.len() - 1)]
}
