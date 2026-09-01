//! Compass bearing helpers.

use super::types_local::Blob;

pub fn compass_from_segment(x0: f32, y0: f32, x1: f32, y1: f32) -> (f32, String, String) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let north = -dy;
    let east = dx;
    let mut deg = east.atan2(north).to_degrees();
    if deg < 0.0 {
        deg += 360.0;
    }
    let heading = compass8(deg);
    let axis = deg % 180.0;
    let direction = format!("{}–{}", compass8(axis), compass8((axis + 180.0) % 360.0));
    (deg, heading, direction)
}

pub fn compass8(deg: f32) -> String {
    let d = ((deg % 360.0) + 360.0) % 360.0;
    let idx = ((d + 22.5) / 45.0).floor() as usize % 8;
    ["K", "KD", "D", "GD", "G", "GB", "B", "KB"][idx].to_string()
}

/// Dik çekim: PCA ana ekseninin pusula açısı (0° = kuzey).
pub fn blob_plan_bearing_deg(b: &Blob) -> f32 {
    let hl = b.half_len.max(b.rx.max(b.ry)).max(0.02);
    let (deg, _, _) = compass_from_segment(
        b.cx - b.dir_x * hl,
        b.cy - b.dir_y * hl,
        b.cx + b.dir_x * hl,
        b.cy + b.dir_y * hl,
    );
    deg
}

/// Yan çekim: resim düzlemi açısı (°). 0 = sağa yatay; + = aşağı (derin) eğim.
/// 3D'de XZ = resim olduğunda rotation.y için kullanılır.
pub fn blob_side_tilt_deg(b: &Blob, _map_size_m: f32, _depth_range_m: f32) -> f32 {
    if b.dir_x.abs() + b.dir_y.abs() < 1e-5 {
        return 0.0;
    }
    b.dir_y.atan2(b.dir_x).to_degrees()
}

/// Blob yönü için bearing (dik = pusula, yan = eğim).
pub fn blob_orient_deg(b: &Blob, side: bool, map_size_m: f32, depth_range_m: f32) -> f32 {
    if side {
        blob_side_tilt_deg(b, map_size_m, depth_range_m)
    } else {
        blob_plan_bearing_deg(b)
    }
}
