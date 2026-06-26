use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::profile::{list_profiles, ProfileView};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountPoolEntry {
    pub profile_id: String,
    pub enabled: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountPoolEntryView {
    pub profile_id: String,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub avatar: String,
    pub family: String,
    pub mode: String,
    pub active: bool,
    pub enabled: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct AccountPoolStore {
    #[serde(default)]
    entries: Vec<AccountPoolEntry>,
}

fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn pool_file() -> Result<PathBuf, String> {
    Ok(crate::profile::zcode_settings_dir()
        .map_err(|e| e.to_string())?
        .join("account-profiles")
        .join("proxy-account-pool.json"))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn load_entries() -> Vec<AccountPoolEntry> {
    let Ok(path) = pool_file() else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<AccountPoolStore>(&text)
        .map(|store| store.entries)
        .unwrap_or_default()
}

fn save_entries(entries: &[AccountPoolEntry]) -> Result<(), String> {
    let path = pool_file()?;
    let text = serde_json::to_vec_pretty(&serde_json::json!({
        "schema": "zcode-switcher-proxy-account-pool/v1",
        "entries": entries,
    }))
    .map_err(|e| e.to_string())?;
    atomic_write(&path, &text)
}

fn profile_view_for_entry(
    entry: &AccountPoolEntry,
    profiles: &[ProfileView],
) -> Option<AccountPoolEntryView> {
    let profile = profiles.iter().find(|p| p.profile.id == entry.profile_id)?;
    Some(AccountPoolEntryView {
        profile_id: entry.profile_id.clone(),
        name: profile.profile.name.clone(),
        email: profile.profile.email.clone(),
        phone: profile.profile.phone.clone(),
        avatar: profile.profile.avatar.clone(),
        family: if profile.profile.family.is_empty() {
            "zai".to_string()
        } else {
            profile.profile.family.clone()
        },
        mode: if profile.profile.mode.is_empty() {
            "oauth".to_string()
        } else {
            profile.profile.mode.clone()
        },
        active: profile.active,
        enabled: entry.enabled,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
    })
}

pub fn enabled_pool_profiles() -> Result<Vec<ProfileView>, String> {
    let entries = load_entries();
    let enabled_ids: HashSet<String> = entries
        .into_iter()
        .filter(|entry| entry.enabled)
        .map(|entry| entry.profile_id)
        .collect();
    if enabled_ids.is_empty() {
        return Ok(Vec::new());
    }
    Ok(list_profiles()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|profile| enabled_ids.contains(&profile.profile.id))
        .collect())
}

#[tauri::command]
pub fn list_account_pool() -> Result<Vec<AccountPoolEntryView>, String> {
    let profiles = list_profiles().map_err(|e| e.to_string())?;
    Ok(load_entries()
        .into_iter()
        .filter_map(|entry| profile_view_for_entry(&entry, &profiles))
        .collect())
}

#[tauri::command]
pub fn add_account_to_pool(profile_id: String) -> Result<AccountPoolEntryView, String> {
    let profiles = list_profiles().map_err(|e| e.to_string())?;
    if !profiles
        .iter()
        .any(|profile| profile.profile.id == profile_id)
    {
        return Err("账号不存在".into());
    }
    let mut entries = load_entries();
    if let Some(entry) = entries
        .iter_mut()
        .find(|entry| entry.profile_id == profile_id)
    {
        entry.enabled = true;
        entry.updated_at = now_ts();
        let view =
            profile_view_for_entry(entry, &profiles).ok_or_else(|| "账号不存在".to_string())?;
        save_entries(&entries)?;
        return Ok(view);
    }
    let entry = AccountPoolEntry {
        profile_id,
        enabled: true,
        created_at: now_ts(),
        updated_at: now_ts(),
    };
    let view = profile_view_for_entry(&entry, &profiles).ok_or_else(|| "账号不存在".to_string())?;
    entries.push(entry);
    save_entries(&entries)?;
    Ok(view)
}

#[tauri::command]
pub fn set_account_pool_enabled(
    profile_id: String,
    enabled: bool,
) -> Result<AccountPoolEntryView, String> {
    let profiles = list_profiles().map_err(|e| e.to_string())?;
    let mut entries = load_entries();
    let entry = entries
        .iter_mut()
        .find(|entry| entry.profile_id == profile_id)
        .ok_or_else(|| "账号不在账号池中".to_string())?;
    entry.enabled = enabled;
    entry.updated_at = now_ts();
    let view = profile_view_for_entry(entry, &profiles).ok_or_else(|| "账号不存在".to_string())?;
    save_entries(&entries)?;
    Ok(view)
}

#[tauri::command]
pub fn remove_account_from_pool(profile_id: String) -> Result<bool, String> {
    let mut entries = load_entries();
    let before = entries.len();
    entries.retain(|entry| entry.profile_id != profile_id);
    let changed = entries.len() != before;
    if changed {
        save_entries(&entries)?;
    }
    Ok(changed)
}
