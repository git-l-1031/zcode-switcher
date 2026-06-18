mod crypto;
mod jwt;
mod profile;
mod quota;
mod restart;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
