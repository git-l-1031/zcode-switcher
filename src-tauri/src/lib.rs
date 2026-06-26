mod captcha;
mod crypto;
mod custom_provider;
mod jwt;
mod oauth;
mod profile;
mod proxy;
mod proxy_pool;
mod quota;
mod restart;
mod zcode_cdp;
mod zcode_launcher;

use reqwest::header::{
    HeaderMap, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
};
use reqwest::StatusCode;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
struct EnableRemoteDebugResult {
    modified: usize,
    already: usize,
    total: usize,
}

#[derive(Serialize)]
struct DownloadToDirectoryResult {
    path: String,
    filename: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadInfo {
    filename: String,
    content_type: Option<String>,
    content_length: Option<u64>,
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

#[tauri::command]
async fn download_url_to_file(url: String, path: String) -> Result<(), String> {
    let parsed = parse_download_url(&url)?;
    let response = reqwest::get(parsed)
        .await
        .map_err(|e| format!("下载失败：{}", e))?;
    if !response.status().is_success() {
        return Err(format!("下载失败：HTTP {}", response.status()));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取下载内容失败：{}", e))?;
    std::fs::write(path, bytes).map_err(|e| format!("保存文件失败：{}", e))
}

#[tauri::command]
async fn inspect_download_url(url: String) -> Result<DownloadInfo, String> {
    let parsed = parse_download_url(&url)?;
    let client = reqwest::Client::new();
    let response = match client.head(parsed.clone()).send().await {
        Ok(response) if response.status().is_success() => response,
        _ => client
            .get(parsed.clone())
            .header(RANGE, "bytes=0-0")
            .send()
            .await
            .map_err(|e| format!("预读下载信息失败：{}", e))?,
    };
    if !(response.status().is_success() || response.status() == StatusCode::PARTIAL_CONTENT) {
        return Err(format!("预读下载信息失败：HTTP {}", response.status()));
    }

    let headers = response.headers();
    Ok(DownloadInfo {
        filename: suggested_download_filename(&parsed, headers, &[]),
        content_type: content_type_from_headers(headers),
        content_length: content_length_from_headers(headers),
    })
}

#[tauri::command]
async fn download_url_to_directory(
    url: String,
    directory: String,
) -> Result<DownloadToDirectoryResult, String> {
    let parsed = parse_download_url(&url)?;
    let metadata = std::fs::metadata(&directory).map_err(|e| format!("下载目录不可用：{}", e))?;
    if !metadata.is_dir() {
        return Err("下载目录不可用：请选择文件夹".into());
    }

    let response = reqwest::get(parsed.clone())
        .await
        .map_err(|e| format!("下载失败：{}", e))?;
    if !response.status().is_success() {
        return Err(format!("下载失败：HTTP {}", response.status()));
    }

    let headers = response.headers().clone();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取下载内容失败：{}", e))?;
    let filename = suggested_download_filename(&parsed, &headers, &bytes);
    let mut path = PathBuf::from(directory);
    path.push(&filename);
    let path = unique_download_path(path);
    std::fs::write(&path, bytes).map_err(|e| format!("保存文件失败：{}", e))?;

    Ok(DownloadToDirectoryResult {
        path: path.to_string_lossy().to_string(),
        filename,
    })
}

fn parse_download_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("下载链接无效：{}", e))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("仅支持 http/https 下载链接".into());
    }
    Ok(parsed)
}

fn suggested_download_filename(url: &reqwest::Url, headers: &HeaderMap, bytes: &[u8]) -> String {
    let name = filename_from_content_disposition(headers)
        .or_else(|| filename_from_url(url))
        .unwrap_or_else(default_download_filename);
    let name = sanitize_download_filename(&name);
    if Path::new(&name).extension().is_some() {
        return name;
    }
    match inferred_extension(headers, bytes) {
        Some(ext) => format!("{}.{}", name, ext),
        None => name,
    }
}

fn filename_from_content_disposition(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(CONTENT_DISPOSITION)?.to_str().ok()?;
    let mut plain = None;
    for part in value.split(';').skip(1) {
        let Some((name, raw_value)) = part.trim().split_once('=') else {
            continue;
        };
        let raw_value = strip_header_quotes(raw_value.trim());
        if name.trim().eq_ignore_ascii_case("filename*") {
            return Some(percent_decode(filename_star_value(raw_value)));
        }
        if name.trim().eq_ignore_ascii_case("filename") {
            plain = Some(percent_decode(raw_value));
        }
    }
    plain
}

fn content_type_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

fn content_length_from_headers(headers: &HeaderMap) -> Option<u64> {
    if let Some(total) = headers
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit_once('/').map(|(_, total)| total))
        .and_then(|total| total.parse::<u64>().ok())
    {
        return Some(total);
    }
    headers
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
}

fn filename_from_url(url: &reqwest::Url) -> Option<String> {
    url.path_segments()?
        .filter(|segment| !segment.is_empty())
        .last()
        .map(percent_decode)
}

fn strip_header_quotes(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .unwrap_or(value)
}

fn filename_star_value(value: &str) -> &str {
    let mut parts = value.splitn(3, '\'');
    if parts.next().is_some() && parts.next().is_some() {
        if let Some(encoded) = parts.next() {
            return encoded;
        }
    }
    value
        .find("''")
        .map(|index| &value[index + 2..])
        .unwrap_or(value)
}

fn sanitize_download_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() {
        default_download_filename()
    } else {
        cleaned
    }
}

fn inferred_extension(headers: &HeaderMap, bytes: &[u8]) -> Option<&'static str> {
    let content_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase());
    match content_type.as_deref() {
        Some("application/zip") | Some("application/x-zip-compressed") => Some("zip"),
        Some("application/json") => Some("json"),
        Some("application/pdf") => Some("pdf"),
        Some("application/x-msdownload")
        | Some("application/vnd.microsoft.portable-executable") => Some("exe"),
        Some("text/plain") => Some("txt"),
        _ if is_zip_bytes(bytes) => Some("zip"),
        _ => None,
    }
}

fn is_zip_bytes(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
}

fn unique_download_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(default_download_filename);
    let extension = path
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..1000 {
        let candidate = parent.join(format!("{} ({}){}", stem, index, extension));
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                output.push(high * 16 + low);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).to_string()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn default_download_filename() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format!("download-{}", timestamp)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            captcha::init(app.handle().clone());
            Ok(())
        })
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
            custom_provider::list_custom_providers,
            custom_provider::add_custom_provider,
            custom_provider::update_custom_provider,
            custom_provider::delete_custom_provider,
            proxy::start_proxy,
            proxy::stop_proxy,
            proxy::proxy_status,
            proxy_pool::list_account_pool,
            proxy_pool::add_account_to_pool,
            proxy_pool::set_account_pool_enabled,
            proxy_pool::remove_account_from_pool,
            restart::zcode_running,
            restart::refresh_zcode_app_server,
            restart::restart_zcode,
            restart::kill_zcode_for_switch,
            zcode_launcher_scan,
            zcode_launcher_enable,
            zcode_launcher_disable,
            download_url_to_file,
            inspect_download_url,
            download_url_to_directory,
            oauth::oauth_init,
            oauth::oauth_acquire_and_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
