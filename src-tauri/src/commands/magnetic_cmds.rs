//! Magnetic analysis Tauri commands.

use crate::capture;
use crate::magnetic::{CalibrationMode, Rgba};
use tauri::State;

use super::dto::{
    point_dto, summarize, AnalyzeRawRequest, AnalyzeRawResponse, DemoResponse,
};
use super::AppState;

/// Ham bipolar dizi analizi (fluxgate stream / CSV / ızgara).
#[tauri::command]
pub fn analyze_raw_magnetic(
    state: State<'_, AppState>,
    req: AnalyzeRawRequest,
) -> Result<AnalyzeRawResponse, String> {
    let mut analyzer = state.analyzer.lock().map_err(|e| e.to_string())?;

    if let Some(g) = req.ground {
        analyzer.config.calibration = CalibrationMode::Fixed(g);
    }
    if let Some(t) = req.neutral_tolerance {
        analyzer.config.neutral_tolerance = t;
    }
    if let (Some(pp), Some(pn)) = (req.peak_positive, req.peak_negative) {
        let g = req.ground.unwrap_or(0.0);
        analyzer.lock_scale(g, pp, pn);
    }

    if let (Some(w), Some(h)) = (req.width, req.height) {
        let (rgba, pts) = analyzer.analyze_grid(&req.samples, w, h)?;
        let img = image::RgbaImage::from_raw(w as u32, h as u32, rgba)
            .ok_or_else(|| "RGBA buffer boyutu hatalı".to_string())?;
        let url = capture::png_data_url(&img)?;
        let summary = summarize(&pts);
        return Ok(AnalyzeRawResponse {
            points: pts.into_iter().map(point_dto).collect(),
            rgba_base64_png: Some(url),
            summary,
        });
    }

    let points = analyzer.analyze_batch(&req.samples);
    let summary = summarize(&points);
    Ok(AnalyzeRawResponse {
        points: points.into_iter().map(point_dto).collect(),
        rgba_base64_png: None,
        summary,
    })
}

#[tauri::command]
pub fn lock_magnetic_scale(
    state: State<'_, AppState>,
    ground: f32,
    peak_positive: f32,
    peak_negative: f32,
) -> Result<(), String> {
    let mut analyzer = state.analyzer.lock().map_err(|e| e.to_string())?;
    analyzer.lock_scale(ground, peak_positive, peak_negative);
    Ok(())
}

#[tauri::command]
pub fn get_legend(state: State<'_, AppState>, height: Option<usize>) -> Result<Vec<Rgba>, String> {
    let analyzer = state.analyzer.lock().map_err(|e| e.to_string())?;
    Ok(analyzer.build_legend(height.unwrap_or(256)))
}

/// ELIC benzeri sentetik harita demosu.
#[tauri::command]
pub fn run_demo_analysis(state: State<'_, AppState>) -> Result<DemoResponse, String> {
    let w = 32usize;
    let h = 24usize;
    let mut samples = vec![0.0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let mut v = ((x as f32 * 3.0 + y as f32) % 17.0) - 8.0;
            let dx = x as f32 - 8.0;
            let dy = y as f32 - 6.0;
            if dx * dx + dy * dy < 25.0 {
                v = -900.0 - (25.0 - dx * dx - dy * dy) * 10.0;
            }
            let dx = x as f32 - 24.0;
            let dy = y as f32 - 16.0;
            if dx * dx + dy * dy < 36.0 {
                v = 350.0 + (36.0 - dx * dx - dy * dy) * 4.0;
            }
            samples[i] = v;
        }
    }

    let req = AnalyzeRawRequest {
        samples: samples.clone(),
        width: Some(w),
        height: Some(h),
        ground: Some(0.0),
        peak_positive: Some(470.0),
        peak_negative: Some(1160.0),
        neutral_tolerance: Some(25.0),
    };
    let result = analyze_raw_magnetic(state, req)?;
    Ok(DemoResponse { samples, result })
}
