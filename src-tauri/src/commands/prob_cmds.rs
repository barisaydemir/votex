//! VotexProb (hesap motoru) Tauri komutları — Faz A.

use crate::app_settings::{self, AppSettings};
use crate::prob_client::{self, ProbEngineStatus};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbLaunchResult {
    pub ok: bool,
    pub message: String,
    pub status: ProbEngineStatus,
}

#[tauri::command]
pub fn get_prob_engine_status() -> ProbEngineStatus {
    prob_client::probe_status()
}

#[tauri::command]
pub fn launch_prob_engine() -> Result<ProbLaunchResult, String> {
    let message = prob_client::try_launch_prob(true)?;
    Ok(ProbLaunchResult {
        ok: true,
        message,
        status: prob_client::probe_status(),
    })
}

#[tauri::command]
pub fn set_prob_profile(profile: String) -> Result<AppSettings, String> {
    let id = match profile.trim().to_ascii_lowercase().as_str() {
        "corridor" | "koridor" => "corridor",
        _ => "standard",
    };
    let mut s = app_settings::load_settings();
    s.prob_profile = id.into();
    app_settings::save_settings(&s)?;
    // Canlı motora da yaz (online ise)
    let _ = prob_client::set_policy(id);
    Ok(s)
}

#[tauri::command]
pub fn set_auto_launch_prob(enabled: bool) -> Result<AppSettings, String> {
    let mut s = app_settings::load_settings();
    s.auto_launch_prob = enabled;
    app_settings::save_settings(&s)?;
    Ok(s)
}

#[tauri::command]
pub fn set_prob_fallback(enabled: bool) -> Result<AppSettings, String> {
    let mut s = app_settings::load_settings();
    s.prob_fallback = enabled;
    app_settings::save_settings(&s)?;
    Ok(s)
}
