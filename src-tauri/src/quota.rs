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

async fn fetch_billing_current(
    client: &reqwest::Client,
    token: &str,
) -> Result<BillingCurrentData, String> {
    let url = format!("{}/api/v1/zcode-plan/billing/current", BASE);
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("请求 billing/current 失败：{}", e))?;
    if !resp.status().is_success() {
        return Err(format!("billing/current 状态码 {}", resp.status()));
    }
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
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("请求 billing/balance 失败：{}", e))?;
    if !resp.status().is_success() {
        return Err(format!("billing/balance 状态码 {}", resp.status()));
    }
    let env: ApiEnvelope<BillingBalanceData> =
        resp.json().await.map_err(|e| format!("解析失败：{}", e))?;
    env.data
        .ok_or_else(|| format!("billing/balance 返回 code={}", env.code))
}
