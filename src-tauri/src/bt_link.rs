//! BLE (Bluetooth LE) cihaz bağlantısı — btleplug üzerinden tarama, bağlantı ve
//! canlı bildirim akışı.
//!
//! Gelen ham baytlar base64 olarak `bt-data` olayıyla UI'a iletilir; yarım kalan
//! mesajların tam JSON/CSV belgesine birleştirilmesi saf JS tarafında
//! (`ui/device/btStream.js`) yapılır — böylece cihaza özgü protokol bilgisi
//! değiştiğinde Rust tarafı sabit kalır.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use btleplug::api::{Central, CharPropFlags, Manager as _, Peripheral as _, ScanFilter};
use btleplug::platform::{Manager, Peripheral};
use futures::StreamExt;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager as _};

use crate::commands::AppState;

/// `bt-scan` çıktısı — yakındaki BLE cihazları.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtDeviceInfo {
    pub id: String,
    pub name: Option<String>,
    pub rssi: Option<i16>,
}

/// `bt-link-status` çıktısı — aktif BLE oturumu.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BtLinkStatus {
    pub connected: bool,
    pub device_id: Option<String>,
    pub device_name: Option<String>,
    pub subscribed: Vec<String>,
    pub message_count: u64,
}

/// Aktif BLE oturumu: bağlı çevre birimi + bildirim görevi.
pub struct BtSession {
    pub peripheral: Peripheral,
    pub device_id: String,
    pub device_name: Option<String>,
    pub subscribed: Vec<String>,
    pub message_count: Arc<AtomicU64>,
    pub task: tauri::async_runtime::JoinHandle<()>,
}

async fn first_adapter() -> Result<btleplug::platform::Adapter, String> {
    let manager = Manager::new()
        .await
        .map_err(|e| format!("Bluetooth yöneticisi açılamadı: {e}"))?;
    let adapters = manager
        .adapters()
        .await
        .map_err(|e| format!("Bluetooth adaptörü listelenemedi: {e}"))?;
    adapters
        .into_iter()
        .next()
        .ok_or_else(|| "Bluetooth adaptörü bulunamadı — Bluetooth açık mı?".to_string())
}

/// Yakındaki BLE cihazlarını tarar (varsayılan ~4 sn pencere).
pub async fn scan(timeout_ms: u64) -> Result<Vec<BtDeviceInfo>, String> {
    let adapter = first_adapter().await?;
    adapter
        .start_scan(ScanFilter::default())
        .await
        .map_err(|e| format!("Bluetooth taraması başlatılamadı: {e}"))?;
    tokio::time::sleep(Duration::from_millis(timeout_ms.clamp(500, 15_000))).await;
    let peripherals = adapter
        .peripherals()
        .await
        .map_err(|e| format!("Cihazlar listelenemedi: {e}"))?;
    let mut list = Vec::new();
    for peripheral in peripherals {
        let props = peripheral
            .properties()
            .await
            .map_err(|e| format!("Cihaz bilgisi okunamadı: {e}"))?;
        if let Some(props) = props {
            list.push(BtDeviceInfo {
                id: format!("{:?}", peripheral.id()),
                name: props.local_name,
                rssi: props.rssi,
            });
        }
    }
    let _ = adapter.stop_scan().await;
    list.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    Ok(list)
}

/// Seçilen cihaza bağlanır, notify/indicate karakteristiklerine abone olur ve
/// gelen her bildirimi `bt-data` olayına dönüştüren görevi başlatır.
pub async fn connect(app: AppHandle, device_id: &str) -> Result<BtSession, String> {
    let adapter = first_adapter().await?;
    let peripherals = adapter
        .peripherals()
        .await
        .map_err(|e| format!("Cihazlar listelenemedi: {e}"))?;
    let target = peripherals
        .into_iter()
        .find(|p| format!("{:?}", p.id()) == device_id)
        .ok_or_else(|| "Cihaz bulunamadı — önce 'Cihaz Ara' ile listeyi yenileyin".to_string())?;
    if !target.is_connected().await.unwrap_or(false) {
        target
            .connect()
            .await
            .map_err(|e| format!("Bağlanılamadı: {e}"))?;
    }
    target
        .discover_services()
        .await
        .map_err(|e| format!("Servisler okunamadı: {e}"))?;
    let mut subscribed = Vec::new();
    for characteristic in target.characteristics() {
        if characteristic
            .properties
            .contains(CharPropFlags::NOTIFY | CharPropFlags::INDICATE)
        {
            target
                .subscribe(&characteristic)
                .await
                .map_err(|e| format!("Bildirim aboneliği kurulamadı: {e}"))?;
            subscribed.push(characteristic.uuid.to_string());
        }
    }
    if subscribed.is_empty() {
        let _ = target.disconnect().await;
        return Err(
            "Cihazda bildirim (notify) özelliği bulunamadı — canlı veri akışı desteklenmiyor"
                .to_string(),
        );
    }
    let device_name = target
        .properties()
        .await
        .ok()
        .flatten()
        .and_then(|p| p.local_name);
    let mut notifications = target
        .notifications()
        .await
        .map_err(|e| format!("Bildirim akışı açılamadı: {e}"))?;
    let counter = Arc::new(AtomicU64::new(0));
    let task_counter = counter.clone();
    let stream_device_id = device_id.to_string();
    let task = tauri::async_runtime::spawn(async move {
        while let Some(n) = notifications.next().await {
            task_counter.fetch_add(1, Ordering::Relaxed);
            let _ = app.emit(
                "bt-data",
                serde_json::json!({
                    "deviceId": stream_device_id,
                    "uuid": n.uuid.to_string(),
                    "b64": B64.encode(&n.value),
                    "len": n.value.len(),
                }),
            );
        }
        // Akış bitti → bağlantı koptu; aynı cihazın oturumunu bırak ve bildir.
        if let Some(state) = app.try_state::<AppState>() {
            let mut guard = state.bt_link.lock().unwrap_or_else(|e| e.into_inner());
            if guard
                .as_ref()
                .map(|s| s.device_id == stream_device_id)
                .unwrap_or(false)
            {
                *guard = None;
            }
        }
        let _ = app.emit(
            "bt-link",
            serde_json::json!({ "connected": false, "deviceId": stream_device_id }),
        );
    });
    Ok(BtSession {
        peripheral: target,
        device_id: device_id.to_string(),
        device_name,
        subscribed,
        message_count: counter,
        task,
    })
}

/// Aktif oturumu kapatır (bildirim görevi + BLE bağlantısı).
pub async fn disconnect(state: &AppState) -> Result<(), String> {
    let session = {
        let mut guard = state.bt_link.lock().unwrap_or_else(|e| e.into_inner());
        guard.take()
    };
    if let Some(session) = session {
        session.task.abort();
        let _ = session.peripheral.disconnect().await;
    }
    Ok(())
}

/// Aktif oturumun anlık durumu.
pub fn status(state: &AppState) -> BtLinkStatus {
    let guard = state.bt_link.lock().unwrap_or_else(|e| e.into_inner());
    match guard.as_ref() {
        Some(s) => BtLinkStatus {
            connected: true,
            device_id: Some(s.device_id.clone()),
            device_name: s.device_name.clone(),
            subscribed: s.subscribed.clone(),
            message_count: s.message_count.load(Ordering::Relaxed),
        },
        None => BtLinkStatus::default(),
    }
}
