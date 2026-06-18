//! ZCode 凭据解密。
//!
//! ZCode 用 AES-256-GCM 加密 credentials.json 里的敏感字段，格式为：
//!   enc:v1:<base64url(nonce)>.<base64url(authTag)>.<base64url(ciphertext)>
//!
//! 密钥派生：
//!   - 优先取环境变量 ZCODE_CREDENTIAL_SECRET
//!   - 否则用 fallback：`zcode-credential-fallback:<platform>:<homedir>:<username>`
//!   - 最终 key = SHA256(secret)
//!
//! 这与 ZCode 桌面端 (Electron) out/main 里的实现完全一致，已用真实凭据验证可解密。

use std::env;

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;
use rand::{rngs::OsRng, RngCore};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const PREFIX: &str = "enc:v1:";
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const SECRET_ENV: &str = "ZCODE_CREDENTIAL_SECRET";

/// 解出的 user_info（来自 oauth:zai:user_info）。
#[derive(Debug, Clone, Deserialize)]
pub struct UserInfo {
    #[allow(dead_code)]
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub phone_number: Option<String>,
    pub mobile: Option<String>,
    pub mobile_phone: Option<String>,
    pub avatar: Option<String>,
    /// 用户设置的显示名（昵称）
    pub name: Option<String>,
}

/// 派生解密密钥，逻辑与 ZCode 的 defaultCredentialSecret 一致。
fn derive_key() -> [u8; 32] {
    let secret: String = match env::var(SECRET_ENV) {
        Ok(v) if !v.is_empty() => v,
        _ => {
            let username = whoami_fallback();
            let platform = platform_name();
            let home = dirs::home_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            format!(
                "zcode-credential-fallback:{}:{}:{}",
                platform, home, username
            )
        }
    };
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    let out = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&out);
    key
}

fn platform_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "win32"
    }
    #[cfg(target_os = "macos")]
    {
        "darwin"
    }
    #[cfg(target_os = "linux")]
    {
        "linux"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unknown"
    }
}

/// 模拟 Node 的 os.userInfo().username。
fn whoami_fallback() -> String {
    #[cfg(target_os = "windows")]
    {
        env::var("USERNAME")
            .or_else(|_| env::var("USERPROFILE"))
            .unwrap_or_else(|_| "unknown".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        env::var("USER").unwrap_or_else(|_| "unknown".to_string())
    }
}

/// 解密一个 `enc:v1:...` 字段。非加密串原样返回。
pub fn decrypt(token: &str) -> Result<String, String> {
    if !token.starts_with(PREFIX) {
        return Ok(token.to_string());
    }
    let body = &token[PREFIX.len()..];
    let parts: Vec<&str> = body.split('.').collect();
    if parts.len() != 3 {
        return Err("密文格式非法".into());
    }
    let nonce_b = b64url(parts[0])?;
    let tag_b = b64url(parts[1])?;
    let ct_b = b64url(parts[2])?;
    if nonce_b.len() != NONCE_LEN {
        return Err("IV 长度非法".into());
    }
    if tag_b.len() != TAG_LEN {
        return Err("AuthTag 长度非法".into());
    }
    // aes-gcm crate 要求 ciphertext 末尾拼接 tag
    let mut combined = Vec::with_capacity(ct_b.len() + TAG_LEN);
    combined.extend_from_slice(&ct_b);
    combined.extend_from_slice(&tag_b);

    let key_bytes = derive_key();
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_b);
    let pt = cipher
        .decrypt(nonce, combined.as_ref())
        .map_err(|_| "解密失败（密钥不匹配？）".to_string())?;
    String::from_utf8(pt).map_err(|e| format!("解出的明文不是 UTF-8：{}", e))
}

/// 用与 ZCode 相同的密钥派生方式加密字符串。
pub fn encrypt(plain: &str) -> Result<String, String> {
    let key_bytes = derive_key();
    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let combined = cipher
        .encrypt(nonce, plain.as_bytes())
        .map_err(|_| "加密失败".to_string())?;
    if combined.len() < TAG_LEN {
        return Err("加密结果非法".into());
    }
    let split_at = combined.len() - TAG_LEN;
    let (ct, tag) = combined.split_at(split_at);

    let enc = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    Ok(format!(
        "{}{}.{}.{}",
        PREFIX,
        enc.encode(nonce_bytes),
        enc.encode(tag),
        enc.encode(ct)
    ))
}

pub fn is_encrypted(token: &str) -> bool {
    token.starts_with(PREFIX)
}

fn b64url(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(s.trim_end_matches('='))
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(s))
        .map_err(|e| format!("base64 解码失败：{}", e))
}

/// 从 credentials.json 的明文 map 里解出 user_info。
pub fn extract_user_info(creds: &serde_json::Value) -> Option<UserInfo> {
    let raw = creds.get("oauth:zai:user_info").and_then(|v| v.as_str())?;
    let dec = decrypt(raw).ok()?;
    serde_json::from_str::<UserInfo>(&dec).ok()
}

/// 从 credentials.json 里解出 zcodejwttoken（用于调用 billing 接口）。
pub fn extract_jwt_token(creds: &serde_json::Value) -> Option<String> {
    let raw = creds.get("zcodejwttoken").and_then(|v| v.as_str())?;
    decrypt(raw).ok()
}
