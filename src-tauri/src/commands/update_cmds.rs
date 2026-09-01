//! Suite güncelleme Tauri komutları.

use crate::updater::{self, ApplyUpdateResult, UpdateStatus};

#[tauri::command]
pub fn get_app_version() -> String {
    updater::CURRENT_VERSION.to_string()
}

#[tauri::command]
pub fn get_update_status() -> UpdateStatus {
    updater::probe_status()
}

#[tauri::command]
pub fn pick_update_package() -> Result<UpdateStatus, String> {
    updater::pick_package_folder()
}

#[tauri::command]
pub fn set_update_package_path(path: String) -> Result<UpdateStatus, String> {
    updater::set_package_path(&path)
}

#[tauri::command]
pub fn apply_suite_update(package_path: Option<String>) -> Result<ApplyUpdateResult, String> {
    updater::apply_update(package_path.as_deref())
}
