//! ROI ekran yakalama — xcap ile düşük frekanslı frame.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use image::{ImageBuffer, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use xcap::Monitor;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Roi {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedFrame {
    /// data:image/png;base64,... veya ham base64 PNG
    pub base64_png: String,
    pub width: u32,
    pub height: u32,
    pub roi: Roi,
}

/// Birincil monitörden ROI kırp.
pub fn capture_roi(roi: &Roi) -> Result<(RgbaImage, CapturedFrame), String> {
    if roi.width == 0 || roi.height == 0 {
        return Err("ROI genişlik/yükseklik 0 olamaz".into());
    }

    let monitors = Monitor::all().map_err(|e| format!("Monitör listesi: {e}"))?;
    let monitor = monitors
        .into_iter()
        .next()
        .ok_or_else(|| "Monitör bulunamadı".to_string())?;

    let full = monitor
        .capture_image()
        .map_err(|e| format!("Ekran yakalama başarısız: {e}"))?;

    let fw = full.width();
    let fh = full.height();

    let x0 = roi.x.max(0) as u32;
    let y0 = roi.y.max(0) as u32;
    if x0 >= fw || y0 >= fh {
        return Err(format!(
            "ROI ekran dışında: ({},{}) ekran {}x{}",
            roi.x, roi.y, fw, fh
        ));
    }

    let w = roi.width.min(fw - x0);
    let h = roi.height.min(fh - y0);

    let cropped: RgbaImage = ImageBuffer::from_fn(w, h, |x, y| {
        let p = full.get_pixel(x0 + x, y0 + y);
        image::Rgba([p[0], p[1], p[2], p[3]])
    });

    let mut png_bytes = Cursor::new(Vec::new());
    cropped
        .write_to(&mut png_bytes, ImageFormat::Png)
        .map_err(|e| format!("PNG encode: {e}"))?;
    let b64 = B64.encode(png_bytes.into_inner());

    let frame = CapturedFrame {
        base64_png: format!("data:image/png;base64,{b64}"),
        width: w,
        height: h,
        roi: Roi {
            x: roi.x,
            y: roi.y,
            width: w,
            height: h,
        },
    };

    Ok((cropped, frame))
}

/// RGBA görüntüyü data-URL PNG'ye çevir.
pub fn png_data_url(img: &RgbaImage) -> Result<String, String> {
    let mut png_bytes = Cursor::new(Vec::new());
    img.write_to(&mut png_bytes, ImageFormat::Png)
        .map_err(|e| format!("PNG encode: {e}"))?;
    let b64 = B64.encode(png_bytes.into_inner());
    Ok(format!("data:image/png;base64,{b64}"))
}
