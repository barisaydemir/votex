//! Internal types for structure extraction.

#[derive(Clone, Debug)]
pub struct FieldCalib {
    pub void_thr: f32,
    pub metal_thr: f32,
    pub noise_std: f32,
    pub min_area: u32,
}

#[derive(Clone, Debug)]
pub struct Blob {
    pub cx: f32,
    pub cy: f32,
    pub rx: f32,
    pub ry: f32,
    pub intensity: f32,
    pub max_intensity: f32,
    pub area_px: u32,
    pub fill_ratio: f32,
    /// Ana eksen birim vektörü (normalize harita uzayı, 0–1).
    pub dir_x: f32,
    pub dir_y: f32,
    /// Ana eksen yarı uzunluğu (normalize harita uzaklığı).
    pub half_len: f32,
    /// PCA major/minor oranı (≥1).
    pub axis_aspect: f32,
    /// Manyetik ayakizi dış konturu (normalize 0–1, kapalı poligon).
    pub outline: Vec<[f32; 2]>,
}

impl Default for Blob {
    fn default() -> Self {
        Self {
            cx: 0.0,
            cy: 0.0,
            rx: 0.05,
            ry: 0.05,
            intensity: 0.0,
            max_intensity: 0.0,
            area_px: 0,
            fill_ratio: 0.5,
            dir_x: 1.0,
            dir_y: 0.0,
            half_len: 0.05,
            axis_aspect: 1.0,
            outline: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoidClass {
    Room,
    Tomb,
    Shaft,
    Tunnel,
    Noise,
}
