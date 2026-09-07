//! 官方 ZCode 3.11+ OAuth CLI：先 `/oauth/cli/init` 再 poll。
//! 不要改用 `/app/oauth/login`，未登记 flow 时该页固定「授权失败」。

use rand::RngCore;
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CLI_INIT_URL: &str = "https://zcode.z.ai/api/v1/oauth/cli/init";
const CLI_POLL_PREFIX: &str = "https://zcode.z.ai/api/v1/oauth/cli/poll/";

#[derive(Debug, Clone)]
pub struct CliFlow {
    pub flow_id: String,
    pub poll_token: String,
    pub authorize_url: String,
    pub expires_at: u64,
    pub poll_interval: Duration,
}

#[derive(Debug)]
pub enum CliPollStatus {
    Pending,
    Failed(String),
    Ready(CliReady),
}

#[derive(Debug)]
pub struct CliReady {
    pub zcode_jwt: String,
    pub access_token: String,
    pub refresh_token: String,
    pub user: Value,
}

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    #[serde(default)]
    code: Option<Value>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<T>,
}

#[derive(Debug, Default, Deserialize)]
struct InitData {
    #[serde(default)]
    flow_id: Option<String>,
    #[serde(default)]
    authorize_url: Option<String>,
    #[serde(default)]
    expires_at: Option<u64>,
    #[serde(default)]
    poll_interval_sec: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
struct PollData {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    user: Option<Value>,
    #[serde(default)]
    zai: Option<Value>,
    #[serde(default)]
    bigmodel: Option<Value>,
}

fn is_success_code(code: Option<&Value>) -> bool {
    match code {
        None | Some(Value::Null) => true,
        Some(Value::Number(n)) => n.as_i64().map(|v| v == 0 || v == 200).unwrap_or(false),
        Some(Value::String(s)) => s.trim() == "0" || s.trim() == "200",
        _ => false,
    }
}

fn envelope_message(msg: Option<String>, message: Option<String>, fallback: &str) -> String {
    msg.or(message)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn pick_token(obj: Option<&Value>) -> (String, String) {
    let Some(obj) = obj else {
        return (String::new(), String::new());
    };
    let access = obj
        .get("access_token")
        .or_else(|| obj.get("accessToken"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let refresh = obj
        .get("refresh_token")
        .or_else(|| obj.get("refreshToken"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    (access, refresh)
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn parse_cli_init(body: &str, sent_bearer: &str) -> Result<CliFlow, String> {
    let env: Envelope<InitData> =
        serde_json::from_str(body).map_err(|e| format!("OAuth CLI 初始化响应解析失败:{}", e))?;
    if !is_success_code(env.code.as_ref()) {
        return Err(envelope_message(
            env.msg,
            env.message,
            "OAuth CLI 初始化失败",
        ));
    }
    let data = env
        .data
        .ok_or_else(|| "OAuth CLI 初始化响应缺少 data".to_string())?;
    let flow_id = data.flow_id.unwrap_or_default().trim().to_string();
    let authorize_url = data.authorize_url.unwrap_or_default().trim().to_string();
    let expires_at = data.expires_at.unwrap_or(0);
    let interval = data.poll_interval_sec.unwrap_or(0);
    if flow_id.is_empty() || authorize_url.is_empty() || expires_at == 0 || interval == 0 {
        return Err("OAuth CLI 初始化响应无效".into());
    }
    if !authorize_url.contains("/oauth/cli/callback/") {
        return Err("OAuth CLI 授权地址未指向官方 callback，已拒绝以免再次授权失败".into());
    }
    Ok(CliFlow {
        flow_id,
        poll_token: sent_bearer.trim().to_string(),
        authorize_url,
        expires_at,
        poll_interval: Duration::from_secs(interval.max(1)),
    })
}

pub fn parse_cli_poll(body: &str, provider: &str) -> Result<CliPollStatus, String> {
    let env: Envelope<PollData> =
        serde_json::from_str(body).map_err(|e| format!("OAuth CLI 查询响应解析失败:{}", e))?;
    if !is_success_code(env.code.as_ref()) {
        return Err(envelope_message(env.msg, env.message, "OAuth CLI 查询失败"));
    }
    let data = env
        .data
        .ok_or_else(|| "OAuth CLI 查询响应缺少 data".to_string())?;
    match data.status.as_deref().unwrap_or("").trim() {
        "pending" => Ok(CliPollStatus::Pending),
        "failed" => Ok(CliPollStatus::Failed("OAuth 授权失败".into())),
        "ready" => {
            let zcode_jwt = data.token.unwrap_or_default().trim().to_string();
            let provider_tokens = if provider == "zai" {
                data.zai.as_ref()
            } else {
                data.bigmodel.as_ref()
            };
            let (access_token, refresh_token) = pick_token(provider_tokens);
            if zcode_jwt.is_empty() || access_token.is_empty() {
                return Err("OAuth CLI 查询响应缺少 token".into());
            }
            Ok(CliPollStatus::Ready(CliReady {
                zcode_jwt,
                access_token,
                refresh_token,
                user: data.user.unwrap_or(Value::Null),
            }))
        }
        other => Err(format!("OAuth CLI 查询状态无效:{}", other)),
    }
}

pub async fn start_cli_flow(client: &Client, provider: &str) -> Result<CliFlow, String> {
    let sent_bearer = random_hex(32);
    let resp = client
        .post(CLI_INIT_URL)
        .header("Authorization", format!("Bearer {}", sent_bearer))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "provider": provider }))
        .send()
        .await
        .map_err(|e| format!("OAuth CLI 初始化网络失败:{}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("OAuth CLI 初始化响应读取失败:{}", e))?;
    if !status.is_success() {
        return Err(format!(
            "OAuth CLI 初始化 HTTP {}:{}",
            status,
            body.chars().take(200).collect::<String>()
        ));
    }
    parse_cli_init(&body, &sent_bearer)
}

pub async fn poll_cli_once(
    client: &Client,
    flow: &CliFlow,
    provider: &str,
) -> Result<CliPollStatus, String> {
    if now_unix() >= flow.expires_at {
        return Err("OAuth 登录已过期，请重新发起".into());
    }
    let url = format!("{}{}", CLI_POLL_PREFIX, urlencoding_flow_id(&flow.flow_id));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", flow.poll_token))
        .send()
        .await
        .map_err(|e| format!("OAuth CLI 查询网络失败:{}", e))?;
    let status = resp.status();
    if status.as_u16() == 408 || status.as_u16() == 429 || status.is_server_error() {
        return Ok(CliPollStatus::Pending);
    }
    if status.is_client_error() {
        return Err(format!("OAuth CLI 查询 HTTP {}", status));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("OAuth CLI 查询响应读取失败:{}", e))?;
    parse_cli_poll(&body, provider)
}

fn urlencoding_flow_id(flow_id: &str) -> String {
    flow_id
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' {
                (b as char).to_string()
            } else {
                format!("%{:02X}", b)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const INIT_OK: &str = r#"{"code":0,"data":{"flow_id":"flow-1","poll_token":"server-token","authorize_url":"https://bigmodel.cn/login?appId=zcode&redirect=https://zcode.z.ai/api/v1/oauth/cli/callback/bigmodel&state=s1","expires_at":1788802769,"poll_interval_sec":2}}"#;

    #[test]
    fn cli_init_uses_official_callback_not_desktop_login_page() {
        let flow = parse_cli_init(INIT_OK, "sent-bearer").expect("init");
        assert_eq!(flow.flow_id, "flow-1");
        assert_eq!(flow.poll_token, "sent-bearer");
        assert!(flow.authorize_url.contains("/oauth/cli/callback/bigmodel"));
        assert!(!flow.authorize_url.contains("/app/oauth/login"));
    }

    #[test]
    fn cli_init_rejects_desktop_intermediate_authorize_url() {
        let body = r#"{"code":0,"data":{"flow_id":"flow-1","authorize_url":"https://zcode.z.ai/app/oauth/login?redirect=zcode://oauth/callback&app_version=3.11.2","expires_at":1788802769,"poll_interval_sec":2}}"#;
        let err = parse_cli_init(body, "tok").expect_err("must reject");
        assert!(err.contains("callback"));
    }

    #[test]
    fn cli_poll_pending_ready_failed() {
        assert!(matches!(
            parse_cli_poll(r#"{"code":0,"data":{"status":"pending"}}"#, "bigmodel").unwrap(),
            CliPollStatus::Pending
        ));
        assert!(matches!(
            parse_cli_poll(r#"{"code":0,"data":{"status":"failed"}}"#, "bigmodel").unwrap(),
            CliPollStatus::Failed(_)
        ));
        let CliPollStatus::Ready(ready) = parse_cli_poll(
            r#"{"code":0,"data":{"status":"ready","token":"jwt","user":{"user_id":"u1","name":"n"},"bigmodel":{"access_token":"at","refresh_token":"rt"}}}"#,
            "bigmodel",
        )
        .unwrap() else { panic!("ready") };
        assert_eq!((ready.zcode_jwt, ready.access_token, ready.refresh_token), ("jwt".into(), "at".into(), "rt".into()));
        assert_eq!(ready.user["user_id"], "u1");
    }
}
