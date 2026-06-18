//! JWT payload 解码（不验签），用于从 config.json 的 coding-plan apiKey
//! 里提取 user_id 作为账号稳定指纹。

use base64::Engine;
use serde_json::Value;

/// 解码 JWT 的 payload 段。失败返回 None。
pub fn decode_payload(token: &str) -> Option<Value> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return None;
    }
    let payload = parts[1];
    // urlsafe base64，补齐 padding
    let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| {
            let padded = match payload.len() % 4 {
                2 => format!("{}==", payload),
                3 => format!("{}=", payload),
                _ => payload.to_string(),
            };
            base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(padded)
        })
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

/// 从一个 JWT 字符串里取出 user_id（或 sub）。
pub fn extract_user_id(token: &str) -> Option<String> {
    let payload = decode_payload(token)?;
    let uid = payload.get("user_id").and_then(|v| v.as_str());
    let uid = uid.or_else(|| payload.get("sub").and_then(|v| v.as_str()))?;
    if uid.is_empty() {
        None
    } else {
        Some(uid.to_string())
    }
}
