mod crypto;
mod jwt;
mod oauth;
mod profile;
mod quota;
mod restart;
mod zcode_cdp;
mod zcode_launcher;

use serde::Serialize;

#[derive(Serialize)]
struct EnableRemoteDebugResult {
    modified: usize,
    already: usize,
    total: usize,
}

#[tauri::command]
fn zcode_launcher_scan() -> Result<Vec<zcode_launcher::ShortcutInfo>, String> {
    zcode_launcher::scan_zcode_shortcuts().map_err(|e| e.to_string())
}

#[tauri::command]
fn zcode_launcher_enable() -> Result<EnableRemoteDebugResult, String> {
    zcode_launcher::enable_remote_debug()
        .map(|(modified, already, total)| EnableRemoteDebugResult {
            modified,
            already,
            total,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn zcode_launcher_disable() -> Result<usize, String> {
    zcode_launcher::disable_remote_debug().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            profile::list_profiles,
            profile::current_status,
            profile::capture_current,
            profile::switch_to,
            profile::rename_profile,
            profile::delete_profile,
            profile::export_profile_json,
            profile::import_profile_json,
            profile::export_profile_to_file,
            profile::import_profile_from_file,
            profile::export_profiles_bundle_to_file,
            profile::export_profiles_to_file,
            profile::import_profiles_from_files,
            profile::open_config_dir,
            profile::fetch_quota,
            restart::zcode_running,
            restart::refresh_zcode_app_server,
            restart::restart_zcode,
            restart::kill_zcode_for_switch,
            zcode_launcher_scan,
            zcode_launcher_enable,
            zcode_launcher_disable,
            oauth::oauth_init,
            oauth::oauth_acquire_and_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
