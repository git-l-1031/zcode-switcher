use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::net::SocketAddr;
use std::sync::{Mutex, OnceLock};

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use bytes::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};

use crate::custom_provider::{enabled_providers_with_keys, ApiFormat, CustomProviderView};

const ZCODE_MESSAGES_URL: &str = "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages";
const ZCODE_SWITCHER_PROVIDER_ID: &str = "custom:zcode-switcher-local-api";

#[derive(Debug, Clone)]
struct ProxyConfig {
    gateway_key: String,
}

#[derive(Debug)]
struct ProxyRuntime {
    port: u16,
    gateway_key: String,
    shutdown: Option<oneshot::Sender<()>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyStatus {
    pub running: bool,
    pub port: u16,
    pub base_url: String,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    ok: bool,
    providers: usize,
    accounts: usize,
}

#[derive(Debug, Serialize)]
struct ModelsResponse {
    data: Vec<ModelItem>,
}

#[derive(Debug, Serialize)]
struct ModelItem {
    id: String,
    #[serde(rename = "type")]
    item_type: &'static str,
    display_name: String,
    provider: String,
}

#[derive(Clone)]
enum Upstream {
    ZcodeJwt {
        name: String,
        token: String,
    },
    CustomProvider {
        provider: CustomProviderView,
        api_key: String,
        url: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: Value,
}

static PROXY: OnceLock<Mutex<Option<ProxyRuntime>>> = OnceLock::new();

fn proxy_slot() -> &'static Mutex<Option<ProxyRuntime>> {
    PROXY.get_or_init(|| Mutex::new(None))
}

fn status_for(port: u16, running: bool) -> ProxyStatus {
    ProxyStatus {
        running,
        port,
        base_url: format!("http://127.0.0.1:{}/v1", port),
    }
}

fn local_provider_value(base_url: &str, gateway_key: &str) -> Value {
    serde_json::json!({
        "name": "ZCode Switcher",
        "kind": "anthropic",
        "options": {
            "apiKey": gateway_key,
            "apiKeyRequired": true,
            "baseURL": base_url
        },
        "enabled": true,
        "source": "custom",
        "models": {
            "GLM-5.2": {
                "limit": {
                    "context": 1000000
                },
                "modalities": {
                    "input": ["text"],
                    "output": ["text"]
                }
            }
        }
    })
}

fn upsert_zcode_local_provider(port: u16, gateway_key: &str) -> Result<(), String> {
    let path = crate::profile::zcode_v2_dir()
        .map_err(|e| e.to_string())?
        .join("config.json");
    let mut cfg = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<Value>(&text).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    if !cfg.is_object() {
        cfg = serde_json::json!({});
    }
    let obj = cfg
        .as_object_mut()
        .ok_or_else(|| "ZCode config.json 不是对象".to_string())?;
    let providers = obj
        .entry("provider".to_string())
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let providers_obj = providers
        .as_object_mut()
        .ok_or_else(|| "ZCode provider 配置不是对象".to_string())?;
    providers_obj.insert(
        ZCODE_SWITCHER_PROVIDER_ID.to_string(),
        local_provider_value(&format!("http://127.0.0.1:{}", port), gateway_key),
    );
    let bytes = serde_json::to_vec_pretty(&cfg).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())
    } else {
        fs::write(path, bytes).map_err(|e| e.to_string())
    }
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({
            "error": {
                "type": "authentication_error",
                "message": "Missing or invalid local gateway key"
            }
        })),
    )
        .into_response()
}

fn check_gateway_auth(headers: &HeaderMap, gateway_key: &str) -> Result<(), Response> {
    let bearer_ok = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|v| v == gateway_key)
        .unwrap_or(false);
    let x_key_ok = headers
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == gateway_key)
        .unwrap_or(false);
    if bearer_ok || x_key_ok {
        Ok(())
    } else {
        Err(unauthorized())
    }
}

fn messages_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/messages") {
        base.to_string()
    } else {
        format!("{}/messages", base)
    }
}

fn openai_chat_url(base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{}/chat/completions", base)
    }
}

fn anthropic_to_openai_body(request: &Value) -> Value {
    let system_text = request
        .get("system")
        .map(|system| match system {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .filter(|s| !s.trim().is_empty());
    let mut messages = Vec::new();
    if let Some(system) = system_text {
        messages.push(serde_json::json!({ "role": "system", "content": system }));
    }
    if let Some(items) = request.get("messages").and_then(Value::as_array) {
        for item in items {
            let Ok(message) = serde_json::from_value::<AnthropicMessage>(item.clone()) else {
                continue;
            };
            let content = match message.content {
                Value::String(s) => s,
                Value::Array(parts) => parts
                    .into_iter()
                    .filter_map(|part| {
                        part.get("text")
                            .and_then(Value::as_str)
                            .map(|text| text.to_string())
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
                other => other.to_string(),
            };
            messages.push(serde_json::json!({
                "role": message.role,
                "content": content,
            }));
        }
    }
    let mut body = serde_json::json!({
        "model": request
            .get("model")
            .and_then(Value::as_str)
            .map(normalize_model_id)
            .map(|model| Value::String(model.to_string()))
            .unwrap_or_else(|| Value::String("glm-5.2".into())),
        "messages": messages,
        "stream": request.get("stream").cloned().unwrap_or(Value::Bool(false)),
    });
    if let Some(value) = request.get("temperature") {
        body["temperature"] = value.clone();
    }
    if let Some(value) = request.get("max_tokens") {
        body["max_tokens"] = value.clone();
    }
    body
}

fn normalize_model_id(model: &str) -> &str {
    model.rsplit('/').next().unwrap_or(model)
}

fn normalize_zcode_model(model: &str) -> String {
    let model = normalize_model_id(model);
    match model.to_ascii_lowercase().as_str() {
        "glm-5.2" => "GLM-5.2".to_string(),
        "glm-5-turbo" | "glm-turbo" => "GLM-5-Turbo".to_string(),
        "glm-5.1" => "GLM-5.1".to_string(),
        "glm-4.7" => "GLM-4.7".to_string(),
        _ => model.to_string(),
    }
}

fn normalize_zcode_body(request: &Value) -> Value {
    let mut body = request.clone();
    if let Some(model) = body.get("model").and_then(Value::as_str) {
        body["model"] = Value::String(normalize_zcode_model(model));
    }
    if let Some(messages) = body.get_mut("messages").and_then(Value::as_array_mut) {
        for message in messages {
            let Some(obj) = message.as_object_mut() else {
                continue;
            };
            let Some(text) = obj
                .get("content")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            obj.insert(
                "content".to_string(),
                Value::Array(vec![serde_json::json!({ "type": "text", "text": text })]),
            );
        }
    }
    body
}

fn custom_provider_upstream(provider: CustomProviderView, api_key: String) -> Upstream {
    let url = if provider.api_format == ApiFormat::OpenAI {
        openai_chat_url(&provider.base_url)
    } else {
        messages_url(&provider.base_url)
    };
    Upstream::CustomProvider {
        provider,
        api_key,
        url,
    }
}

fn choose_upstreams(request: &Value) -> Result<Vec<Upstream>, Response> {
    let raw_model = request
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let model = normalize_model_id(raw_model);
    let mut upstreams = Vec::new();
    let pool = crate::proxy_pool::enabled_pool_profiles().map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": {
                    "type": "provider_error",
                    "message": e
                }
            })),
        )
            .into_response()
    })?;
    for profile in pool {
        let mode = if profile.profile.mode.is_empty() {
            "oauth"
        } else {
            profile.profile.mode.as_str()
        };
        if mode != "oauth" {
            continue;
        }
        let Ok(text) = crate::profile::profile_credentials_text(&profile.profile.id) else {
            continue;
        };
        let Ok(creds) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(token) = crate::crypto::extract_jwt_token(&creds) else {
            continue;
        };
        upstreams.push(Upstream::ZcodeJwt {
            name: profile.profile.name,
            token,
        });
    }

    let providers = enabled_providers_with_keys();
    let mut used_provider_ids = HashSet::new();
    for (provider, api_key) in providers
        .iter()
        .filter(|(provider, _)| model.is_empty() || provider.models.iter().any(|m| m == model))
    {
        used_provider_ids.insert(provider.id.clone());
        upstreams.push(custom_provider_upstream(provider.clone(), api_key.clone()));
    }
    for (provider, api_key) in providers
        .iter()
        .filter(|(provider, _)| provider.api_format == ApiFormat::Anthropic)
    {
        if !used_provider_ids.insert(provider.id.clone()) {
            continue;
        }
        upstreams.push(custom_provider_upstream(provider.clone(), api_key.clone()));
    }
    for (provider, api_key) in providers
        .into_iter()
        .filter(|(provider, _)| !used_provider_ids.contains(&provider.id))
    {
        upstreams.push(custom_provider_upstream(provider, api_key));
    }

    if upstreams.is_empty() {
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({
                "error": {
                    "type": "provider_error",
                    "message": "No enabled account pool entry or custom provider"
                }
            })),
        )
            .into_response());
    }
    Ok(upstreams)
}

fn is_captcha_response(status: StatusCode, bytes: &[u8]) -> bool {
    if status != StatusCode::FORBIDDEN {
        return false;
    }
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    text.contains("captcha")
        || text.contains("verify")
        || text.contains("3007")
        || text.contains("验证码")
        || text.contains("校验")
}

fn is_stream_request(request: &Value) -> bool {
    request
        .get("stream")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn provider_error_response(
    stream: bool,
    status: StatusCode,
    error_type: &str,
    message: String,
) -> Response {
    let payload = serde_json::json!({
        "error": {
            "type": error_type,
            "message": message
        }
    });
    if stream {
        let mut response =
            Response::new(Body::from(format!("event: error\ndata: {}\n\n", payload)));
        *response.status_mut() = StatusCode::OK;
        response.headers_mut().insert(
            "content-type",
            HeaderValue::from_static("text/event-stream; charset=utf-8"),
        );
        return response;
    }
    (status, Json(payload)).into_response()
}

async fn root() -> Json<Value> {
    Json(serde_json::json!({
        "ok": true,
        "service": "zcode-switcher-local-api"
    }))
}

async fn health() -> Json<HealthResponse> {
    let accounts = crate::proxy_pool::enabled_pool_profiles()
        .map(|profiles| profiles.len())
        .unwrap_or(0);
    Json(HealthResponse {
        ok: true,
        providers: enabled_providers_with_keys().len(),
        accounts,
    })
}

async fn models(
    State(config): State<ProxyConfig>,
    headers: HeaderMap,
) -> Result<Json<ModelsResponse>, Response> {
    check_gateway_auth(&headers, &config.gateway_key)?;
    let mut data = Vec::new();
    if !crate::proxy_pool::enabled_pool_profiles()
        .unwrap_or_default()
        .is_empty()
    {
        data.push(ModelItem {
            id: "glm-5.2".into(),
            item_type: "model",
            display_name: "GLM-5.2".into(),
            provider: "ZCode account pool".into(),
        });
    }
    for (provider, _) in enabled_providers_with_keys() {
        for model in provider.models {
            data.push(ModelItem {
                id: model.clone(),
                item_type: "model",
                display_name: model,
                provider: provider.name.clone(),
            });
        }
    }
    Ok(Json(ModelsResponse { data }))
}

fn estimate_input_tokens(value: &Value) -> usize {
    fn text_len(value: &Value) -> usize {
        match value {
            Value::String(text) => text.chars().count(),
            Value::Array(items) => items.iter().map(text_len).sum(),
            Value::Object(map) => map.values().map(text_len).sum(),
            _ => 0,
        }
    }
    (text_len(value) / 4).max(1)
}

async fn count_tokens(
    State(config): State<ProxyConfig>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, Response> {
    check_gateway_auth(&headers, &config.gateway_key)?;
    let request: Value = serde_json::from_slice(&body).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": {
                    "type": "invalid_request_error",
                    "message": format!("Invalid JSON body: {}", e)
                }
            })),
        )
            .into_response()
    })?;
    Ok(Json(serde_json::json!({
        "input_tokens": estimate_input_tokens(&request)
    })))
}

async fn messages_probe(
    State(config): State<ProxyConfig>,
    headers: HeaderMap,
) -> Result<Json<Value>, Response> {
    check_gateway_auth(&headers, &config.gateway_key)?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "endpoint": "messages"
    })))
}

async fn messages(
    State(config): State<ProxyConfig>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    check_gateway_auth(&headers, &config.gateway_key)?;
    let request: Value = serde_json::from_slice(&body).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": {
                    "type": "invalid_request_error",
                    "message": format!("Invalid JSON body: {}", e)
                }
            })),
        )
            .into_response()
    })?;
    let upstreams = choose_upstreams(&request)?;
    let zcode_body = Bytes::from(serde_json::to_vec(&normalize_zcode_body(&request)).map_err(
        |e| {
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": {
                        "type": "invalid_request_error",
                        "message": e.to_string()
                    }
                })),
            )
                .into_response()
        },
    )?);
    let request_is_stream = is_stream_request(&request);

    let client = reqwest::Client::new();
    let needs_captcha = upstreams
        .iter()
        .any(|upstream| matches!(upstream, Upstream::ZcodeJwt { .. }));
    let mut captcha_count = 0usize;
    let mut last_error = None;

    for upstream in upstreams {
        match upstream {
            Upstream::ZcodeJwt { name, token } => {
                // 学 zcode2api _try_account：每个账号独立求 param，3007 后同账号重试。
                // param 是一次性消费 + 短时效，绝不能多账号共用一个。
                for attempt in 0..3usize {
                    let captcha_param = match crate::captcha::verify_param(&client).await {
                        Ok(p) => p,
                        Err(err) => {
                            captcha_count += 1;
                            last_error = Some(err);
                            break; // 求参失败，换下一个账号
                        }
                    };
                    let resp = client
                        .request(Method::POST, ZCODE_MESSAGES_URL)
                        .header("content-type", "application/json")
                        .header("authorization", format!("Bearer {}", token))
                        .header("anthropic-version", "2023-06-01")
                        .header("user-agent", "ZCode/3.0.1")
                        .header("x-zcode-app-version", "3.0.1")
                        .header("x-zcode-agent", "glm")
                        .header("http-referer", "https://zcode.z.ai/")
                        .header("x-aliyun-captcha-verify-param", &captcha_param)
                        .body(zcode_body.clone())
                        .send()
                        .await;
                    let upstream_resp = match resp {
                        Ok(r) => r,
                        Err(e) => {
                            last_error = Some(e.to_string());
                            break; // 网络错误，换账号
                        }
                    };
                    let status = upstream_resp.status();
                    let content_type = upstream_resp
                        .headers()
                        .get("content-type")
                        .cloned()
                        .unwrap_or_else(|| HeaderValue::from_static("application/json"));
                    let bytes = match upstream_resp.bytes().await {
                        Ok(b) => b,
                        Err(e) => {
                            last_error = Some(e.to_string());
                            break;
                        }
                    };
                    // [临时调试] 打印上游对每个账号的完整响应（写入文件，便于窗口正常显示时抓取）
                    {
                        let log_line = format!(
                            "[UPSTREAM_DEBUG] 账号={} 尝试={} 状态={} body={}\n",
                            &name,
                            attempt + 1,
                            status,
                            String::from_utf8_lossy(&bytes)
                                .chars()
                                .take(400)
                                .collect::<String>()
                        );
                        let log_path = std::env::temp_dir().join("zcode-proxy-debug.log");
                        let _ = std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(&log_path)
                            .and_then(|mut f| {
                                std::io::Write::write_all(&mut f, log_line.as_bytes())
                            });
                    }

                    // 流式：直接透传（body 已读出，用 Body::from 重新包装）
                    if request_is_stream && status != StatusCode::FORBIDDEN {
                        let mut response = Response::new(Body::from(bytes));
                        *response.status_mut() = status;
                        response.headers_mut().insert("content-type", content_type);
                        return Ok(response);
                    }

                    if is_captcha_response(status, &bytes) {
                        crate::captcha::invalidate_verify_param().await;
                        captcha_count += 1;
                        continue; // 同账号重试，现求新 param
                    }
                    let mut response = Response::new(Body::from(bytes));
                    *response.status_mut() = status;
                    response.headers_mut().insert("content-type", content_type);
                    return Ok(response);
                }
                continue; // 此账号重试用尽，换下一个账号
            }
            Upstream::CustomProvider {
                provider,
                api_key,
                url,
            } => {
                let outbound_body = if provider.api_format == ApiFormat::OpenAI {
                    serde_json::to_vec(&anthropic_to_openai_body(&request)).map_err(|e| {
                        (
                            StatusCode::BAD_REQUEST,
                            Json(serde_json::json!({
                                "error": {
                                    "type": "invalid_request_error",
                                    "message": e.to_string()
                                }
                            })),
                        )
                            .into_response()
                    })?
                } else {
                    body.to_vec()
                };
                let mut builder = client
                    .request(Method::POST, url)
                    .header("content-type", "application/json");
                if provider.api_format == ApiFormat::OpenAI {
                    builder = builder.header("authorization", format!("Bearer {}", api_key));
                } else {
                    builder = builder.header("x-api-key", api_key);
                    if !headers.contains_key("anthropic-version") {
                        builder = builder.header("anthropic-version", "2023-06-01");
                    }
                    if let Some(v) = headers
                        .get("anthropic-version")
                        .and_then(|v| v.to_str().ok())
                    {
                        builder = builder.header("anthropic-version", v);
                    }
                    if let Some(v) = headers.get("anthropic-beta").and_then(|v| v.to_str().ok()) {
                        builder = builder.header("anthropic-beta", v);
                    }
                }
                let req = builder.body(outbound_body);
                let upstream_resp = match req.send().await {
                    Ok(r) => r,
                    Err(e) => {
                        last_error = Some(e.to_string());
                        continue;
                    }
                };
                let status = upstream_resp.status();
                let content_type = upstream_resp
                    .headers()
                    .get("content-type")
                    .cloned()
                    .unwrap_or_else(|| HeaderValue::from_static("application/json"));
                if request_is_stream && status != StatusCode::FORBIDDEN {
                    let mut response =
                        Response::new(Body::from_stream(upstream_resp.bytes_stream()));
                    *response.status_mut() = status;
                    response.headers_mut().insert("content-type", content_type);
                    return Ok(response);
                }
                let bytes = upstream_resp.bytes().await.map_err(|e| {
                    (
                        StatusCode::BAD_GATEWAY,
                        Json(serde_json::json!({
                            "error": {
                                "type": "provider_error",
                                "message": e.to_string()
                            }
                        })),
                    )
                        .into_response()
                })?;
                let mut response = Response::new(Body::from(bytes));
                *response.status_mut() = status;
                response.headers_mut().insert("content-type", content_type);
                return Ok(response);
            }
        }
    }

    if captcha_count > 0 {
        return Err(provider_error_response(
            request_is_stream,
            StatusCode::FORBIDDEN,
            "authentication_error",
            format!(
                "ZCode 账号池触发验证码校验，{}请稍后重试，或添加外部 API Key 上游作为兜底。",
                last_error
                    .map(|e| format!("最后一次求参失败：{}。", e))
                    .unwrap_or_else(|| "无痕验证参数已发送但上游仍拒绝。".to_string())
            ),
        ));
    }

    let _ = needs_captcha;
    Err(provider_error_response(
        request_is_stream,
        StatusCode::BAD_GATEWAY,
        "provider_error",
        last_error.unwrap_or_else(|| "No available upstream provider".to_string()),
    ))
}

fn build_router(config: ProxyConfig) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any);
    Router::new()
        .route("/", get(root).post(root))
        .route("/v1", get(root).post(root))
        .route("/health", get(health).post(health))
        .route("/models", get(models).post(models))
        .route("/messages", get(messages_probe).post(messages))
        .route("/messages/count_tokens", post(count_tokens))
        .route("/v1/health", get(health).post(health))
        .route("/v1/models", get(models).post(models))
        .route("/v1/messages", get(messages_probe).post(messages))
        .route("/v1/messages/count_tokens", post(count_tokens))
        .route("/v1/v1", get(root).post(root))
        .route("/v1/v1/health", get(health).post(health))
        .route("/v1/v1/models", get(models).post(models))
        .route("/v1/v1/messages", get(messages_probe).post(messages))
        .route("/v1/v1/messages/count_tokens", post(count_tokens))
        .with_state(config)
        .layer(cors)
}

#[tauri::command]
pub async fn start_proxy(port: u16, gateway_key: String) -> Result<ProxyStatus, String> {
    if gateway_key.trim().len() < 12 {
        return Err("本地网关密钥至少需要 12 个字符".into());
    }
    if port == 0 {
        return Err("端口号无效".into());
    }

    if let Some((port, key)) = {
        let slot = proxy_slot().lock().map_err(|_| "代理状态锁异常")?;
        slot.as_ref()
            .map(|runtime| (runtime.port, runtime.gateway_key.clone()))
    } {
        upsert_zcode_local_provider(port, &key)?;
        crate::zcode_cdp::schedule_post_switch_refresh();
        return Ok(status_for(port, true));
    }

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| format!("本地代理启动失败：{}", e))?;
    let actual_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, rx) = oneshot::channel::<()>();
    let gateway_key = gateway_key.trim().to_string();
    let config = ProxyConfig {
        gateway_key: gateway_key.clone(),
    };
    let router = build_router(config);

    tokio::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async {
            let _ = rx.await;
        });
        let _ = server.await;
    });

    let mut slot = proxy_slot().lock().map_err(|_| "代理状态锁异常")?;
    *slot = Some(ProxyRuntime {
        port: actual_port,
        gateway_key: gateway_key.clone(),
        shutdown: Some(tx),
    });
    upsert_zcode_local_provider(actual_port, &gateway_key)?;
    crate::zcode_cdp::schedule_post_switch_refresh();
    Ok(status_for(actual_port, true))
}

#[tauri::command]
pub fn stop_proxy() -> Result<ProxyStatus, String> {
    let mut slot = proxy_slot().lock().map_err(|_| "代理状态锁异常")?;
    let port = slot.as_ref().map(|r| r.port).unwrap_or(0);
    if let Some(mut runtime) = slot.take() {
        if let Some(tx) = runtime.shutdown.take() {
            let _ = tx.send(());
        }
        Ok(status_for(runtime.port, false))
    } else {
        Ok(status_for(port, false))
    }
}

#[tauri::command]
pub fn proxy_status() -> Result<ProxyStatus, String> {
    let slot = proxy_slot().lock().map_err(|_| "代理状态锁异常")?;
    if let Some(runtime) = slot.as_ref() {
        Ok(status_for(runtime.port, true))
    } else {
        Ok(status_for(17860, false))
    }
}
