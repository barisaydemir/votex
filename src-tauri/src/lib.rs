//! Votex Tauri backend — manyetik anomali + ekran yakalama.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(dead_code)] // Kullanılmayan fonksiyonlar API/gelecek kullanımı için korunuyor

mod analysis;
mod app_settings;
mod archive;
mod capture;
mod commands;
mod csv_import;
mod dta_bridge;
mod license;
mod magnetic;
mod preprocess;
mod prob_client;
mod hint_store;
mod session_persist;
mod sdc_model;
mod sdc_reader_mod;
mod soil_profile;
mod structures;
mod surface;
mod updater;
mod vision;

use commands::AppState;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .setup(|app| {
            dta_bridge::start_bridge(app.handle().clone());
            // Son kayıtlı 3D oturum + DTA ipuçlarını yükle
            if let Some(work) = session_persist::load_work() {
                let state = app.state::<AppState>();
                if let Some(session) = work.session {
                    if let Ok(mut guard) = state.last_session.lock() {
                        *guard = Some(session.clone());
                    }
                    if let Ok(map_id) = crate::hint_store::map_fingerprint(&session.image_base64)
                    {
                        let restored = {
                            let from_store = crate::hint_store::hints_for_map(&map_id);
                            if !from_store.is_empty() {
                                from_store
                            } else if work.hints_map_id.as_deref() == Some(map_id.as_str()) {
                                work.hints
                            } else {
                                Vec::new()
                            }
                        };
                        if let Ok(mut guard) = state.dta_hints.lock() {
                            *guard = restored;
                        }
                        if let Ok(mut mid) = state.dta_hints_map_id.lock() {
                            *mid = Some(map_id);
                        }
                        state.dta_last_hint_count.store(
                            state
                                .dta_hints
                                .lock()
                                .map(|h| h.len() as u64)
                                .unwrap_or(0),
                            std::sync::atomic::Ordering::Relaxed,
                        );
                    }
                } else if let Ok(mut hints) = state.dta_hints.lock() {
                    *hints = Vec::new();
                }
                if let Some(surface) = work.surface {
                    let _ = app.emit(
                        "dta-guide",
                        serde_json::json!({
                            "ok": true,
                            "hintCount": state.dta_last_hint_count.load(std::sync::atomic::Ordering::Relaxed),
                            "message": "Son kayıtlı 3D yüklendi",
                            "surface": surface,
                            "restored": true,
                        }),
                    );
                }
            }
            commands::dta_cmds::spawn_auto_launch_dta(app.handle().clone());
            crate::prob_client::spawn_auto_launch_prob(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // Ana pencere kapanırken DTA'yı da kapat
                if window.label() == "main" {
                    app_settings::shutdown_owned_dta();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::capture_cmds::capture_sensor_frame,
            commands::magnetic_cmds::analyze_raw_magnetic,
            commands::magnetic_cmds::lock_magnetic_scale,
            commands::magnetic_cmds::get_legend,
            commands::magnetic_cmds::run_demo_analysis,
            commands::image_cmds::analyze_uploaded_image,
            commands::image_cmds::build_surface_3d,
            commands::image_cmds::pick_image_file,
            commands::csv_cmds::analyze_csv_data,
            commands::csv_cmds::build_surface_from_csv,
            commands::csv_cmds::pick_csv_file,
            commands::csv_cmds::parse_excel_data,
            commands::get_dta_link_status,
            commands::dta_cmds::get_app_settings,
            commands::dta_cmds::set_dta_launch_path,
            commands::dta_cmds::set_auto_launch_dta,
            commands::dta_cmds::set_soil_profile,
            commands::dta_cmds::set_soil_correction_enabled,
            commands::dta_cmds::set_structures_through_red,
            commands::dta_cmds::set_hints_3d_visible,
            commands::dta_cmds::set_csv_filter_prefs,
            commands::dta_cmds::deep_structure_scan,
            commands::dta_cmds::staged_depth_scan,
            commands::dta_cmds::water_yellow_scan,
            commands::dta_cmds::water_blue_scan,
            commands::dta_cmds::pick_dta_launch_path,
            commands::dta_cmds::launch_dta,
            commands::dta_cmds::interpret_votex_screen,
            commands::dta_cmds::get_map_dta_hints,
            commands::dta_cmds::set_map_dta_hints_enabled,
            commands::dta_cmds::add_contact_hints,
            commands::dta_cmds::generate_analysis_reports,
            commands::dta_cmds::save_file_dialog,
            commands::prob_cmds::get_prob_engine_status,
            commands::prob_cmds::launch_prob_engine,
            commands::prob_cmds::set_prob_profile,
            commands::prob_cmds::set_auto_launch_prob,
            commands::prob_cmds::set_prob_fallback,
            commands::license_cmds::get_license_status,
            commands::license_cmds::get_machine_hwid_short,
            commands::license_cmds::activate_license,
            commands::archive_cmds::list_archive,
            commands::archive_cmds::load_archive,
            commands::archive_cmds::delete_archive,
            commands::update_cmds::get_app_version,
            commands::update_cmds::get_update_status,
            commands::update_cmds::pick_update_package,
            commands::update_cmds::set_update_package_path,
            commands::update_cmds::apply_suite_update,
        ])
        .build(tauri::generate_context!())
        .expect("Votex başlatılamadı")
        .run(|_app, event| {
            match event {
                RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                    app_settings::shutdown_owned_dta();
                }
                _ => {}
            }
        });
}
