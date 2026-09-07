//! ZCode OAuth 登录导入。
//!
//! 主路径对齐官方 3.11+：POST /oauth/cli/init → 打开服务端 authorize_url
//! → poll /oauth/cli/poll/{flow_id}。不要把 redirect 改成
//! `/app/oauth/login?app_version=3.11.2`，该页在未登记 CLI flow 时固定显示
//! 「授权失败」。CLI 不可用时回退 zcode://oauth/callback + token 交换。

use crate::oauth_cli;
use rand::RngCore;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio::sync::oneshot;

const AUTHORIZE_URL: &str = "https://chat.z.ai/api/oauth/authorize";
const BIGMODEL_AUTHORIZE_URL: &str = "https://bigmodel.cn/login";
const TOKEN_URL: &str = "https://zcode.z.ai/api/v1/oauth/token";
const USERINFO_URL: &str = "https://chat.z.ai/api/oauth/userinfo";
const BIGMODEL_USERINFO_URL: &str = "https://bigmodel.cn/api/biz/customer/getCustomerInfo";
const BUSINESS_LOGIN_URL: &str = "https://api.z.ai/api/auth/z/login";
const CLIENT_ID: &str = "client_P8X5CMWmlaRO9gyO-KSqtg";
const BIGMODEL_APP_ID: &str = "zcode";
const CALLBACK_URI: &str = "zcode://oauth/callback";
const DEFAULT_DEADLINE_SECONDS: u64 = 600;
const HTTP_TIMEOUT_SECONDS: u64 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OAuthFamily {
    Zai,
    BigModel,
}

impl OAuthFamily {
    fn parse(raw: Option<&str>) -> Result<Self, String> {
        match raw.unwrap_or("bigmodel").trim().to_ascii_lowercase().as_str() {
            "" | "bigmodel" => Ok(Self::BigModel),
            "zai" => Ok(Self::Zai),
            other => Err(format!("不支持的 OAuth 登录平台：{}", other)),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Zai => "zai",
            Self::BigModel => "bigmodel",
        }
    }
}

fn fallback_redirect_uri() -> &'static str {
    CALLBACK_URI
}

#[derive(Debug, Serialize)]
pub struct OAuthInit {
    pub flow_id: String,
    pub authorize_url: String,
    pub poll_token: String,
}

struct PendingFlow {
    family: OAuthFamily,
    state: String,
    poll_token: String,
    cli: Option<oauth_cli::CliFlow>,
    redirect_uri: String,
    receiver: oneshot::Receiver<Result<CallbackData, String>>,
    callback_sender: Arc<Mutex<Option<oneshot::Sender<Result<CallbackData, String>>>>>,
}

struct PendingCallback {
    state: String,
    sender: Arc<Mutex<Option<oneshot::Sender<Result<CallbackData, String>>>>>,
}

#[derive(Debug)]
struct CallbackData {
    code: String,
    state: String,
}

#[derive(Debug, Deserialize)]
struct TokenEnvelope {
    #[serde(default)]
    code: Option<Value>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<TokenData>,
}

#[derive(Debug, Deserialize)]
struct TokenData {
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    user: Option<Value>,
    #[serde(default)]
    zai: Option<ZaiTokens>,
    #[serde(default)]
    bigmodel: Option<ZaiTokens>,
}

#[derive(Debug, Deserialize, Default)]
struct ZaiTokens {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default, rename = "accessToken")]
    access_token_camel: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default, rename = "refreshToken")]
    refresh_token_camel: Option<String>,
}

impl ZaiTokens {
    fn access_token(&self) -> String {
        self.access_token
            .as_deref()
            .or(self.access_token_camel.as_deref())
            .unwrap_or_default()
            .trim()
            .to_string()
    }

    fn refresh_token(&self) -> String {
        self.refresh_token
            .as_deref()
            .or(self.refresh_token_camel.as_deref())
            .unwrap_or_default()
            .trim()
            .to_string()
    }
}

#[derive(Debug, Deserialize)]
struct BusinessEnvelope {
    #[serde(default)]
    code: Option<Value>,
    #[serde(default)]
    success: Option<bool>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    data: Option<Value>,
}

fn pending_flow() -> &'static Mutex<Option<PendingFlow>> {
    static PENDING: OnceLock<Mutex<Option<PendingFlow>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

fn pending_callback() -> &'static Mutex<Option<PendingCallback>> {
    static PENDING: OnceLock<Mutex<Option<PendingCallback>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败:{}", e))
}

fn is_success_code(code: Option<&Value>) -> bool {
    match code {
        None | Some(Value::Null) => true,
        Some(Value::Number(n)) => n.as_i64().map(|v| v == 0 || v == 200).unwrap_or(false),
        Some(Value::String(s)) => {
            let s = s.trim();
            s == "0" || s == "200"
        }
        _ => false,
    }
}

fn envelope_message(msg: Option<String>, message: Option<String>, fallback: &str) -> String {
    msg.or(message)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn body_preview(body: &str) -> String {
    body.chars().take(300).collect::<String>()
}

fn build_authorize_url(family: OAuthFamily, state: &str) -> Result<String, String> {
    let redirect = fallback_redirect_uri();
    match family {
        OAuthFamily::Zai => {
            let mut url = reqwest::Url::parse(AUTHORIZE_URL)
                .map_err(|e| format!("授权地址解析失败:{}", e))?;
            url.query_pairs_mut()
                .append_pair("redirect_uri", redirect)
                .append_pair("response_type", "code")
                .append_pair("client_id", CLIENT_ID)
                .append_pair("state", state);
            Ok(url.to_string())
        }
        OAuthFamily::BigModel => {
            let mut url = reqwest::Url::parse(BIGMODEL_AUTHORIZE_URL)
                .map_err(|e| format!("授权地址解析失败:{}", e))?;
            url.query_pairs_mut()
                .append_pair("redirect", redirect)
                .append_pair("appId", BIGMODEL_APP_ID)
                .append_pair("state", state);
            Ok(url.to_string())
        }
    }
}

fn callback_channel() -> (
    Arc<Mutex<Option<oneshot::Sender<Result<CallbackData, String>>>>>,
    oneshot::Receiver<Result<CallbackData, String>>,
) {
    let (sender, receiver) = oneshot::channel();
    (Arc::new(Mutex::new(Some(sender))), receiver)
}

fn callback_data_from_url(raw_url: &str) -> Option<Result<CallbackData, String>> {
    let url = reqwest::Url::parse(raw_url).ok()?;
    if !is_oauth_callback_url(&url) {
        return None;
    }

    let mut code = None;
    let mut auth_code = None;
    let mut state = None;
    let mut error = None;
    let mut error_description = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "authCode" => auth_code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "error_description" => error_description = Some(value.into_owned()),
            _ => {}
        }
    }

    let error = error.unwrap_or_default().trim().to_string();
    if !error.is_empty() {
        let description = error_description.unwrap_or_default().trim().to_string();
        let detail = if description.is_empty() {
            error
        } else {
            format!("{}: {}", error, description)
        };
        return Some(Err(format!("OAuth 登录被拒绝:{}", detail)));
    }

    let code = code.or(auth_code).unwrap_or_default().trim().to_string();
    let state = state.unwrap_or_default().trim().to_string();
    if code.is_empty() || state.is_empty() {
        return Some(Err("OAuth 回调缺少 code 或 state".to_string()));
    }
    Some(Ok(CallbackData { code, state }))
}

fn is_oauth_callback_url(url: &reqwest::Url) -> bool {
    if url.scheme() != "zcode" {
        return false;
    }

    let path = url.path().trim_end_matches('/');
    match url.host_str() {
        Some("oauth") => path == "/callback",
        None => path == "/oauth/callback",
        _ => false,
    }
}

/// 将 deep link 回调投递给当前 OAuth 流程。
///
/// 返回值表示该 URL 是否是本应用的 OAuth 回调；普通命令行参数会被忽略。
pub fn handle_deep_link_url(raw_url: &str) -> bool {
    let raw_url = raw_url.trim().trim_matches(['"', '\'']);
    let Some(result) = callback_data_from_url(raw_url) else {
        return false;
    };
    let sender = {
        let Ok(pending) = pending_callback().lock() else {
            return true;
        };
        let Some(pending) = pending.as_ref() else {
            return true;
        };
        let result = match result {
            Ok(callback) if callback.state != pending.state => {
                Err("OAuth state 校验失败，请重新发起登录".to_string())
            }
            other => other,
        };
        let sender = pending
            .sender
            .lock()
            .ok()
            .and_then(|mut sender| sender.take());
        sender.map(|sender| (sender, result))
    };
    if let Some((sender, result)) = sender {
        let _ = sender.send(result);
    }
    true
}

fn cancel_callback_sender(
    sender: &Arc<Mutex<Option<oneshot::Sender<Result<CallbackData, String>>>>>,
    message: &str,
) {
    if let Ok(mut sender) = sender.lock() {
        if let Some(sender) = sender.take() {
            let _ = sender.send(Err(message.to_string()));
        }
    }
}

fn clear_pending_callback(state: &str) {
    if let Ok(mut pending) = pending_callback().lock() {
        if pending
            .as_ref()
            .is_some_and(|current| current.state == state)
        {
            pending.take();
        }
    }
}

fn cancel_pending_oauth(message: &str) {
    if let Ok(mut pending) = pending_flow().lock() {
        if let Some(flow) = pending.take() {
            cancel_callback_sender(&flow.callback_sender, message);
        }
    }
    if let Ok(mut pending) = pending_callback().lock() {
        if let Some(callback) = pending.take() {
            cancel_callback_sender(&callback.sender, message);
        }
    }
}

/// 初始化 OAuth 流程。`provider` 为 `bigmodel` 或 `zai`，缺省按本机常见的智谱登录。
///
/// 优先走官方 CLI init（authorize_url 已指向 cli/callback）。失败时回退
/// `zcode://oauth/callback`。前端仍复用 flow_id / poll_token 字段。
#[tauri::command]
pub async fn oauth_init(provider: Option<String>) -> Result<OAuthInit, String> {
    let family = OAuthFamily::parse(provider.as_deref())?;
    let (callback_sender, receiver) = callback_channel();
    let client = http_client()?;
    let cli = oauth_cli::start_cli_flow(&client, family.as_str()).await.ok();
    let (state, poll_token, authorize_url, redirect_uri) = match &cli {
        Some(flow) => (
            flow.flow_id.clone(),
            flow.poll_token.clone(),
            flow.authorize_url.clone(),
            fallback_redirect_uri().to_string(),
        ),
        None => {
            let state = random_hex(24);
            (
                state.clone(),
                CALLBACK_URI.to_string(),
                build_authorize_url(family, &state)?,
                fallback_redirect_uri().to_string(),
            )
        }
    };

    let mut pending = pending_flow()
        .lock()
        .map_err(|_| "OAuth 流程状态锁定失败".to_string())?;
    if let Some(old) = pending.take() {
        cancel_callback_sender(&old.callback_sender, "OAuth 登录流程已被新的登录请求替换");
    }
    let mut slot = pending_callback()
        .lock()
        .map_err(|_| "OAuth 回调状态锁定失败".to_string())?;
    if let Some(old) = slot.take() {
        cancel_callback_sender(&old.sender, "OAuth 登录流程已被新的登录请求替换");
    }
    *slot = Some(PendingCallback {
        state: state.clone(),
        sender: callback_sender.clone(),
    });
    *pending = Some(PendingFlow {
        family,
        state: state.clone(),
        poll_token: poll_token.clone(),
        cli,
        redirect_uri,
        receiver,
        callback_sender,
    });

    Ok(OAuthInit {
        flow_id: state,
        authorize_url,
        poll_token,
    })
}

/// 等待本地回调，交换 token，并导入账号。
#[tauri::command]
pub async fn oauth_acquire_and_import(
    flow_id: String,
    poll_token: String,
    deadline_seconds: Option<u64>,
) -> Result<crate::profile::Profile, String> {
    let pending = {
        let mut guard = pending_flow()
            .lock()
            .map_err(|_| "OAuth 流程状态锁定失败".to_string())?;
        match guard.take() {
            Some(flow) if flow.state == flow_id && flow.poll_token == poll_token => flow,
            Some(flow) => {
                *guard = Some(flow);
                return Err("OAuth 流程不匹配，请重新发起登录".into());
            }
            None => return Err("没有正在等待的 OAuth 登录流程，请重新发起登录".into()),
        }
    };

    let state = pending.state.clone();
    let profile = acquire_with_pending(pending, deadline_seconds).await;
    clear_pending_callback(&state);
    profile
}

#[tauri::command]
pub fn oauth_cancel() {
    cancel_pending_oauth("OAuth 登录流程已取消，请重新发起登录");
}

async fn acquire_via_cli(
    client: &Client,
    family: OAuthFamily,
    cli: oauth_cli::CliFlow,
    mut receiver: oneshot::Receiver<Result<CallbackData, String>>,
    deadline: Duration,
) -> Result<crate::profile::Profile, String> {
    let started = tokio::time::Instant::now();
    loop {
        if started.elapsed() >= deadline {
            return Err("等待 OAuth 登录超时".into());
        }
        let poll_fut = oauth_cli::poll_cli_once(client, &cli, family.as_str());
        tokio::select! {
            cb = &mut receiver => {
                match cb {
                    Ok(Ok(_)) => continue,
                    Ok(Err(e)) => return Err(e),
                    Err(_) => return Err("OAuth 回调通道已关闭，请重新发起登录".into()),
                }
            }
            poll = poll_fut => {
                match poll? {
                    oauth_cli::CliPollStatus::Pending => {
                        let sleep_for = cli.poll_interval.min(deadline.saturating_sub(started.elapsed()));
                        tokio::select! {
                            cb = &mut receiver => {
                                match cb {
                                    Ok(Ok(_)) => {}
                                    Ok(Err(e)) => return Err(e),
                                    Err(_) => return Err("OAuth 回调通道已关闭，请重新发起登录".into()),
                                }
                            }
                            _ = tokio::time::sleep(sleep_for) => {}
                        }
                    }
                    oauth_cli::CliPollStatus::Failed(e) => return Err(e),
                    oauth_cli::CliPollStatus::Ready(ready) => {
                        let mut user = ready.user;
                        if !has_meaningful_user(&user) {
                            if let Some(fetched) =
                                fetch_user_info(client, family, &ready.access_token).await
                            {
                                user = fetched;
                            }
                        }
                        return import_from_token_set(
                            family,
                            ready.zcode_jwt,
                            ready.access_token,
                            ready.refresh_token,
                            user,
                        );
                    }
                }
            }
        }
    }
}

async fn acquire_with_pending(
    pending: PendingFlow,
    deadline_seconds: Option<u64>,
) -> Result<crate::profile::Profile, String> {
    let PendingFlow {
        family,
        state,
        poll_token: _,
        cli,
        redirect_uri,
        receiver,
        callback_sender: _,
    } = pending;
    let deadline = Duration::from_secs(deadline_seconds.unwrap_or(DEFAULT_DEADLINE_SECONDS));
    let client = http_client()?;
    if let Some(cli) = cli {
        return acquire_via_cli(&client, family, cli, receiver, deadline).await;
    }
    let callback = match tokio::time::timeout(deadline, receiver).await {
        Ok(Ok(Ok(callback))) => callback,
        Ok(Ok(Err(e))) => return Err(e),
        Ok(Err(_)) => return Err("OAuth 回调通道已关闭，请重新发起登录".into()),
        Err(_) => return Err("等待 OAuth 登录超时".into()),
    };

    if callback.state != state {
        return Err("OAuth state 校验失败，请重新发起登录".into());
    }

    let token_data = exchange_oauth_token(&client, family, &callback.code, &state, &redirect_uri).await?;
    let zcode_jwt = token_data
        .token
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_string();
    if zcode_jwt.is_empty() {
        return Err("Token 交换失败:响应缺少 data.token".into());
    }
    let (access_token, refresh_token) = match family {
        OAuthFamily::Zai => {
            let zai_tokens = token_data.zai.unwrap_or_default();
            let zai_access_token = zai_tokens.access_token();
            if zai_access_token.is_empty() {
                return Err("Token 交换失败:响应缺少 data.zai.access_token".into());
            }
            (
                exchange_business_token(&client, &zai_access_token).await?,
                zai_tokens.refresh_token(),
            )
        }
        OAuthFamily::BigModel => {
            let bm_tokens = token_data.bigmodel.unwrap_or_default();
            let access_token = bm_tokens.access_token();
            if access_token.is_empty() {
                return Err("Token 交换失败:响应缺少 data.bigmodel.access_token".into());
            }
            (access_token, bm_tokens.refresh_token())
        }
    };
    let mut user = token_data
        .user
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    if !has_meaningful_user(&user) {
        if let Some(fetched) = fetch_user_info(&client, family, &access_token).await {
            user = fetched;
        }
    }

    import_from_token_set(family, zcode_jwt, access_token, refresh_token, user)
}

async fn exchange_oauth_token(
    client: &Client,
    family: OAuthFamily,
    code: &str,
    state: &str,
    redirect_uri: &str,
) -> Result<TokenData, String> {
    let resp = client
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "provider": family.as_str(),
            "code": code,
            "redirect_uri": redirect_uri,
            "state": state,
        }))
        .send()
        .await
        .map_err(|e| format!("Token 交换网络失败:{}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("Token 交换响应读取失败:{}", e))?;
    if !status.is_success() {
        return Err(format!(
            "Token 交换 HTTP {}:{}",
            status,
            body_preview(&body)
        ));
    }
    let env: TokenEnvelope =
        serde_json::from_str(&body).map_err(|e| format!("Token 交换响应解析失败:{}", e))?;
    if !is_success_code(env.code.as_ref()) {
        return Err(envelope_message(
            env.msg,
            env.message,
            "ZAI 后端 token 交换失败",
        ));
    }
    env.data
        .ok_or_else(|| "Token 交换响应缺少 data".to_string())
}

async fn exchange_business_token(
    client: &Client,
    zai_access_token: &str,
) -> Result<String, String> {
    let resp = client
        .post(BUSINESS_LOGIN_URL)
        .json(&serde_json::json!({ "token": zai_access_token }))
        .send()
        .await
        .map_err(|e| format!("业务 token 交换网络失败:{}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("业务 token 交换响应读取失败:{}", e))?;
    if !status.is_success() {
        return Err(format!(
            "业务 token 交换 HTTP {}:{}",
            status,
            body_preview(&body)
        ));
    }
    let env: BusinessEnvelope =
        serde_json::from_str(&body).map_err(|e| format!("业务 token 响应解析失败:{}", e))?;
    if env.success == Some(false) || !is_success_code(env.code.as_ref()) {
        return Err(envelope_message(
            env.msg,
            env.message,
            "ZAI 业务 token 交换失败",
        ));
    }
    let data = env
        .data
        .ok_or_else(|| "业务 token 响应缺少 data".to_string())?;
    let token = pick(&data, &["access_token", "accessToken"]);
    if token.is_empty() {
        return Err("业务 token 响应缺少 access_token".into());
    }
    Ok(token)
}

async fn fetch_user_info(
    client: &Client,
    family: OAuthFamily,
    access_token: &str,
) -> Option<Value> {
    let request = match family {
        OAuthFamily::Zai => client.get(USERINFO_URL).bearer_auth(access_token),
        OAuthFamily::BigModel => client
            .get(BIGMODEL_USERINFO_URL)
            .header("Authorization", access_token),
    };
    let resp = request
        .header("Content-Type", "application/json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let value: Value = resp.json().await.ok()?;
    Some(value.get("data").cloned().unwrap_or(value))
}

fn has_meaningful_user(user: &Value) -> bool {
    !pick(user, &["email", "mail"]).is_empty()
        || !pick(
            user,
            &[
                "phone",
                "phone_number",
                "phoneNumber",
                "mobile",
                "mobile_phone",
                "mobilePhone",
            ],
        )
        .is_empty()
        || !pick(user, &["user_id", "userId", "id", "customerNumber", "sub"]).is_empty()
}

fn pick(user: &Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(value) = user.get(*key) {
            match value {
                Value::String(s) if !s.trim().is_empty() => return s.trim().to_string(),
                Value::Number(n) => return n.to_string(),
                _ => {}
            }
        }
    }
    String::new()
}

fn import_from_token_set(
    family: OAuthFamily,
    zcode_jwt: String,
    business_access_token: String,
    refresh_token: String,
    user: Value,
) -> Result<crate::profile::Profile, String> {
    let email = pick(&user, &["email", "mail"]);
    let phone = pick(
        &user,
        &[
            "phone",
            "phone_number",
            "phoneNumber",
            "mobile",
            "mobile_phone",
            "mobilePhone",
        ],
    );
    let name = pick(&user, &["name", "username", "nickName", "displayName"]);
    let avatar = pick(&user, &["avatar", "avatarUrl", "picture"]);
    let user_id = pick(&user, &["user_id", "userId", "id", "customerNumber", "sub"]);

    let user_info_json = serde_json::to_string(&serde_json::json!({
        "email": email,
        "phone": phone,
        "phone_number": phone,
        "name": name,
        "avatar": avatar,
        "avatarUrl": avatar,
        "user_id": user_id,
        "id": user_id,
        "username": name,
        "displayName": name,
    }))
    .map_err(|e| format!("user_info 序列化失败:{}", e))?;

    let family_name = family.as_str();
    let mut credentials = serde_json::Map::new();
    credentials.insert(
        "oauth:active_provider".to_string(),
        Value::String(family_name.into()),
    );
    credentials.insert(
        format!("oauth:{family_name}:user_info"),
        Value::String(user_info_json),
    );
    credentials.insert("zcodejwttoken".to_string(), Value::String(zcode_jwt));
    credentials.insert(
        format!("oauth:{family_name}:access_token"),
        Value::String(business_access_token),
    );
    if !refresh_token.is_empty() {
        credentials.insert(
            format!("oauth:{family_name}:refresh_token"),
            Value::String(refresh_token),
        );
    }

    let default_name = if let Some(at) = email.find('@') {
        email[..at].to_string()
    } else if !phone.is_empty() {
        format!("账号 {}", phone)
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
            "phone": phone,
            "avatar": avatar,
        },
        "credentials": Value::Object(credentials),
        "family": family_name,
        "mode": "oauth",
        "provider_api_keys": {},
    });

    let portable_text =
        serde_json::to_string(&portable).map_err(|e| format!("portable 序列化失败:{}", e))?;
    crate::profile::import_profile_json(portable_text).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorize_url_uses_registered_callback() {
        let url = build_authorize_url(OAuthFamily::Zai, "state-123")
            .expect("authorize URL should build");
        let parsed = reqwest::Url::parse(&url).expect("authorize URL should parse");
        let params: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();

        assert_eq!(
            params.get("redirect_uri").map(String::as_str),
            Some(CALLBACK_URI)
        );
        assert!(!url.contains("/app/oauth/login"));
        assert_eq!(params.get("state"), Some(&"state-123".to_string()));
        assert_eq!(params.get("response_type"), Some(&"code".to_string()));
        assert_eq!(params.get("client_id"), Some(&CLIENT_ID.to_string()));
    }

    #[test]
    fn bigmodel_authorize_url_uses_official_login_params() {
        let url = build_authorize_url(OAuthFamily::BigModel, "state-456")
            .expect("authorize URL should build");
        let parsed = reqwest::Url::parse(&url).expect("authorize URL should parse");
        let params: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(parsed.as_str().split('?').next(), Some(BIGMODEL_AUTHORIZE_URL));
        assert_eq!(params.get("appId"), Some(&BIGMODEL_APP_ID.to_string()));
        assert_eq!(params.get("state"), Some(&"state-456".to_string()));
        assert_eq!(
            params.get("redirect").map(String::as_str),
            Some(CALLBACK_URI)
        );
        assert!(!url.contains("/app/oauth/login"));
        assert!(!params.contains_key("client_id"));
        assert!(!params.contains_key("redirect_uri"));
    }

    #[test]
    fn parses_success_callback_and_ignores_other_urls() {
        let callback =
            callback_data_from_url("zcode://oauth/callback?code=abc%20123&state=state-123")
                .expect("registered callback should be recognized")
                .expect("valid callback should parse");
        assert_eq!(callback.code, "abc 123");
        assert_eq!(callback.state, "state-123");

        let callback = callback_data_from_url("zcode:/oauth/callback?code=abc&state=state-123")
            .expect("path-style callback should be recognized")
            .expect("path-style callback should parse");
        assert_eq!(callback.code, "abc");

        assert!(callback_data_from_url("https://example.com/oauth/callback").is_none());
    }

    #[test]
    fn parses_oauth_error_callback() {
        let error = callback_data_from_url(
            "zcode://oauth/callback?error=access_denied&error_description=User%20cancelled",
        )
        .expect("registered callback should be recognized")
        .expect_err("error callback should fail");
        assert!(error.contains("access_denied"));
        assert!(error.contains("User cancelled"));
    }
}
