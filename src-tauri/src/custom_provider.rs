use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ApiFormat {
    Anthropic,
    OpenAI,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub api_format: ApiFormat,
    pub models: Vec<String>,
    pub enabled: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct CustomProviderView {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_format: ApiFormat,
    pub models: Vec<String>,
    pub enabled: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct ProviderStore {
    #[serde(default)]
    providers: Vec<CustomProvider>,
}

impl From<CustomProvider> for CustomProviderView {
    fn from(provider: CustomProvider) -> Self {
        Self {
            id: provider.id,
            name: provider.name,
            base_url: provider.base_url,
            api_format: provider.api_format,
            models: provider.models,
            enabled: provider.enabled,
            created_at: provider.created_at,
            updated_at: provider.updated_at,
        }
    }
}

fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn providers_dir() -> Result<PathBuf, String> {
    Ok(crate::profile::zcode_settings_dir()
        .map_err(|e| e.to_string())?
        .join("account-profiles"))
}

fn providers_file() -> Result<PathBuf, String> {
    Ok(providers_dir()?.join("custom-providers.json"))
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

fn load_providers() -> Vec<CustomProvider> {
    let Ok(path) = providers_file() else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<ProviderStore>(&text)
        .map(|store| store.providers)
        .unwrap_or_default()
}

fn save_providers(providers: &[CustomProvider]) -> Result<(), String> {
    let path = providers_file()?;
    let text = serde_json::to_vec_pretty(&serde_json::json!({
        "schema": "zcode-switcher-custom-providers/v1",
        "providers": providers,
    }))
    .map_err(|e| e.to_string())?;
    atomic_write(&path, &text)
}

fn normalize_base_url(value: &str) -> Result<String, String> {
    let trimmed = value.trim().trim_end_matches('/').to_string();
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        return Err("服务商地址必须以 http:// 或 https:// 开头".into());
    }
    Ok(trimmed)
}

fn normalize_models(models: Vec<String>) -> Result<Vec<String>, String> {
    let out: Vec<String> = models
        .into_iter()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .collect();
    if out.is_empty() {
        return Err("请至少填写一个模型名称".into());
    }
    Ok(out)
}

fn provider_view_list(providers: Vec<CustomProvider>) -> Vec<CustomProviderView> {
    providers
        .into_iter()
        .map(CustomProviderView::from)
        .collect()
}

pub fn enabled_providers_with_keys() -> Vec<(CustomProviderView, String)> {
    load_providers()
        .into_iter()
        .filter(|p| p.enabled)
        .filter_map(|p| {
            let key = crate::crypto::decrypt(&p.api_key).ok()?;
            Some((p.into(), key))
        })
        .collect()
}

#[tauri::command]
pub fn list_custom_providers() -> Result<Vec<CustomProviderView>, String> {
    Ok(provider_view_list(load_providers()))
}

#[tauri::command]
pub fn add_custom_provider(
    name: String,
    base_url: String,
    api_key: String,
    api_format: ApiFormat,
    models: Vec<String>,
) -> Result<CustomProviderView, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("服务商名称不能为空".into());
    }
    let base_url = normalize_base_url(&base_url)?;
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("API Key 不能为空".into());
    }
    let models = normalize_models(models)?;

    let mut providers = load_providers();
    let seed = format!("{}:{}:{}", name, base_url, now_ts());
    let id = sha256_hex(seed.as_bytes())[..12].to_string();
    let provider = CustomProvider {
        id,
        name,
        base_url,
        api_key: crate::crypto::encrypt(&api_key)?,
        api_format,
        models,
        enabled: true,
        created_at: now_ts(),
        updated_at: now_ts(),
    };
    providers.push(provider.clone());
    save_providers(&providers)?;
    Ok(provider.into())
}

#[tauri::command]
pub fn update_custom_provider(
    id: String,
    name: String,
    base_url: String,
    api_key: Option<String>,
    api_format: ApiFormat,
    models: Vec<String>,
    enabled: bool,
) -> Result<CustomProviderView, String> {
    let mut providers = load_providers();
    let idx = providers
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "服务商不存在".to_string())?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("服务商名称不能为空".into());
    }
    providers[idx].name = name;
    providers[idx].base_url = normalize_base_url(&base_url)?;
    providers[idx].api_format = api_format;
    providers[idx].models = normalize_models(models)?;
    providers[idx].enabled = enabled;
    providers[idx].updated_at = now_ts();
    if let Some(key) = api_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
    {
        providers[idx].api_key = crate::crypto::encrypt(&key)?;
    }
    let view = providers[idx].clone().into();
    save_providers(&providers)?;
    Ok(view)
}

#[tauri::command]
pub fn delete_custom_provider(id: String) -> Result<bool, String> {
    let mut providers = load_providers();
    let before = providers.len();
    providers.retain(|p| p.id != id);
    let changed = providers.len() != before;
    if changed {
        save_providers(&providers)?;
    }
    Ok(changed)
}
