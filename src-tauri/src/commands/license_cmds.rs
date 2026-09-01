//! Lisans Tauri komutları.

use crate::license::{self, LicenseStatus};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateResult {
    pub ok: bool,
    pub message: String,
    pub status: LicenseStatus,
}

#[tauri::command]
pub fn get_license_status() -> LicenseStatus {
    license::get_license_status()
}

#[tauri::command]
pub fn get_machine_hwid_short() -> String {
    license::get_license_status().hwid_short
}

#[tauri::command]
pub fn activate_license(token: String) -> Result<ActivateResult, String> {
    match license::activate_license(&token) {
        Ok(status) => {
            let ok = status.valid
                || !status.enforce
                || status.message.starts_with("Kredi eklendi");
            Ok(ActivateResult {
                ok,
                message: status.message.clone(),
                status,
            })
        }
        Err(e) => Err(e),
    }
}
