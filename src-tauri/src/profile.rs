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

/// 复刻 ZCode 自己的数据目录基址解析逻辑（见 out/main/index.js 的 getDataBaseDir）：
///   ZCODE_DATA_BASE_DIR 环境变量 → HOME 环境变量 → os.homedir()
///
/// **为什么必须这样**：ZCode 用 `process.env.HOME || os.homedir()` 定位 `.zcode/v2`。
/// 而 Rust 的 `dirs::home_dir()` 在 Windows 上只认 USERPROFILE、**忽略 HOME**。
/// 如果用户机器上设了 HOME（装过 Git for Windows / WSL / 某些工具链都会设）或
/// ZCODE_DATA_BASE_DIR，ZCode 读写的目录就和我们写死的 USERPROFILE 目录不是同一个，
/// 导致 switcher 写的 credentials/config/setting 全落到 ZCode 看不到的地方 ——
/// 表现为"任何账号都切不了"（自己的、导入的、所有模式都一样）。
///
/// 注意：加密密钥派生用的是 `os.homedir()`（= USERPROFILE，不看 HOME），所以 crypto.rs
/// 仍用 `dirs::home_dir()`，**不要**改成这个函数。
pub fn zcode_data_base_dir() -> R<PathBuf> {
    for key in ["ZCODE_DATA_BASE_DIR", "HOME"] {
        if let Ok(v) = std::env::var(key) {
            let t = v.trim();
            if !t.is_empty() && looks_like_native_path(t) {
                return Ok(PathBuf::from(t));
            }
        }
    }
    dirs::home_dir().ok_or_else(|| AppError::Msg("找不到用户主目录".into()))
}

/// 是否是原生路径（Windows 下要求带盘符 `C:\` 或 UNC `\\`，避免把 git-bash 的
/// MSYS 风格 `HOME=/c/Users/xxx` 误当成可用路径——ZCode（GUI 启动）也只会看到原生 HOME）。
/// 非 Windows 平台一律放行（绝对路径即可）。
fn looks_like_native_path(p: &str) -> bool {
    #[cfg(windows)]
    {
        let bytes = p.as_bytes();
        // 盘符形式：X:\ 或 X:/
        let drive = bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/');
        // UNC：\\server\share
        let unc = p.starts_with("\\\\");
        drive || unc
    }
    #[cfg(not(windows))]
    {
        p.starts_with('/')
    }
}

pub fn zcode_v2_dir() -> R<PathBuf> {
    Ok(zcode_data_base_dir()?.join(".zcode").join("v2"))
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

    /// `"zai"` | `"bigmodel"` —— 这个账号在 ZCode 里属于哪条 provider family。
    /// 用于切号时把 `setting.json.providerFamilyDomain` 锁回对应值。
    /// 老档案没这字段，按"zai"兜底。
    #[serde(default)]
    pub family: String,

    /// `"oauth"` | `"apikey"` —— 这个账号的登录方式。
    /// - `oauth`：credentials.json 里有 zcodejwttoken，apiKey 由 ZCode 自己从凭据派生
    /// - `apikey`：用户自带 Z.ai / BigModel API Key，apiKey 直接存在 config.json 里
    /// 老档案没这字段，按"oauth"兜底。
    #[serde(default)]
    pub mode: String,

    /// 捕获时刻 `config.json.provider.<id>.options.apiKey` 的快照，覆盖 ZCode 6 条内置
    /// provider。切号时按存的值原样写回。仅 apikey 模式真正会用到这里的值；oauth 模式
    /// 切号仍以 credentials.json 解出的 JWT 为准（不依赖这个快照），但这里也会存以便回溯。
    #[serde(default)]
    pub provider_api_keys: std::collections::BTreeMap<String, String>,
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
    /// `"zai"` | `"bigmodel"` —— 老导出 JSON 没这字段，导入时按 credentials 现场推断。
    #[serde(default)]
    pub family: String,
    /// `"oauth"` | `"apikey"` —— 同上。
    #[serde(default)]
    pub mode: String,
    /// 老导出 JSON 没这字段，导入时空 map；apikey 账号靠这里才能还原 apiKey。
    #[serde(default)]
    pub provider_api_keys: std::collections::BTreeMap<String, String>,
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

/// ZCode 6 条内置 provider，按 family 分组。
/// 每个 family 三条：无后缀（自带 API Key 入口）/ -start-plan / -coding-plan。
const BUILTIN_PROVIDERS_BY_FAMILY: &[(&str, [&str; 3])] = &[
    (
        "zai",
        [
            "builtin:zai",
            "builtin:zai-start-plan",
            "builtin:zai-coding-plan",
        ],
    ),
    (
        "bigmodel",
        [
            "builtin:bigmodel",
            "builtin:bigmodel-start-plan",
            "builtin:bigmodel-coding-plan",
        ],
    ),
];

fn all_builtin_provider_ids() -> impl Iterator<Item = &'static str> {
    BUILTIN_PROVIDERS_BY_FAMILY
        .iter()
        .flat_map(|(_, ids)| ids.iter().copied())
}

/// 从 credentials.json 字节里读出 `oauth:active_provider`，得到当前账号属于哪条 family。
/// 返回 `"zai"`/`"bigmodel"`，无法识别返回 None。
fn extract_active_provider_family(cred_bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(cred_bytes).ok()?;
    let creds: Value = serde_json::from_str(text).ok()?;
    let raw = creds.get("oauth:active_provider").and_then(|v| v.as_str())?;
    let plain = crate::crypto::decrypt(raw).ok()?;
    let trimmed = plain.trim();
    if trimmed == "zai" || trimmed == "bigmodel" {
        Some(trimmed.to_string())
    } else {
        None
    }
}

/// 读当前 `~/.zcode/v2/config.json`，把 6 条 builtin provider 的 `options.apiKey`
/// 拍成 `provider_id -> apiKey` 的 map（空字符串也照存）。读不到返回空 map。
fn read_current_provider_api_keys() -> std::collections::BTreeMap<String, String> {
    let mut out = std::collections::BTreeMap::new();
    let Ok(path) = config_file() else {
        return out;
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return out;
    };
    let Ok(cfg) = serde_json::from_str::<Value>(&text) else {
        return out;
    };
    let Some(providers) = cfg.get("provider").and_then(|v| v.as_object()) else {
        return out;
    };
    for id in all_builtin_provider_ids() {
        let Some(prov) = providers.get(id) else {
            continue;
        };
        let api_key = prov
            .get("options")
            .and_then(|v| v.get("apiKey"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        out.insert(id.to_string(), api_key);
    }
    out
}

/// 账号元数据：决定切号时怎么写 config.json 和 setting.json。
#[derive(Debug, Clone)]
struct AccountMetadata {
    /// `"zai"` | `"bigmodel"` —— 没识别出来就是空串（兜底当 zai）。
    family: String,
    /// `"oauth"` | `"apikey"` —— 没识别出来就是空串（兜底当 oauth）。
    mode: String,
    /// 当时 config.json 里 6 条 builtin provider 的 apiKey 快照（空字符串也存）。
    provider_api_keys: std::collections::BTreeMap<String, String>,
}

/// 综合 credentials.json + 当前 config.json 判断这个账号的 family / mode / 各 provider apiKey 快照。
///
/// 优先级：
/// 1. credentials 有可解密 JWT → mode=oauth；family 取 `oauth:active_provider`（兜底 zai）
/// 2. 没 JWT，但 `builtin:zai.options.apiKey` 非空 → mode=apikey, family=zai
/// 3. 没 JWT，但 `builtin:bigmodel.options.apiKey` 非空 → mode=apikey, family=bigmodel
/// 4. 都没有 → 空（按 oauth/zai 兜底，跟老版本行为一致）
fn detect_account_metadata(cred_bytes: &[u8]) -> AccountMetadata {
    let provider_api_keys = read_current_provider_api_keys();
    let has_jwt = matches!(zcode_jwt_from_credentials(cred_bytes), Ok(Some(_)));

    let (family, mode) = if has_jwt {
        let fam = extract_active_provider_family(cred_bytes).unwrap_or_else(|| "zai".to_string());
        (fam, "oauth".to_string())
    } else if provider_api_keys
        .get("builtin:zai")
        .map(|s| !s.is_empty())
        .unwrap_or(false)
    {
        ("zai".to_string(), "apikey".to_string())
    } else if provider_api_keys
        .get("builtin:bigmodel")
        .map(|s| !s.is_empty())
        .unwrap_or(false)
    {
        ("bigmodel".to_string(), "apikey".to_string())
    } else {
        (String::new(), String::new())
    };

    AccountMetadata {
        family,
        mode,
        provider_api_keys,
    }
}

/// 从 Profile 字段（含老档案兜底）反推切号要用的 family/mode。
fn effective_family_mode(profile: &Profile) -> (String, String) {
    let family = if profile.family.is_empty() {
        "zai".to_string()
    } else {
        profile.family.clone()
    };
    let mode = if profile.mode.is_empty() {
        "oauth".to_string()
    } else {
        profile.mode.clone()
    };
    (family, mode)
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

/// 原地 truncate + 写入新内容，**不**用 tmp+rename。
///
/// 用途：让 ZCode 的 fs.watch（chokidar 类）识别成"同一个文件 modify"，
/// 等同于用户在 notepad 里 Ctrl+S 的事件。atomic rename 会换 inode，
/// 部分 watcher 实现会因此漏掉变化。
///
/// 代价：写到一半崩溃可能让 config.json 残缺。对于切号场景，这点损失换无感切换值得；
/// 真坏了再次启动 ZCode 会失败，用户重切一次就好。
fn write_in_place(path: &Path, data: &[u8]) -> R<()> {
    let mut f = fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)?;
    f.write_all(data)?;
    f.sync_all()?;
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
    metadata: &AccountMetadata,
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
    // 重新捕获也刷新登录方式 / 各 provider apiKey 快照（覆盖旧值，因为这次才是最新状态）
    profile.family = metadata.family.clone();
    profile.mode = metadata.mode.clone();
    profile.provider_api_keys = metadata.provider_api_keys.clone();
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

/// 切号时把 config.json 里目标 family 的 builtin provider apiKey 改成对的值。
///
/// - `mode == "oauth"`：从 cred_bytes 解出 JWT，写到 `builtin:{family}-start-plan` /
///   `-coding-plan` 两条；不动无后缀的 `builtin:{family}`（那条是 apikey 入口，baseURL
///   不同，塞 JWT 不会被服务端接受）。
/// - `mode == "apikey"`：从 profile 存的 `stored_keys` 里取 `builtin:{family}` 的值，
///   写到 `builtin:{family}.options.apiKey`；不动带后缀的 plan provider。
///
/// 其它 family 的 provider 一律不动，避免误清掉用户在另一家上配置的 key。
fn prepare_config_provider_keys_update(
    cred_bytes: &[u8],
    family: &str,
    mode: &str,
    stored_keys: &std::collections::BTreeMap<String, String>,
) -> R<Option<(PathBuf, Vec<u8>)>> {
    let path = config_file()?;
    if !path.exists() {
        return Ok(None);
    }

    // 计算每个 provider 应该写什么 apiKey；不动的 provider 不进 map。
    let mut target_writes: Vec<(String, String)> = Vec::new();
    let plan_start = format!("builtin:{}-start-plan", family);
    let plan_coding = format!("builtin:{}-coding-plan", family);
    let plain_key = format!("builtin:{}", family);

    if mode == "oauth" {
        let Some(jwt) = zcode_jwt_from_credentials(cred_bytes)? else {
            return Ok(None);
        };
        target_writes.push((plan_start, jwt.clone()));
        target_writes.push((plan_coding, jwt));
    } else if mode == "apikey" {
        let Some(apikey) = stored_keys.get(&plain_key) else {
            return Ok(None);
        };
        if apikey.is_empty() {
            return Ok(None);
        }
        target_writes.push((plain_key, apikey.clone()));
    } else {
        return Ok(None);
    }

    let text = fs::read_to_string(&path)?;
    let mut cfg: Value = serde_json::from_str(&text)?;
    let Some(providers) = cfg.get_mut("provider").and_then(Value::as_object_mut) else {
        return Ok(None);
    };

    let mut changed = false;
    for (target_id, target_val) in &target_writes {
        let Some(prov) = providers.get_mut(target_id) else {
            continue;
        };
        let Some(options) = prov.get_mut("options").and_then(Value::as_object_mut) else {
            continue;
        };
        if options.get("apiKey").and_then(Value::as_str) == Some(target_val.as_str()) {
            continue;
        }
        options.insert("apiKey".to_string(), Value::String(target_val.clone()));
        changed = true;
    }

    if !changed {
        return Ok(None);
    }
    let data = serde_json::to_vec_pretty(&cfg)?;
    Ok(Some((path, data)))
}

/// 按账号的 family/mode patch `setting.json`：
/// - `providerFamilyDomain = family`：让 ZCode 不禁用本 family 的 provider
/// - `modelProviderFamilyModes[family]`：ZCode 的 `m5` filter 用这个值决定走 plan 还是
///   apikey provider —— `"oauth"` 走 `builtin:<family>-start-plan`；**任何其它值或缺失**
///   都走 `builtin:<family>`（apikey 入口）
///   - oauth 模式 → 强制写入 `"oauth"`
///   - apikey 模式 → 主动**删掉**该 key（包括之前 oauth 切号时写入的"oauth"），让 ZCode
///     退回 apikey 路由
///
/// 已经一致就跳过。setting.json 不存在 / 损坏 / 不是对象都返回 None。
fn prepare_setting_route_update(family: &str, mode: &str) -> R<Option<(PathBuf, Vec<u8>)>> {
    if family.is_empty() {
        return Ok(None);
    }
    let path = zcode_v2_dir()?.join("setting.json");
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    let mut s: Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let Some(obj) = s.as_object_mut() else {
        return Ok(None);
    };

    let mut changed = false;

    // providerFamilyDomain = family
    if obj.get("providerFamilyDomain").and_then(Value::as_str) != Some(family) {
        obj.insert(
            "providerFamilyDomain".to_string(),
            Value::String(family.to_string()),
        );
        changed = true;
    }

    // modelProviderFamilyModes[family]
    match mode {
        "oauth" => {
            let modes = obj
                .entry("modelProviderFamilyModes".to_string())
                .or_insert_with(|| Value::Object(Map::new()));
            if let Some(modes_obj) = modes.as_object_mut() {
                if modes_obj.get(family).and_then(Value::as_str) != Some("oauth") {
                    modes_obj.insert(family.to_string(), Value::String("oauth".into()));
                    changed = true;
                }
            }
        }
        "apikey" => {
            // 主动删 family 那一项，让 ZCode 退回 apikey 路由
            if let Some(modes_obj) = obj
                .get_mut("modelProviderFamilyModes")
                .and_then(Value::as_object_mut)
            {
                if modes_obj.remove(family).is_some() {
                    changed = true;
                }
            }
        }
        _ => {}
    }

    if !changed {
        return Ok(None);
    }
    let data = serde_json::to_vec_pretty(&s)?;
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
    let metadata = detect_account_metadata(&cred_bytes);

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
            &metadata,
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
        family: metadata.family.clone(),
        mode: metadata.mode.clone(),
        provider_api_keys: metadata.provider_api_keys.clone(),
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
    let (family, mode) = effective_family_mode(&profile);
    let config_update = prepare_config_provider_keys_update(
        &cred_bytes,
        &family,
        &mode,
        &profile.provider_api_keys,
    )?;
    let setting_update = prepare_setting_route_update(&family, &mode).ok().flatten();

    // 备份当前
    let credential_backup = backup_current("switch")?;
    if config_update.is_some() {
        let _ = backup_current_config("switch")?;
    }
    if setting_update.is_some() {
        // 备份 setting.json：路径同 config.json 备份，用不同前缀避免覆盖
        if let Ok(setting_path) = zcode_v2_dir().map(|d| d.join("setting.json")) {
            if setting_path.exists() {
                if let Ok(backup_dir_path) = backup_dir() {
                    let _ = fs::create_dir_all(&backup_dir_path);
                    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
                    let dst = backup_dir_path.join(format!("setting.switch.{}.json", ts));
                    let _ = fs::copy(&setting_path, &dst);
                }
            }
        }
    }

    // 原子写入 credentials.json
    let active_credentials = credentials_file()?;
    atomic_write(&active_credentials, &cred_bytes)?;
    if let Some((config_path, config_bytes)) = config_update {
        // 不用 atomic rename：直接原地 truncate + write，让 ZCode 的 fs.watch 把它识别成
        // "同一个文件 modify"（等同于 notepad Ctrl+S），从而重读 config.json 并重建聊天 session。
        // atomic rename 会换 inode，部分 watcher 会漏掉变化。
        if let Err(e) = write_in_place(&config_path, &config_bytes) {
            if let Some(backup) = credential_backup {
                let _ = fs::copy(backup, &active_credentials);
            }
            return Err(e);
        }
        // CDP 无感切号：切号后 +0.5s / +3s / +5s 通过 Chrome DevTools Protocol 远程调用
        // ZCode 内部的 modelProviderService.refreshCodingPlanApiKey，让它立即重读 config.json
        // 并重建聊天 session。端口未开（用户未启用快捷方式增强）时静默失败，等 ZCode 自己
        // ~30s 轮询兜底。
        crate::zcode_cdp::schedule_post_switch_refresh();
    }
    // 锁定 modelProviderFamilyModes.zai = "oauth" 与 providerFamilyDomain = "zai"，
    // 否则跨用户导入后 ZCode 可能路由到 builtin:zai（自带 API Key 入口）报 missing API key。
    if let Some((setting_path, setting_bytes)) = setting_update {
        let _ = write_in_place(&setting_path, &setting_bytes);
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
        family: profile.family,
        mode: profile.mode,
        provider_api_keys: profile.provider_api_keys,
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
    let portable_family = portable.family.clone();
    let portable_mode = portable.mode.clone();
    let portable_keys = portable.provider_api_keys.clone();

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

    // family/mode：优先用导出 JSON 自带的；缺则按 credentials 现场推断。
    // 老导出 JSON 没这些字段 → 退回基于 credentials 的推断。
    let (family, mode) = if !portable_family.is_empty() && !portable_mode.is_empty() {
        (portable_family, portable_mode)
    } else {
        let active = extract_active_provider_family(&cred_bytes).unwrap_or_default();
        let has_jwt = matches!(zcode_jwt_from_credentials(&cred_bytes), Ok(Some(_)));
        let f = if !active.is_empty() {
            active
        } else if has_jwt {
            "zai".to_string()
        } else {
            String::new()
        };
        let m = if has_jwt {
            "oauth".to_string()
        } else if !portable_keys
            .get("builtin:zai")
            .map(|s| s.is_empty())
            .unwrap_or(true)
            || !portable_keys
                .get("builtin:bigmodel")
                .map(|s| s.is_empty())
                .unwrap_or(true)
        {
            "apikey".to_string()
        } else {
            String::new()
        };
        (f, m)
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
        family,
        mode,
        provider_api_keys: portable_keys,
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
