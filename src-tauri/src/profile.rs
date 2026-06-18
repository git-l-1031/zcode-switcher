//! 账号档案库：读取/写入 credentials.json 的快照。
//!
//! 路径与数据格式与 Python 版完全一致，已保存的档案可被任一版本接管：
//!   - 凭据文件:  ~/.zcode/v2/credentials.json
//!   - 身份指纹:  ~/.zcode/v2/config.json 里 coding-plan 的 JWT apiKey
//!   - 档案库:    ~/.zcode/v2/account-profiles/profiles.json (+ credentials.{id}.json)
//!   - 备份:      ~/.zcode/v2/account-backups/credentials.switch.{ts}.json

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use zip::write::FileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::jwt;

/// 命令错误类型：Tauri 2 要求返回的错误实现 Serialize + Into<InvokeError>。
/// 这里把错误序列化成字符串返回给前端。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

/// 把任何可显示的错误转成 AppError::Msg
fn err<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Msg(e.to_string())
}

type R<T> = std::result::Result<T, AppError>;

// --------------------------------------------------------------------------- //
//  路径
// --------------------------------------------------------------------------- //
fn zcode_v2_dir() -> R<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Msg("找不到用户主目录".into()))?;
    Ok(home.join(".zcode").join("v2"))
}

pub fn credentials_file() -> R<PathBuf> {
    Ok(zcode_v2_dir()?.join("credentials.json"))
}

fn config_file() -> R<PathBuf> {
    Ok(zcode_v2_dir()?.join("config.json"))
}

fn profiles_dir() -> R<PathBuf> {
    Ok(zcode_v2_dir()?.join("account-profiles"))
}

fn profiles_index() -> R<PathBuf> {
    Ok(profiles_dir()?.join("profiles.json"))
}

fn backup_dir() -> R<PathBuf> {
    Ok(zcode_v2_dir()?.join("account-backups"))
}

// --------------------------------------------------------------------------- //
//  数据结构
// --------------------------------------------------------------------------- //
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub avatar: String,
    pub cred_hash: String,
    #[serde(default)]
    pub cred_file: String,
    pub created_at: f64,
    pub updated_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileView {
    #[serde(flatten)]
    pub profile: Profile,
    pub active: bool,
    /// 显示用的短 id
    pub short_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortableAccount {
    pub schema: String,
    pub exported_at: f64,
    pub profile: PortableProfile,
    pub credentials: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortableAccountBundle {
    pub schema: String,
    pub exported_at: f64,
    pub accounts: Vec<PortableAccount>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortableProfile {
    pub name: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub avatar: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
    pub messages: Vec<String>,
}

// --------------------------------------------------------------------------- //
//  工具函数
// --------------------------------------------------------------------------- //
fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn sha256_bytes(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

fn safe_export_file_name(name: &str, fallback: &str, index: usize) -> String {
    let mut out = String::new();
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('_');
        }
    }
    let base = if out.trim_matches('_').is_empty() {
        fallback.to_string()
    } else {
        out.trim_matches('_').chars().take(36).collect()
    };
    format!("{:03}-{}-{}.json", index + 1, base, fallback)
}

fn short_id(uid: &str) -> String {
    if uid.is_empty() {
        return String::new();
    }
    let chars: Vec<char> = uid.chars().collect();
    if chars.len() <= 10 {
        uid.to_string()
    } else {
        let head: String = chars[..6].iter().collect();
        let tail: String = chars[chars.len() - 4..].iter().collect();
        format!("{}…{}", head, tail)
    }
}

/// 从 config.json 提取 user_id（coding-plan 的 JWT apiKey payload）。
fn extract_user_id_from_config() -> String {
    let path = match config_file() {
        Ok(p) => p,
        Err(_) => return String::new(),
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return String::new();
    };
    let Ok(cfg) = serde_json::from_str::<Value>(&text) else {
        return String::new();
    };
    let Some(providers) = cfg.get("provider").and_then(|v| v.as_object()) else {
        return String::new();
    };
    for (_key, prov) in providers {
        let Some(opts) = prov.get("options").and_then(|v| v.as_object()) else {
            continue;
        };
        let api_key = opts.get("apiKey").and_then(|v| v.as_str()).unwrap_or("");
        if api_key.starts_with("eyJ") {
            if let Some(uid) = jwt::extract_user_id(api_key) {
                return uid;
            }
        }
    }
    String::new()
}

#[derive(Debug, Clone, Default)]
struct AccountIdentity {
    name: String,
    email: String,
    phone: String,
    avatar: String,
}

impl AccountIdentity {
    fn key(&self) -> Option<String> {
        identity_key(&self.email, &self.phone)
    }
}

/// 从 credentials.json 字节里解密出账号身份。
fn extract_identity_from_credentials(cred_bytes: &[u8]) -> AccountIdentity {
    let Ok(text) = std::str::from_utf8(cred_bytes) else {
        return AccountIdentity::default();
    };
    let Ok(creds) = serde_json::from_str::<Value>(text) else {
        return AccountIdentity::default();
    };
    match crate::crypto::extract_user_info(&creds) {
        Some(info) => {
            let phone = info
                .phone
                .or(info.phone_number)
                .or(info.mobile)
                .or(info.mobile_phone)
                .unwrap_or_default();
            AccountIdentity {
                name: info.name.unwrap_or_default(),
                email: info.email.unwrap_or_default(),
                phone,
                avatar: info.avatar.unwrap_or_default(),
            }
        }
        None => AccountIdentity::default(),
    }
}

fn decrypt_portable_credentials(value: Value) -> R<Value> {
    let Value::Object(map) = value else {
        return Err(AppError::Msg("credentials 必须是 JSON 对象".into()));
    };
    let mut out = Map::with_capacity(map.len());
    for (key, value) in map {
        let converted = match value {
            Value::String(s) if crate::crypto::is_encrypted(&s) => {
                Value::String(crate::crypto::decrypt(&s).map_err(AppError::Msg)?)
            }
            other => other,
        };
        out.insert(key, converted);
    }
    Ok(Value::Object(out))
}

fn encrypt_portable_credentials(value: Value) -> R<Vec<u8>> {
    let Value::Object(map) = value else {
        return Err(AppError::Msg("credentials 必须是 JSON 对象".into()));
    };
    let mut out = Map::with_capacity(map.len());
    for (key, value) in map {
        let converted = match value {
            Value::String(s) => Value::String(crate::crypto::encrypt(&s).map_err(AppError::Msg)?),
            other => other,
        };
        out.insert(key, converted);
    }
    serde_json::to_vec_pretty(&Value::Object(out)).map_err(AppError::from)
}

/// 默认账号名：优先用户名(name)，其次邮箱名（@ 前部分），再其次手机号，最后短 user_id。
fn default_name(name: &str, email: &str, phone: &str, user_id: &str) -> String {
    let n = name.trim();
    if !n.is_empty() {
        return n.to_string();
    }
    if let Some(at) = email.find('@') {
        return email[..at].to_string();
    }
    if !email.is_empty() {
        return email.to_string();
    }
    if !phone.is_empty() {
        return format!("账号 {}", phone);
    }
    if !user_id.is_empty() {
        return format!("账号 {}", short_id(user_id));
    }
    format!("账号 {}", chrono::Local::now().format("%m%d-%H%M"))
}

fn normalize_email(email: &str) -> String {
    email.trim().to_ascii_lowercase()
}

fn normalize_phone(phone: &str) -> String {
    phone.chars().filter(|ch| ch.is_ascii_digit()).collect()
}

fn identity_key(email: &str, phone: &str) -> Option<String> {
    let email = normalize_email(email);
    if !email.is_empty() {
        return Some(format!("email:{}", email));
    }
    let phone = normalize_phone(phone);
    if !phone.is_empty() {
        return Some(format!("phone:{}", phone));
    }
    None
}

fn account_label(email: &str, phone: &str) -> String {
    let email = normalize_email(email);
    if !email.is_empty() {
        return format!("邮箱 {}", email);
    }
    let phone = normalize_phone(phone);
    if !phone.is_empty() {
        return format!("手机号 {}", phone);
    }
    "未知账号".to_string()
}

/// 原子写入：先写 .tmp 再 rename，避免写一半导致文件损坏。
fn atomic_write(path: &Path, data: &[u8]) -> R<()> {
    let mut tmp = path.to_path_buf();
    tmp.set_extension("tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

// --------------------------------------------------------------------------- //
//  仓库操作
// --------------------------------------------------------------------------- //

/// 读取索引；文件不存在或损坏则返回空列表。
fn load_index() -> Vec<Profile> {
    let Ok(path) = profiles_index() else {
        return vec![];
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return vec![];
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_index(profiles: &[Profile]) -> R<()> {
    let dir = profiles_dir()?;
    fs::create_dir_all(&dir)?;
    let data = serde_json::to_string_pretty(profiles)?;
    atomic_write(&profiles_index()?, data.as_bytes())
}

fn current_identity() -> Option<AccountIdentity> {
    let path = credentials_file().ok()?;
    if !path.exists() {
        return None;
    }
    let cred_bytes = fs::read(path).ok()?;
    Some(extract_identity_from_credentials(&cred_bytes))
}

fn find_profile_by_identity<'a>(
    profiles: &'a [Profile],
    identity: &AccountIdentity,
) -> Option<&'a Profile> {
    let key = identity.key()?;
    profiles
        .iter()
        .find(|p| identity_key(&p.email, &p.phone).as_deref() == Some(key.as_str()))
}

fn update_profile_from_capture(
    profile: &mut Profile,
    final_name: String,
    user_id: String,
    email: String,
    phone: String,
    avatar: String,
    cred_hash: String,
    cred_bytes: &[u8],
) -> R<Profile> {
    if !profile.cred_file.is_empty() {
        fs::write(profiles_dir()?.join(&profile.cred_file), cred_bytes)?;
    }
    profile.name = final_name;
    profile.user_id = user_id;
    profile.email = email;
    profile.phone = phone;
    if !avatar.is_empty() {
        profile.avatar = avatar;
    }
    profile.cred_hash = cred_hash;
    profile.updated_at = now_ts();
    Ok(profile.clone())
}

/// 切换前把当前 credentials.json 备份到 account-backups/。
fn backup_current(reason: &str) -> R<Option<PathBuf>> {
    let cur = credentials_file()?;
    if !cur.exists() {
        return Ok(None);
    }
    let dir = backup_dir()?;
    fs::create_dir_all(&dir)?;
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dst = dir.join(format!("credentials.{}.{}.json", reason, ts));
    fs::copy(&cur, &dst)?;
    Ok(Some(dst))
}

/// 切换前把当前 config.json 备份到 account-backups/。
fn backup_current_config(reason: &str) -> R<Option<PathBuf>> {
    let cur = config_file()?;
    if !cur.exists() {
        return Ok(None);
    }
    let dir = backup_dir()?;
    fs::create_dir_all(&dir)?;
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dst = dir.join(format!("config.{}.{}.json", reason, ts));
    fs::copy(&cur, &dst)?;
    Ok(Some(dst))
}

fn zcode_jwt_from_credentials(cred_bytes: &[u8]) -> R<Option<String>> {
    let creds: Value = serde_json::from_slice(cred_bytes)?;
    Ok(crate::crypto::extract_jwt_token(&creds)
        .map(|token| token.trim().to_string())
        .filter(|token| token.starts_with("eyJ")))
}

fn prepare_zai_start_plan_config_update(cred_bytes: &[u8]) -> R<Option<(PathBuf, Vec<u8>)>> {
    let Some(jwt) = zcode_jwt_from_credentials(cred_bytes)? else {
        return Ok(None);
    };
    let path = config_file()?;
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(&path)?;
    let mut cfg: Value = serde_json::from_str(&text)?;
    let Some(options) = cfg
        .get_mut("provider")
        .and_then(Value::as_object_mut)
        .and_then(|providers| providers.get_mut("builtin:zai-start-plan"))
        .and_then(|provider| provider.get_mut("options"))
        .and_then(Value::as_object_mut)
    else {
        return Ok(None);
    };

    if options.get("apiKey").and_then(Value::as_str) == Some(jwt.as_str()) {
        return Ok(None);
    }
    options.insert("apiKey".to_string(), Value::String(jwt));
    let data = serde_json::to_vec_pretty(&cfg)?;
    Ok(Some((path, data)))
}

// --------------------------------------------------------------------------- //
//  对外命令
// --------------------------------------------------------------------------- //

/// 列出所有档案，并标记当前活跃的那个。
#[tauri::command]
pub fn list_profiles() -> R<Vec<ProfileView>> {
    let profiles = load_index();
    let active_key = current_identity().and_then(|identity| identity.key());
    let views = profiles
        .into_iter()
        .map(|p| {
            let active = active_key
                .as_ref()
                .map(|key| identity_key(&p.email, &p.phone).as_deref() == Some(key.as_str()))
                .unwrap_or(false);
            let short_id = short_id(&p.user_id);
            ProfileView {
                profile: p,
                active,
                short_id,
            }
        })
        .collect();
    Ok(views)
}

/// 返回当前登录状态：是否已登录、当前账号名（若已识别）。
#[derive(Serialize)]
pub struct CurrentStatus {
    pub logged_in: bool,
    pub active_profile_id: Option<String>,
    pub active_profile_name: Option<String>,
    pub current_username: String,
    pub current_email: String,
    pub current_phone: String,
}

#[tauri::command]
pub fn current_status() -> R<CurrentStatus> {
    let cur = credentials_file()?;
    if !cur.exists() {
        return Ok(CurrentStatus {
            logged_in: false,
            active_profile_id: None,
            active_profile_name: None,
            current_username: String::new(),
            current_email: String::new(),
            current_phone: String::new(),
        });
    }
    let cred_bytes = fs::read(&cur).unwrap_or_default();
    let identity = extract_identity_from_credentials(&cred_bytes);
    let profiles = load_index();
    let matched = find_profile_by_identity(&profiles, &identity);
    Ok(CurrentStatus {
        logged_in: true,
        active_profile_id: matched.map(|p| p.id.clone()),
        active_profile_name: matched.map(|p| p.name.clone()),
        current_username: identity.name,
        current_email: identity.email,
        current_phone: identity.phone,
    })
}

/// 把当前 credentials.json 保存为账号档案。
/// 邮箱优先、手机号兜底作为账号唯一标识；再次保存同账号时更新已有档案。
#[tauri::command]
pub fn capture_current(name: String) -> R<Profile> {
    let cur = credentials_file()?;
    if !cur.exists() {
        return Err(AppError::Msg(
            "找不到 credentials.json，请先在 ZCode 登录。".into(),
        ));
    }
    let cred_bytes = fs::read(&cur)?;
    let cred_hash = sha256_bytes(&cred_bytes);

    // 从 config.json 取 user_id（JWT），并尝试从解密后的 user_info 取 用户名/email/avatar
    let user_id = extract_user_id_from_config();
    let identity = extract_identity_from_credentials(&cred_bytes);
    let Some(key) = identity.key() else {
        return Err(AppError::Msg(
            "未识别到当前账号邮箱或手机号，无法确认唯一账号。请先在 ZCode 重新登录后再保存。"
                .into(),
        ));
    };

    // 默认名字：若用户没自定义，优先用用户名(name)，其次邮箱名或手机号。
    let final_name = if name.trim().is_empty() {
        default_name(&identity.name, &identity.email, &identity.phone, &user_id)
    } else {
        name
    };

    let mut profiles = load_index();

    // 邮箱优先、手机号兜底作为唯一标识；再次保存同账号时更新凭据副本而不是新增档案。
    if let Some(p) = profiles
        .iter_mut()
        .find(|p| identity_key(&p.email, &p.phone).as_deref() == Some(key.as_str()))
    {
        let saved = update_profile_from_capture(
            p,
            final_name,
            user_id.clone(),
            identity.email.clone(),
            identity.phone.clone(),
            identity.avatar.clone(),
            cred_hash,
            &cred_bytes,
        )?;
        save_index(&profiles)?;
        return Ok(saved);
    }

    // 新建：内部 id 使用唯一身份 hash，避免依赖不稳定身份字段。
    let id = sha256_bytes(key.as_bytes())[..12].to_string();
    let cred_file_name = format!("credentials.{}.json", id);
    let dir = profiles_dir()?;
    fs::create_dir_all(&dir)?;
    fs::write(dir.join(&cred_file_name), &cred_bytes)?;

    let profile = Profile {
        id: id.clone(),
        name: final_name,
        user_id,
        email: identity.email,
        phone: identity.phone,
        avatar: identity.avatar,
        cred_hash,
        cred_file: cred_file_name,
        created_at: now_ts(),
        updated_at: now_ts(),
    };
    profiles.push(profile.clone());
    save_index(&profiles)?;
    Ok(profile)
}

/// 切换到指定档案：备份当前 → 写入目标凭据（原子写）。
#[tauri::command]
pub fn switch_to(id: String) -> R<Profile> {
    let mut profiles = load_index();
    let idx = profiles
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| AppError::Msg("档案不存在".into()))?;
    let profile = profiles[idx].clone();

    // 找凭据副本
    let dir = profiles_dir()?;
    let cred_path = dir.join(&profile.cred_file);
    if !cred_path.exists() {
        return Err(AppError::Msg(
            "该档案缺少凭据副本，无法切换。请重新捕获。".into(),
        ));
    }
    let cred_bytes = fs::read(&cred_path)?;
    let config_update = prepare_zai_start_plan_config_update(&cred_bytes)?;

    // 备份当前
    let credential_backup = backup_current("switch")?;
    if config_update.is_some() {
        let _ = backup_current_config("switch")?;
    }

    // 原子写入 credentials.json
    let active_credentials = credentials_file()?;
    atomic_write(&active_credentials, &cred_bytes)?;
    if let Some((config_path, config_bytes)) = config_update {
        if let Err(e) = atomic_write(&config_path, &config_bytes) {
            if let Some(backup) = credential_backup {
                let _ = fs::copy(backup, &active_credentials);
            }
            return Err(e);
        }
    }

    profiles[idx].updated_at = now_ts();
    save_index(&profiles)?;
    Ok(profile)
}

/// 重命名档案。
#[tauri::command]
pub fn rename_profile(id: String, name: String) -> R<bool> {
    let mut profiles = load_index();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Msg("名称不能为空".into()));
    }
    for p in profiles.iter_mut() {
        if p.id == id {
            p.name = trimmed.to_string();
            p.updated_at = now_ts();
            save_index(&profiles)?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// 删除档案（禁止删除当前活跃的）。
#[tauri::command]
pub fn delete_profile(id: String) -> R<bool> {
    let mut profiles = load_index();

    // 不允许删除当前正在使用的账号
    if let Some(identity) = current_identity() {
        let current_key = identity.key();
        let is_active = profiles.iter().any(|p| {
            p.id == id && current_key.as_deref() == identity_key(&p.email, &p.phone).as_deref()
        });
        if is_active {
            return Err(AppError::Msg("不能删除当前正在使用的账号".into()));
        }
    }

    let before = profiles.len();
    // 先删凭据副本（取出文件名再 remove，避免借用冲突）
    let cred_file = profiles
        .iter()
        .find(|p| p.id == id)
        .map(|p| p.cred_file.clone());
    if let Some(cf) = cred_file {
        if !cf.is_empty() {
            let fp = profiles_dir()?.join(&cf);
            let _ = fs::remove_file(fp);
        }
    }
    profiles.retain(|p| p.id != id);
    let changed = profiles.len() != before;
    save_index(&profiles)?;
    Ok(changed)
}

#[tauri::command]
pub fn export_profile_json(id: String) -> R<String> {
    let profiles = load_index();
    let profile = profiles
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::Msg("档案不存在".into()))?;
    let portable = portable_account_from_profile(profile)?;
    serde_json::to_string_pretty(&portable).map_err(AppError::from)
}

fn portable_account_from_profile(profile: Profile) -> R<PortableAccount> {
    if profile.cred_file.is_empty() {
        return Err(AppError::Msg("该档案缺少凭据副本".into()));
    }
    let cred_path = profiles_dir()?.join(&profile.cred_file);
    if !cred_path.exists() {
        return Err(AppError::Msg("该档案缺少凭据副本，无法导出。".into()));
    }
    let cred_value: Value = serde_json::from_slice(&fs::read(&cred_path)?)?;
    Ok(PortableAccount {
        schema: "zcode-switcher-account/v1".to_string(),
        exported_at: now_ts(),
        profile: PortableProfile {
            name: profile.name,
            user_id: profile.user_id,
            email: profile.email,
            phone: profile.phone,
            avatar: profile.avatar,
        },
        credentials: decrypt_portable_credentials(cred_value)?,
    })
}

#[tauri::command]
pub fn import_profile_json(json_text: String) -> R<Profile> {
    let portable: PortableAccount = serde_json::from_str(&json_text)?;
    if portable.schema != "zcode-switcher-account/v1" {
        return Err(AppError::Msg("不支持的账号 JSON 格式".into()));
    }
    import_portable_account(portable)
}

fn import_portable_account(portable: PortableAccount) -> R<Profile> {
    let cred_bytes = encrypt_portable_credentials(portable.credentials)?;
    let cred_hash = sha256_bytes(&cred_bytes);
    let identity_from_creds = extract_identity_from_credentials(&cred_bytes);

    let user_id = portable.profile.user_id.trim().to_string();
    let email = if !identity_from_creds.email.trim().is_empty() {
        identity_from_creds.email
    } else {
        portable.profile.email.trim().to_string()
    };
    let phone = if !identity_from_creds.phone.trim().is_empty() {
        identity_from_creds.phone
    } else {
        portable.profile.phone.trim().to_string()
    };
    let Some(key) = identity_key(&email, &phone) else {
        return Err(AppError::Msg(
            "未识别到账号邮箱或手机号，无法确认唯一账号，未导入。".into(),
        ));
    };
    let avatar = if !portable.profile.avatar.trim().is_empty() {
        portable.profile.avatar.trim().to_string()
    } else {
        identity_from_creds.avatar
    };
    let final_name = if portable.profile.name.trim().is_empty() {
        default_name(&identity_from_creds.name, &email, &phone, &user_id)
    } else {
        portable.profile.name.trim().to_string()
    };

    let mut profiles = load_index();
    if let Some(existing) = profiles
        .iter()
        .find(|p| identity_key(&p.email, &p.phone).as_deref() == Some(key.as_str()))
    {
        return Err(AppError::Msg(format!(
            "账号标识 {} 已存在于账号「{}」，未重复导入。",
            account_label(&email, &phone),
            existing.name
        )));
    }

    let id = sha256_bytes(key.as_bytes())[..12].to_string();
    let cred_file_name = format!("credentials.{}.json", id);
    let dir = profiles_dir()?;
    fs::create_dir_all(&dir)?;
    fs::write(dir.join(&cred_file_name), &cred_bytes)?;

    let profile = Profile {
        id: id.clone(),
        name: final_name,
        user_id,
        email,
        phone,
        avatar,
        cred_hash,
        cred_file: cred_file_name,
        created_at: now_ts(),
        updated_at: now_ts(),
    };
    profiles.push(profile.clone());
    save_index(&profiles)?;
    Ok(profile)
}

#[tauri::command]
pub fn export_profiles_bundle_to_file(path: String) -> R<()> {
    let profiles = load_index();
    if profiles.is_empty() {
        return Err(AppError::Msg("没有可导出的账号".into()));
    }
    write_profiles_zip(profiles, path)
}

/// 按给定 id 列表导出账号压缩包（支持选择）。
#[tauri::command]
pub fn export_profiles_to_file(ids: Vec<String>, path: String) -> R<()> {
    if ids.is_empty() {
        return Err(AppError::Msg("未选择任何账号".into()));
    }
    let all = load_index();
    let id_set: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
    let selected: Vec<Profile> = all
        .into_iter()
        .filter(|p| id_set.contains(p.id.as_str()))
        .collect();
    if selected.is_empty() {
        return Err(AppError::Msg("未找到匹配的账号".into()));
    }
    write_profiles_zip(selected, path)
}

/// 把账号列表写成 zip（每个账号一个 JSON 文件）。
fn write_profiles_zip(profiles: Vec<Profile>, path: String) -> R<()> {
    let file = fs::File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default().compression_method(CompressionMethod::Deflated);
    for (index, profile) in profiles.into_iter().enumerate() {
        let fallback = if !profile.user_id.is_empty() {
            profile.user_id.chars().take(12).collect::<String>()
        } else if !profile.id.is_empty() {
            profile.id.chars().take(12).collect::<String>()
        } else {
            profile.cred_hash.chars().take(12).collect::<String>()
        };
        let file_name = safe_export_file_name(&profile.name, &fallback, index);
        let account = portable_account_from_profile(profile)?;
        let json = serde_json::to_string_pretty(&account)?;
        zip.start_file(file_name, options).map_err(err)?;
        zip.write_all(json.as_bytes())?;
    }
    zip.finish().map_err(err)?;
    Ok(())
}

fn import_json_into_report(json: &str, source: &str, report: &mut BatchImportReport) {
    let Ok(value) = serde_json::from_str::<Value>(json) else {
        report.failed += 1;
        report.messages.push(format!("{}：JSON 格式无效", source));
        return;
    };
    let schema = value
        .get("schema")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let accounts = if schema == "zcode-switcher-accounts/v1" {
        match serde_json::from_value::<PortableAccountBundle>(value) {
            Ok(bundle) => bundle.accounts,
            Err(e) => {
                report.failed += 1;
                report
                    .messages
                    .push(format!("{}：账号包格式无效：{}", source, e));
                return;
            }
        }
    } else if schema == "zcode-switcher-account/v1" {
        match serde_json::from_value::<PortableAccount>(value) {
            Ok(account) => vec![account],
            Err(e) => {
                report.failed += 1;
                report
                    .messages
                    .push(format!("{}：账号格式无效：{}", source, e));
                return;
            }
        }
    } else {
        report.failed += 1;
        report
            .messages
            .push(format!("{}：不支持的账号 JSON 格式", source));
        return;
    };

    for account in accounts {
        let name = account.profile.name.clone();
        if account.schema != "zcode-switcher-account/v1" {
            report.failed += 1;
            let label = if name.trim().is_empty() {
                source
            } else {
                name.as_str()
            };
            report
                .messages
                .push(format!("{}：不支持的账号 JSON 格式", label));
            continue;
        }
        match import_portable_account(account) {
            Ok(_) => report.imported += 1,
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("已存在") || msg.contains("重复导入") {
                    report.skipped += 1;
                } else {
                    report.failed += 1;
                }
                let label = if name.trim().is_empty() {
                    source
                } else {
                    name.as_str()
                };
                report.messages.push(format!("{}：{}", label, msg));
            }
        }
    }
}

#[tauri::command]
pub fn import_profiles_from_files(paths: Vec<String>) -> R<BatchImportReport> {
    if paths.is_empty() {
        return Err(AppError::Msg("请选择要导入的 JSON 文件".into()));
    }
    let mut report = BatchImportReport {
        imported: 0,
        skipped: 0,
        failed: 0,
        messages: Vec::new(),
    };
    for path in paths {
        if path.to_lowercase().ends_with(".zip") {
            match fs::File::open(&path)
                .map_err(AppError::from)
                .and_then(|file| ZipArchive::new(file).map_err(err))
            {
                Ok(mut archive) => {
                    for i in 0..archive.len() {
                        match archive.by_index(i).map_err(err) {
                            Ok(mut file) => {
                                let name = file.name().to_string();
                                if !name.to_lowercase().ends_with(".json") {
                                    continue;
                                }
                                let mut json = String::new();
                                match file.read_to_string(&mut json) {
                                    Ok(_) => {
                                        let source = format!("{}:{}", path, name);
                                        import_json_into_report(&json, &source, &mut report);
                                    }
                                    Err(e) => {
                                        report.failed += 1;
                                        report.messages.push(format!("{}:{}：{}", path, name, e));
                                    }
                                }
                            }
                            Err(e) => {
                                report.failed += 1;
                                report.messages.push(format!("{}：{}", path, e));
                            }
                        }
                    }
                }
                Err(e) => {
                    report.failed += 1;
                    report.messages.push(format!("{}：{}", path, e));
                }
            }
        } else {
            match fs::read_to_string(&path) {
                Ok(json) => import_json_into_report(&json, &path, &mut report),
                Err(e) => {
                    report.failed += 1;
                    report.messages.push(format!("{}：{}", path, e));
                }
            }
        }
    }
    Ok(report)
}

#[tauri::command]
pub fn export_profile_to_file(id: String, path: String) -> R<()> {
    let json = export_profile_json(id)?;
    fs::write(path, json.as_bytes())?;
    Ok(())
}

#[tauri::command]
pub fn import_profile_from_file(path: String) -> R<Profile> {
    let json = fs::read_to_string(path)?;
    import_profile_json(json)
}

/// 在系统文件管理器里打开 ZCode 配置目录。
#[tauri::command]
pub fn open_config_dir() -> R<()> {
    let dir = zcode_v2_dir()?;
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(err)?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
    }
    Ok(())
}

/// 查询某个档案的订阅额度。
/// id 为空时查询"当前登录"的账号。
#[tauri::command]
pub async fn fetch_quota(id: Option<String>) -> R<crate::quota::QuotaInfo> {
    let cred_bytes = match id {
        Some(i) if !i.is_empty() => {
            // 从档案副本读取
            let profiles = load_index();
            let p = profiles
                .into_iter()
                .find(|p| p.id == i)
                .ok_or_else(|| AppError::Msg("档案不存在".into()))?;
            if p.cred_file.is_empty() {
                return Err(AppError::Msg("该档案缺少凭据副本".into()));
            }
            fs::read(profiles_dir()?.join(&p.cred_file))?
        }
        _ => {
            // 当前 credentials.json
            let path = credentials_file()?;
            if !path.exists() {
                return Err(AppError::Msg(
                    "找不到 credentials.json，请先在 ZCode 登录。".into(),
                ));
            }
            fs::read(&path)?
        }
    };
    let text = std::str::from_utf8(&cred_bytes)
        .map_err(|e| AppError::Msg(format!("credentials 不是 UTF-8：{}", e)))?;
    crate::quota::fetch_quota(text).await.map_err(AppError::Msg)
}
