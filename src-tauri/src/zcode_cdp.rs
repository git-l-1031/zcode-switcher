//! 通过 Chrome DevTools Protocol 远程触发 ZCode 内的
//! `modelProviderService.refreshCodingPlanApiKey('builtin:zai-start-plan')`，
//! 让切号瞬时生效，不依赖用户当前在哪个 UI 页面。
//!
//! 前置：ZCode 必须用带 `--remote-debugging-port=9229` 的快捷方式启动
//! （由 zcode_launcher 模块负责改写）。否则这里所有调用都会静默失败。
//!
//! 注入流程：
//!   1. HTTP GET 127.0.0.1:9229/json/list 找到 type=page, title=ZCode 的渲染进程
//!   2. WS 连过去，发 Runtime.evaluate 跑一段 JS：
//!      - 走 React Fiber 树找 modelProviderService（首次发现后缓存到 window）
//!      - 调 refreshCodingPlanApiKey
//!   3. 等响应或超时（2s 上限），关闭 WS

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

const CDP_PORT: u16 = 9229;
const HTTP_TIMEOUT: Duration = Duration::from_millis(1500);
const WS_TIMEOUT: Duration = Duration::from_millis(3000);

/// 已知的 builtin:zai-* plan id 列表。导入别人 JSON 的用户，原账号可能用 coding-plan，
/// 我们这只更新 start-plan 的 apiKey 就会"切了号还是原来的"。所以全量刷一遍。
const ZAI_PLAN_IDS: &[&str] = &["builtin:zai-start-plan", "builtin:zai-coding-plan"];

/// 自包含 JS：找 service（带缓存）+ 依次刷新已知的 builtin:zai-* plan。返回 {ok, cached, refreshed, err?}
const INJECT_SCRIPT: &str = r#"(async () => {
  function getAnyFiber() {
    const cands = [document.body, document.getElementById('root'), document.documentElement];
    for (const el of cands) {
      if (!el) continue;
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'));
      if (key) return el[key];
    }
    const all = document.querySelectorAll('*');
    for (let i = 0; i < Math.min(200, all.length); i++) {
      const key = Object.keys(all[i]).find(k => k.startsWith('__reactFiber$'));
      if (key) return all[i][key];
    }
    return null;
  }
  function getRoot(fiber) {
    let cur = fiber;
    while (cur.return) cur = cur.return;
    return cur;
  }
  function findService() {
    const anyFiber = getAnyFiber();
    if (!anyFiber) return null;
    const root = getRoot(anyFiber);
    const seen = new WeakSet();
    function deepFind(obj, depth) {
      if (!obj || depth > 3 || typeof obj !== 'object' || seen.has(obj)) return null;
      seen.add(obj);
      if (typeof obj.refreshCodingPlanApiKey === 'function') return obj;
      for (const k of ['modelProviderService', 'services', 'value']) {
        try {
          const v = obj[k];
          if (v && typeof v === 'object') {
            if (typeof v.refreshCodingPlanApiKey === 'function') return v;
            if (k === 'services' && v.modelProviderService &&
                typeof v.modelProviderService.refreshCodingPlanApiKey === 'function') {
              return v.modelProviderService;
            }
          }
        } catch {}
      }
      for (const k in obj) {
        try {
          const v = obj[k];
          if (v && typeof v === 'object') {
            const got = deepFind(v, depth + 1);
            if (got) return got;
          }
        } catch {}
      }
      return null;
    }
    const stack = [root];
    let count = 0;
    while (stack.length && count < 200000) {
      const node = stack.pop();
      count++;
      for (const slot of ['memoizedProps', 'memoizedState', 'pendingProps', 'stateNode']) {
        const v = node[slot];
        if (!v) continue;
        const svc = deepFind(v, 0);
        if (svc) return svc;
      }
      if (node.child) stack.push(node.child);
      if (node.sibling) stack.push(node.sibling);
    }
    return null;
  }
  let svc = window.__zcsModelProviderService;
  let cached = !!svc;
  if (!svc) {
    svc = findService();
    if (svc) window.__zcsModelProviderService = svc;
  }
  if (!svc) return { ok: false, cached: false, err: 'service-not-found' };
  const planIds = ['builtin:zai-start-plan', 'builtin:zai-coding-plan'];
  const refreshed = [];
  const errs = [];
  for (const id of planIds) {
    try {
      await svc.refreshCodingPlanApiKey(id);
      refreshed.push(id);
    } catch (e) {
      errs.push(id + ':' + String(e));
    }
  }
  return refreshed.length > 0
    ? { ok: true, cached, refreshed, errs }
    : { ok: false, cached, err: errs.join(';') };
})()"#;

#[derive(Debug, Deserialize)]
struct CdpTarget {
    #[serde(rename = "type")]
    target_type: String,
    title: String,
    url: String,
    #[serde(rename = "webSocketDebuggerUrl")]
    ws_url: String,
}

async fn pick_zcode_page() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .ok()?;
    let url = format!("http://127.0.0.1:{}/json/list", CDP_PORT);
    let resp = client.get(&url).send().await.ok()?;
    let targets: Vec<CdpTarget> = resp.json().await.ok()?;
    targets
        .into_iter()
        .find(|t| {
            t.target_type == "page"
                && t.title == "ZCode"
                && t.url.contains("renderer/index.html")
        })
        .map(|t| t.ws_url)
}

async fn evaluate(ws_url: &str, expression: &str) -> Result<String, String> {
    let (mut ws, _) = tokio_tungstenite::connect_async(ws_url)
        .await
        .map_err(|e| format!("ws connect: {}", e))?;

    let req = serde_json::json!({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": expression,
            "returnByValue": true,
            "awaitPromise": true,
        }
    });
    ws.send(Message::Text(req.to_string().into()))
        .await
        .map_err(|e| format!("ws send: {}", e))?;

    let result = tokio::time::timeout(WS_TIMEOUT, async {
        while let Some(msg) = ws.next().await {
            let msg = msg.map_err(|e| format!("ws recv: {}", e))?;
            if let Message::Text(text) = msg {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if v.get("id").and_then(|v| v.as_u64()) == Some(1) {
                        return Ok::<_, String>(text.to_string());
                    }
                }
            }
        }
        Err("ws closed before response".to_string())
    })
    .await
    .map_err(|_| "ws timeout".to_string())?;

    let _ = ws.close(None).await;
    result
}

/// 试图通过 CDP 远程触发 refreshCodingPlanApiKey。
/// 端口不通 / ZCode 没开 / 注入失败 都会返回 false，不抛错。
pub async fn try_trigger_refresh() -> bool {
    let Some(ws_url) = pick_zcode_page().await else {
        return false;
    };
    matches!(evaluate(&ws_url, INJECT_SCRIPT).await, Ok(text) if text.contains("\"ok\":true"))
}

/// 切号后定时触发：在切换开始的 +0.5s / +3s / +5s（绝对时间）各试一次。
/// 0.5s 是为了用户操作流畅、能立刻接着发消息；3s / 5s 是兜底。
/// 多次注入都成功只是幂等多刷几次 RPC，无副作用。
pub fn schedule_post_switch_refresh() {
    tauri::async_runtime::spawn(async {
        let start = std::time::Instant::now();
        for &t_ms in &[500u64, 3000, 5000] {
            let elapsed = start.elapsed().as_millis() as u64;
            if elapsed < t_ms {
                tokio::time::sleep(Duration::from_millis(t_ms - elapsed)).await;
            }
            let _ = try_trigger_refresh().await;
        }
    });
}

#[allow(dead_code)]
pub fn known_plan_ids() -> &'static [&'static str] {
    ZAI_PLAN_IDS
}
