use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::sync::Mutex;

pub const ZCODE_APP_VERSION: &str = "3.1.5";
const CONFIG_BASE_URL: &str = "https://zcode.z.ai/api/v1/client/configs";
const CONFIG_TTL: Duration = Duration::from_secs(10 * 60);
const VERIFY_PARAM_TTL: Duration = Duration::from_secs(45);
const SOLVE_TIMEOUT: Duration = Duration::from_secs(40);
const SOLVE_RETRIES: usize = 4;
const SOLVER_FILE: &str = "captcha-solver.cjs";
const SOLVER_RUNTIME_DIR: &str = "captcha-runtime";

#[derive(Debug, Clone)]
struct CaptchaConfig {
    scene_id: String,
    region: String,
    prefix: String,
}

impl Default for CaptchaConfig {
    fn default() -> Self {
        Self {
            scene_id: "11xygtvd".into(),
            region: "sgp".into(),
            prefix: "no8xfe".into(),
        }
    }
}

#[derive(Debug, Default)]
struct CaptchaState {
    config: Option<(CaptchaConfig, Instant)>,
    verify_param: Option<(String, Instant)>,
}

#[derive(Debug, Deserialize)]
struct CaptchaConfigResponse {
    data: Option<CaptchaConfigData>,
}

#[derive(Debug, Deserialize)]
struct CaptchaConfigData {
    configs: Option<CaptchaConfigItems>,
}

#[derive(Debug, Deserialize)]
struct CaptchaConfigItems {
    captcha: Option<Value>,
}

static CAPTCHA: OnceLock<Mutex<CaptchaState>> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP_HANDLE.set(app);
}

fn captcha_state() -> &'static Mutex<CaptchaState> {
    CAPTCHA.get_or_init(|| Mutex::new(CaptchaState::default()))
}

fn read_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .filter_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .find(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_config(value: Value) -> CaptchaConfig {
    CaptchaConfig {
        scene_id: read_string(&value, &["sceneId", "scene_id"])
            .unwrap_or_else(|| "11xygtvd".into()),
        region: read_string(&value, &["region"]).unwrap_or_else(|| "sgp".into()),
        prefix: read_string(&value, &["prefix"]).unwrap_or_else(|| "no8xfe".into()),
    }
}

async fn fetch_config(client: &reqwest::Client) -> CaptchaConfig {
    let response = client
        .get(CONFIG_BASE_URL)
        .query(&[("app_version", ZCODE_APP_VERSION), ("platform", "win32")])
        .send()
        .await;
    let Ok(response) = response else {
        return CaptchaConfig::default();
    };
    let parsed = response.json::<CaptchaConfigResponse>().await;
    let Ok(parsed) = parsed else {
        return CaptchaConfig::default();
    };
    parsed
        .data
        .and_then(|data| data.configs)
        .and_then(|configs| configs.captcha)
        .map(parse_config)
        .unwrap_or_default()
}

async fn cached_or_fetch_config(
    client: &reqwest::Client,
    state: &mut CaptchaState,
) -> CaptchaConfig {
    if let Some((config, cached_at)) = &state.config {
        if cached_at.elapsed() < CONFIG_TTL {
            return config.clone();
        }
    }
    let config = fetch_config(client).await;
    state.config = Some((config.clone(), Instant::now()));
    config
}

fn solver_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(path) = std::env::var("ZCODE_CAPTCHA_SOLVER") {
        out.push(PathBuf::from(path));
    }
    if let Some(app) = APP_HANDLE.get() {
        if let Ok(dir) = app.path().resource_dir() {
            out.push(dir.join(SOLVER_RUNTIME_DIR).join(SOLVER_FILE));
            collect_candidates(&dir, &mut out);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        out.push(
            cwd.join("scripts")
                .join(SOLVER_RUNTIME_DIR)
                .join(SOLVER_FILE),
        );
        out.push(cwd.join("scripts").join(SOLVER_FILE));
        out.push(
            cwd.join("..")
                .join("scripts")
                .join(SOLVER_RUNTIME_DIR)
                .join(SOLVER_FILE),
        );
        out.push(cwd.join("..").join("scripts").join(SOLVER_FILE));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join(SOLVER_RUNTIME_DIR).join(SOLVER_FILE));
            out.push(
                dir.join("resources")
                    .join(SOLVER_RUNTIME_DIR)
                    .join(SOLVER_FILE),
            );
            out.push(
                dir.join("..")
                    .join("resources")
                    .join(SOLVER_RUNTIME_DIR)
                    .join(SOLVER_FILE),
            );
            let res = dir.join("resources");
            if res.is_dir() {
                collect_candidates(&res, &mut out);
            }
        }
    }
    out
}

fn collect_candidates(base: &std::path::Path, out: &mut Vec<PathBuf>) {
    if let Ok(entries) = std::fs::read_dir(base) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.push(path.join(SOLVER_FILE));
                collect_candidates(&path, out);
            }
        }
    }
}

/// 一个求解器候选是否真能跑：脚本本身存在，且旁边能解析到 jsdom
/// （`<dir>/node_modules/jsdom`）。裸脚本（旁边没有 node_modules）会让 node 在
/// `require("jsdom")` 时报 MODULE_NOT_FOUND（cjs/loader:1404），表现为误导性的
/// "求解器退出码 exit code: 1"。这里直接把这类候选排除，避免 fallback 命中。
fn solver_is_usable(path: &std::path::Path) -> bool {
    if !path.exists() {
        return false;
    }
    let Some(dir) = path.parent() else {
        return false;
    };
    dir.join("node_modules").join("jsdom").exists()
}

fn solver_path() -> Option<PathBuf> {
    solver_candidates()
        .into_iter()
        .find(|path| solver_is_usable(path))
}

fn missing_solver_error() -> String {
    // 区分两种失败：①脚本根本不存在 ②脚本在但旁边没有 node_modules/jsdom。
    // 后者最常见（裸脚本 / 运行时未生成），提示用户重建运行时。
    let existing: Vec<String> = solver_candidates()
        .into_iter()
        .filter(|path| path.exists())
        .map(|path| path.display().to_string())
        .collect();
    if existing.is_empty() {
        "未找到验证码求解脚本 captcha-runtime/captcha-solver.cjs".to_string()
    } else {
        format!(
            "验证码求解运行时缺少依赖（找不到 node_modules/jsdom）。\
             请运行 `node scripts/prepare-captcha-runtime.cjs` 重建运行时。\
             已找到但不可用的脚本：{}",
            existing.join("; ")
        )
    }
}

async fn run_solver(config: &CaptchaConfig) -> Result<String, String> {
    let solver = solver_path().ok_or_else(missing_solver_error)?;
    let output = tokio::time::timeout(
        SOLVE_TIMEOUT,
        Command::new("node")
            .arg(&solver)
            .arg(&config.scene_id)
            .arg(&config.region)
            .arg(&config.prefix)
            .current_dir(solver.parent().unwrap_or_else(|| std::path::Path::new(".")))
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "验证码求解超时".to_string())?
    .map_err(|e| format!("无法启动 Node 验证码求解器：{}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(value) = line.strip_prefix("VERIFY_PARAM=") {
            let value = value.trim();
            if !value.is_empty() {
                return Ok(value.to_string());
            }
        }
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let detail = stderr
        .lines()
        .find(|line| !line.trim().is_empty())
        .or_else(|| stdout.lines().find(|line| !line.trim().is_empty()))
        .unwrap_or("no output");
    Err(format!("验证码求解器退出码：{}，{}", output.status, detail))
}

pub async fn verify_param(client: &reqwest::Client) -> Result<String, String> {
    let mut state = captcha_state().lock().await;
    if let Some((param, cached_at)) = &state.verify_param {
        if cached_at.elapsed() < VERIFY_PARAM_TTL {
            return Ok(param.clone());
        }
    }

    let config = cached_or_fetch_config(client, &mut state).await;
    let mut last_error = None;
    for _ in 0..SOLVE_RETRIES {
        match run_solver(&config).await {
            Ok(param) => {
                state.verify_param = Some((param.clone(), Instant::now()));
                return Ok(param);
            }
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| "验证码求解失败".into()))
}

pub async fn invalidate_verify_param() {
    let mut state = captcha_state().lock().await;
    state.verify_param = None;
}
