//! Screen capture Tauri commands.
//!
//! Not: Sürekli yakalama döngüsü (`start_capture_loop` / `stop_capture_loop`)
//! UI'dan hiç çağrılmadığı ve boşta CPU tüketebileceği için kaldırıldı.
//! Tek seferlik `capture_sensor_frame` korundu.

use crate::capture::{self, Roi};
use crate::vision;
use tauri::{AppHandle, Emitter};

use super::dto::SensorFramePayload;

fn emit_capture(app: &AppHandle, roi: &Roi, analyze: bool) -> Result<SensorFramePayload, String> {
    let (img, frame) = capture::capture_roi(roi)?;
    let analysis = if analyze {
        Some(vision::analyze_colormap_image(&img, 24, 80, 0.35)?)
    } else {
        None
    };
    let payload = SensorFramePayload { frame, analysis };
    app.emit("sensor-frame", &payload)
        .map_err(|e| format!("sensor-frame emit: {e}"))?;
    Ok(payload)
}

/// Tek seferlik ROI yakala + `sensor-frame` event.
#[tauri::command]
pub fn capture_sensor_frame(
    app: AppHandle,
    roi: Roi,
    analyze: Option<bool>,
) -> Result<SensorFramePayload, String> {
    emit_capture(&app, &roi, analyze.unwrap_or(true))
}
