//! ZCode CLI OAuth 登录流程。
//!
//! 流程(对应 smartlizi/zcode-account-switcher 的 ZaiAuthFlow):
//!   1. oauth_init  → POST https://zcode.z.ai/api/v1/oauth/cli/init
//!                   返回 {flow_id, authorize_url, poll_token}
//!   2. 前端调用 @tauri-apps/plugin-opener 打开 authorize_url,用户在系统浏览器里登录
//!   3. oauth_acquire_and_import → GET /oauth/cli/poll/{flow_id} 轮询直到 status=ready,
//!      把 {token, zai.access_token, zai.refresh_token, user} 组装成
//!      zcode-switcher-account/v1 portable JSON,复用 profile::import_profile_json 导入,
//!      返回新建的 Profile。
//!
//! 设计要点:
//!   - poll_token 由 oauth_init 生成并返回给前端,前端在调 oauth_acquire_and_import 时再传回,
//!     避免后端维护 flow_id → poll_token 的全局 state(进程崩了也不丢)。
//!   - 异步命令:tokio 调度,前端 await 即可,不阻塞主线程。

use rand::RngCore;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const API_BASE: &str = "https://zcode.z.ai/api/v1";
const DEFAULT_DEADLINE_SECONDS: u64 = 600;
const POLL_INTERVAL_SECONDS: u64 = 2;
const MAX_CONSECUTIVE_POLL_ERRORS: u32 = 10;
const HTTP_TIMEOUT_SECONDS: u64 = 20;

#[derive(Debug, Serialize)]
pub struct OAuthInit {
    pub flow_id: String,
    pub authorize_url: String,
    pub poll_token: String,
}

#[derive(Debug, Deserialize)]
struct ApiEnvelope<T> {
    #[serde(default)]
    code: i64,
    // Option<T>:字段缺失时自动为 None,不需要 T: Default
    data: Option<T>,
}

#[derive(Debug, Deserialize)]
struct InitData {
    flow_id: String,
    authorize_url: String,
}

#[derive(Debug, Deserialize)]
struct PollData {
    #[serde(default)]
    status: String,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    user: Option<Value>,
    #[serde(default)]
    zai: Option<ZaiTokens>,
}

#[derive(Debug, Deserialize, Default)]
struct ZaiTokens {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
}

fn random_poll_token() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败:{}", e))
}

/// 1) 向 zcode.z.ai 注册一次 CLI 登录流程,返回 authorize_url + poll_token。
/// 前端拿到后用 plugin-opener 打开 authorize_url,把 poll_token 留着传给后续 poll。
#[tauri::command]
pub async fn oauth_init() -> Result<OAuthInit, String> {
    let poll_token = random_poll_token();
    let client = http_client()?;
    let resp = client
        .post(format!("{}/oauth/cli/init", API_BASE))
        .bearer_auth(&poll_token)
        .json(&serde_json::json!({"provider": "zai"}))
        .send()
        .await
        .map_err(|e| format!("init 网络失败:{}", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "init HTTP {}:{}",
            status,
            body.chars().take(300).collect::<String>()
        ));
    }
    let env: ApiEnvelope<InitData> = resp
        .json()
        .await
        .map_err(|e| format!("init 响应解析失败:{}", e))?;
    let data = env
        .data
        .ok_or_else(|| format!("init 返回数据为空 code={}", env.code))?;
    Ok(OAuthInit {
        flow_id: data.flow_id,
        authorize_url: data.authorize_url,
        poll_token,
    })
}

/// 2) 阻塞 await: 反复 poll 直到 status=ready,然后用拿到的 token 立刻完成 profile 导入。
/// 默认 10 分钟截止(给用户留足时间过 captcha + 点同意)。
#[tauri::command]
pub async fn oauth_acquire_and_import(
    flow_id: String,
    poll_token: String,
    deadline_seconds: Option<u64>,
) -> Result<crate::profile::Profile, String> {
    let deadline = std::time::Instant::now()
        + Duration::from_secs(deadline_seconds.unwrap_or(DEFAULT_DEADLINE_SECONDS));
    let client = http_client()?;
    let mut consecutive_errors: u32 = 0;

    loop {
        if std::time::Instant::now() >= deadline {
            return Err("等待 OAuth 登录超时".into());
        }
        let result = client
            .get(format!("{}/oauth/cli/poll/{}", API_BASE, flow_id))
            .bearer_auth(&poll_token)
            .send()
            .await;
        let resp = match result {
            Ok(r) => r,
            Err(e) => {
                consecutive_errors += 1;
                if consecutive_errors >= MAX_CONSECUTIVE_POLL_ERRORS {
                    return Err(format!("poll 连续 {} 次网络失败:{}", consecutive_errors, e));
                }
                tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)).await;
                continue;
            }
        };
        if !resp.status().is_success() {
            consecutive_errors += 1;
            let status = resp.status();
            if consecutive_errors >= MAX_CONSECUTIVE_POLL_ERRORS {
                return Err(format!("poll HTTP {} 连续 {} 次", status, consecutive_errors));
            }
            tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)).await;
            continue;
        }
        consecutive_errors = 0;
        let env: ApiEnvelope<PollData> = match resp.json().await {
            Ok(e) => e,
            Err(e) => return Err(format!("poll 响应解析失败:{}", e)),
        };
        let data = env
            .data
            .ok_or_else(|| format!("poll 返回数据为空 code={}", env.code))?;
        match data.status.as_str() {
            "ready" => return import_from_token_set(data),
            "failed" => return Err("OAuth 登录被 ZCode 拒绝".into()),
            _ => {
                tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)).await;
            }
        }
    }
}

/// 把 poll ready 拿到的 token 集组装成 zcode-switcher-account/v1 portable JSON,
/// 直接调 profile::import_profile_json 入库。
fn import_from_token_set(poll: PollData) -> Result<crate::profile::Profile, String> {
    let token = poll
        .token
        .ok_or_else(|| "poll ready 但缺 token".to_string())?;
    let user = poll
        .user
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    let zai = poll.zai.unwrap_or_default();
    let access_token = zai.access_token.unwrap_or_default();
    let refresh_token = zai.refresh_token.unwrap_or_default();

    let pick = |keys: &[&str]| -> String {
        for k in keys {
            if let Some(s) = user.get(*k).and_then(|v| v.as_str()) {
                if !s.is_empty() {
                    return s.to_string();
                }
            }
        }
        String::new()
    };

    let email = pick(&["email", "mail"]);
    let name = pick(&["name", "username", "nickName", "displayName"]);
    let avatar = pick(&["avatar", "avatarUrl", "picture"]);
    let user_id = pick(&["user_id", "userId", "id", "customerNumber", "sub"]);

    let user_info_json = serde_json::to_string(&serde_json::json!({
        "email": email,
        "name": name,
        "avatar": avatar,
        "user_id": user_id,
    }))
    .map_err(|e| format!("user_info 序列化失败:{}", e))?;

    let mut credentials = serde_json::Map::new();
    credentials.insert(
        "oauth:active_provider".to_string(),
        Value::String("zai".into()),
    );
    credentials.insert(
        "oauth:zai:user_info".to_string(),
        Value::String(user_info_json),
    );
    credentials.insert("zcodejwttoken".to_string(), Value::String(token));
    if !access_token.is_empty() {
        credentials.insert(
            "oauth:zai:access_token".to_string(),
            Value::String(access_token),
        );
    }
    if !refresh_token.is_empty() {
        credentials.insert(
            "oauth:zai:refresh_token".to_string(),
            Value::String(refresh_token),
        );
    }

    let default_name = if let Some(at) = email.find('@') {
        email[..at].to_string()
    } else if !user_id.is_empty() {
        user_id.clone()
    } else {
        "未命名".to_string()
    };

    let portable = serde_json::json!({
        "schema": "zcode-switcher-account/v1",
        "exported_at": chrono::Local::now().timestamp() as f64,
        "profile": {
            "name": if name.is_empty() { default_name } else { name },
            "user_id": user_id,
            "email": email,
            "phone": "",
            "avatar": avatar,
        },
        "credentials": Value::Object(credentials),
        "family": "zai",
        "mode": "oauth",
        "provider_api_keys": {},
    });

    let portable_text =
        serde_json::to_string(&portable).map_err(|e| format!("portable 序列化失败:{}", e))?;
    crate::profile::import_profile_json(portable_text).map_err(|e| e.to_string())
}
