//! 订阅额度查询：用解密后的 zcodejwttoken 调 ZCode 的 billing 接口。
//!
//! - GET https://zcode.z.ai/api/v1/zcode-plan/billing/current  → 当前套餐
//! - GET https://zcode.z.ai/api/v1/zcode-plan/billing/balance  → 各模型用量/余额

use serde::Deserialize;
use serde_json::Value;

use crate::crypto;

const BASE: &str = "https://zcode.z.ai";

/// 单个模型的用量条目（balance.data.balances[]）。
#[derive(Debug, Clone, serde::Serialize, Deserialize)]
pub struct BalanceItem {
    #[serde(default)]
    pub show_name: String,
    #[serde(default)]
    pub used_units: f64,
    #[serde(default)]
    pub total_units: f64,
    #[serde(default)]
    pub remaining_units: f64,
    #[serde(default)]
    pub unit_type: Option<String>,
    #[serde(default)]
    pub period: Option<String>,
}

/// 一个账号的订阅/额度汇总（传给前端）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct QuotaInfo {
    pub plan_name: Option<String>,
    pub plan_description: Option<String>,
    pub plan_status: Option<String>,
    /// 套餐到期时间（Unix 秒，0 表示无）
    pub plan_ends_at: Option<f64>,
    pub balances: Vec<BalanceItem>,
}

#[derive(Deserialize)]
struct ApiEnvelope<T> {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    data: Option<T>,
}

#[derive(Deserialize, Default)]
struct BillingCurrentData {
    #[serde(default)]
    plans: Vec<PlanInfo>,
}

#[derive(Deserialize)]
struct PlanInfo {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    priority: Option<i64>,
    #[serde(default)]
    ends_at: Option<f64>,
}

#[derive(Deserialize, Default)]
struct BillingBalanceData {
    #[serde(default)]
    balances: Vec<Value>,
}

/// 用某份 credentials.json（JSON 文本）查询其额度。
pub async fn fetch_quota(creds_text: &str) -> Result<QuotaInfo, String> {
    let creds: Value =
        serde_json::from_str(creds_text).map_err(|e| format!("解析 credentials 失败：{}", e))?;
    let token =
        crypto::extract_jwt_token(&creds).ok_or_else(|| "无法解出 zcodejwttoken".to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败：{}", e))?;

    // 并发拉取两个接口
    let (current, balance) = tokio::join!(
        fetch_billing_current(&client, &token),
        fetch_billing_balance(&client, &token)
    );

    let current_error = current.as_ref().err().cloned();
    let (plan_name, plan_description, plan_status, plan_ends_at) = match current {
        Ok(d) => {
            // 选 priority 最高的 plan
            let best = d.plans.into_iter().max_by_key(|p| p.priority.unwrap_or(0));
            match best {
                Some(p) => (
                    p.name,
                    p.description,
                    p.status,
                    p.ends_at.filter(|v| *v > 0.0),
                ),
                None => (None, None, None, None),
            }
        }
        Err(_) => (None, None, None, None),
    };

    let balances: Vec<BalanceItem> = match balance {
        Ok(d) => d
            .balances
            .into_iter()
            .filter_map(|v| serde_json::from_value::<BalanceItem>(v).ok())
            .collect(),
        Err(e) => {
            if let Some(current_error) = current_error {
                return Err(format!(
                    "额度查询失败：套餐接口：{}；余额接口：{}",
                    current_error, e
                ));
            }
            return Err(format!("额度明细获取失败：{}", e));
        }
    };
    if balances.is_empty() {
        return Err("额度接口未返回可显示的模型额度明细".into());
    }

    Ok(QuotaInfo {
        plan_name,
        plan_description,
        plan_status,
        plan_ends_at,
        balances,
    })
}

/// 发起 GET 请求。最多 2 次尝试：
/// - 429：按 Retry-After 头退避后重试一次；
/// - 请求超时 / 连接失败：立即重试一次；
/// - 其它非 2xx 错误：直接报错，不重试。
///
/// 最终若两次都超时，返回错误字符串里含"请求超时"，让前端可以识别成"超时"展示。
async fn get_with_retry(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    label: &str,
) -> Result<reqwest::Response, String> {
    const MAX_ATTEMPTS: usize = 2;
    let mut last_err: Option<String> = None;

    for attempt in 0..MAX_ATTEMPTS {
        let result = client
            .get(url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await;

        match result {
            Ok(resp) => {
                let status = resp.status();
                if status.as_u16() == 429 && attempt + 1 < MAX_ATTEMPTS {
                    // Retry-After 优先识别秒数，缺省 2s，封顶 10s，避免长时间挂起。
                    let wait_secs = resp
                        .headers()
                        .get(reqwest::header::RETRY_AFTER)
                        .and_then(|v| v.to_str().ok())
                        .and_then(|s| s.trim().parse::<u64>().ok())
                        .unwrap_or(2)
                        .clamp(1, 10);
                    drop(resp);
                    tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
                    last_err = Some(format!("{} 限流重试后仍未恢复", label));
                    continue;
                }
                if !status.is_success() {
                    return Err(format!("{} 状态码 {}", label, status));
                }
                return Ok(resp);
            }
            Err(e) => {
                let is_timeout_like = e.is_timeout() || e.is_connect();
                if is_timeout_like && attempt + 1 < MAX_ATTEMPTS {
                    last_err = Some("请求超时".to_string());
                    continue;
                }
                if is_timeout_like {
                    return Err("请求超时".to_string());
                }
                return Err(format!("请求 {} 失败：{}", label, e));
            }
        }
    }

    Err(last_err.unwrap_or_else(|| format!("{} 重试后仍未恢复", label)))
}

async fn fetch_billing_current(
    client: &reqwest::Client,
    token: &str,
) -> Result<BillingCurrentData, String> {
    let url = format!("{}/api/v1/zcode-plan/billing/current", BASE);
    let resp = get_with_retry(client, &url, token, "billing/current").await?;
    let env: ApiEnvelope<BillingCurrentData> =
        resp.json().await.map_err(|e| format!("解析失败：{}", e))?;
    env.data
        .ok_or_else(|| format!("billing/current 返回 code={}", env.code))
}

async fn fetch_billing_balance(
    client: &reqwest::Client,
    token: &str,
) -> Result<BillingBalanceData, String> {
    let url = format!("{}/api/v1/zcode-plan/billing/balance", BASE);
    let resp = get_with_retry(client, &url, token, "billing/balance").await?;
    let env: ApiEnvelope<BillingBalanceData> =
        resp.json().await.map_err(|e| format!("解析失败：{}", e))?;
    env.data
        .ok_or_else(|| format!("billing/balance 返回 code={}", env.code))
}
