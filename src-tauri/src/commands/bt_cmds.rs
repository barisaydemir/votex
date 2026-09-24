//! BLE cihaz bağlantısı Tauri komutları — tarama, bağlantı, kopma, durum.

use super::AppState;
use crate::bt_link;
use tauri::{AppHandle, State};

/// Yakındaki BLE cihazlarını tarar ve listeler.
#[tauri::command]
pub async fn bt_scan(timeout_ms: Option<u32>) -> Result<Vec<bt_link::BtDeviceInfo>, String> {
    bt_link::scan(timeout_ms.unwrap_or(4000) as u64).await
}

/// Seçilen BLE cihazına bağlanır; notify kanallarına abone olarak gelen
/// baytları `bt-data` olayıyla UI'a iletir.
#[tauri::command]
pub async fn bt_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    device_id: String,
) -> Result<bt_link::BtLinkStatus, String> {
    bt_link::disconnect(&state).await?;
    let session = bt_link::connect(app, &device_id).await?;
    *state
        .bt_link
        .lock()
        .map_err(|_| "BT durum kilidi bozuldu".to_string())? = Some(session);
    Ok(bt_link::status(&state))
}

/// Aktif BLE oturumunu kapatır.
#[tauri::command]
pub async fn bt_disconnect(state: State<'_, AppState>) -> Result<bt_link::BtLinkStatus, String> {
    bt_link::disconnect(&state).await?;
    Ok(bt_link::status(&state))
}

/// Aktif BLE oturumunun durumunu döner.
#[tauri::command]
pub fn bt_link_status(state: State<'_, AppState>) -> Result<bt_link::BtLinkStatus, String> {
    Ok(bt_link::status(&state))
}
