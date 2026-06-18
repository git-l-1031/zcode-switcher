//! 自动重启 ZCode：枚举进程 → kill → 重启。
//!
//! ZCode 是基于 Electron 的桌面应用（Windows 上进程名为 `ZCode.exe`，
//! 多进程模型：1 个主进程 + 多个辅助/GPU 渲染进程）。重启时先把所有同名
//! 进程结束掉，再用之前记录的 exe 路径重新拉起。

use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, Signal, System, UpdateKind};

use crate::profile::AppError;

/// 目标进程名（跨平台）。
#[cfg(target_os = "windows")]
const PROC_NAMES: &[&str] = &["ZCode.exe"];
#[cfg(target_os = "macos")]
const PROC_NAMES: &[&str] = &["ZCode", "ZCode Helper"];
#[cfg(target_os = "linux")]
const PROC_NAMES: &[&str] = &["zcode", "ZCode"];

type R<T> = std::result::Result<T, AppError>;

#[derive(Debug, Serialize)]
pub struct RefreshZcodeAppServerReport {
    pub killed: usize,
    pub recovered: bool,
    pub restarted: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RestartSettings {
    zcode_exe_path: Option<String>,
}

/// 检测 ZCode 是否正在运行，返回主 exe 路径（若有）。
#[tauri::command]
pub fn zcode_running() -> R<Option<String>> {
    let path = find_main_path();
    if let Some(ref p) = path {
        let _ = save_known_path(p);
    }
    Ok(path)
}

/// 重启 ZCode：kill 全部同名进程 → 等待 800ms → 用记录的路径重启。
/// - 找不到运行中的 ZCode：直接尝试启动（若有已知路径）。
/// - 找不到 exe 路径：返回错误。
#[tauri::command]
pub fn restart_zcode() -> R<()> {
    // 1. 记录 exe 路径（先于 kill，否则后续枚举不到）。
    // 找不到运行中进程时，使用上次保存的安装路径。
    let running_path = find_main_path();
    if let Some(ref p) = running_path {
        let _ = save_known_path(p);
    }
    let exe_path = running_path.or_else(load_known_path).ok_or_else(|| {
        AppError::Msg(
            "找不到 ZCode 进程路径，也没有已保存的安装路径。请手动打开一次 ZCode 后再试。".into(),
        )
    })?;

    // 2. kill 全部同名进程
    kill_all_zcode();

    // 3. 等待进程退出（给系统一点时间释放文件锁）
    thread::sleep(Duration::from_millis(800));

    // 4. 重启
    spawn_zcode(&exe_path)
}

/// 更激进的热刷新：只结束 ZCode 的 `app-server --stdio` 子进程。
/// 如果后台服务没有自动恢复，只返回状态给前端，不自动重启 ZCode。
#[tauri::command]
pub fn refresh_zcode_app_server() -> R<RefreshZcodeAppServerReport> {
    let killed = kill_app_server_processes();
    if killed == 0 {
        return Ok(RefreshZcodeAppServerReport {
            killed,
            recovered: false,
            restarted: false,
        });
    }

    let recovered = wait_for_app_server(Duration::from_secs(5));
    if recovered {
        return Ok(RefreshZcodeAppServerReport {
            killed,
            recovered,
            restarted: false,
        });
    }

    Ok(RefreshZcodeAppServerReport {
        killed,
        recovered: false,
        restarted: false,
    })
}

fn settings_file() -> R<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| AppError::Msg("找不到用户主目录".into()))?;
    Ok(home
        .join(".zcode")
        .join("v2")
        .join("zcode-switcher-settings.json"))
}

fn load_settings() -> RestartSettings {
    let Ok(path) = settings_file() else {
        return RestartSettings::default();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return RestartSettings::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_settings(settings: &RestartSettings) -> R<()> {
    let path = settings_file()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_vec_pretty(settings)?;
    fs::write(path, data)?;
    Ok(())
}

fn save_known_path(exe_path: &str) -> R<()> {
    let mut settings = load_settings();
    settings.zcode_exe_path = Some(exe_path.to_string());
    save_settings(&settings)
}

fn load_known_path() -> Option<String> {
    let path = load_settings().zcode_exe_path?;
    if path.trim().is_empty() {
        return None;
    }
    if !std::path::Path::new(&path).exists() {
        return None;
    }
    Some(path)
}

/// 查找运行中的 ZCode 主进程 exe 路径（最先枚举到的那条，通常是主进程）。
fn find_main_path() -> Option<String> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_exe(UpdateKind::Always),
    );

    for (_pid, proc_) in sys.processes() {
        let name = proc_.name().to_string_lossy().to_string();
        if PROC_NAMES.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
            if let Some(path) = proc_.exe().and_then(|p| p.to_str()) {
                if !path.is_empty() {
                    return Some(path.to_string());
                }
            }
        }
    }
    None
}

fn is_zcode_process_name(name: &str) -> bool {
    PROC_NAMES.iter().any(|n| n.eq_ignore_ascii_case(name))
}

fn is_app_server_process(proc_: &sysinfo::Process) -> bool {
    let name = proc_.name().to_string_lossy().to_string();
    if !is_zcode_process_name(&name) {
        return false;
    }
    let cmd = proc_
        .cmd()
        .iter()
        .map(|s| s.to_string_lossy().to_string())
        .collect::<Vec<_>>();
    cmd.iter().any(|arg| arg == "app-server")
        && cmd.iter().any(|arg| arg == "--stdio")
        && cmd.iter().any(|arg| arg.contains("zcode.cjs"))
}

fn kill_process(proc_: &sysinfo::Process) {
    // 先尝试温和终止，失败则强制 kill（kill_with 返回 None 表示信号不支持）
    if proc_.kill_with(Signal::Term).is_none() {
        let _ = proc_.kill();
    }
}

fn kill_app_server_processes() -> usize {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_cmd(UpdateKind::Always),
    );

    let pids: Vec<_> = sys
        .processes()
        .iter()
        .filter(|(_, p)| is_app_server_process(p))
        .map(|(pid, _)| *pid)
        .collect();

    let killed = pids.len();
    for pid in pids {
        if let Some(proc_) = sys.process(pid) {
            kill_process(proc_);
        }
    }
    killed
}

fn count_app_server_processes() -> usize {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_cmd(UpdateKind::Always),
    );

    sys.processes()
        .iter()
        .filter(|(_, p)| is_app_server_process(p))
        .count()
}

fn wait_for_app_server(timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        thread::sleep(Duration::from_millis(500));
        if count_app_server_processes() > 0 {
            return true;
        }
    }
    false
}

/// kill 所有 ZCode 相关进程。
fn kill_all_zcode() {
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::new());

    let pids: Vec<_> = sys
        .processes()
        .iter()
        .filter(|(_, p)| {
            let name = p.name().to_string_lossy().to_string();
            is_zcode_process_name(&name)
        })
        .map(|(pid, _)| *pid)
        .collect();

    for pid in pids {
        if let Some(proc_) = sys.process(pid) {
            kill_process(proc_);
        }
    }
}

/// 用给定路径拉起 ZCode（独立进程，不阻塞）。
fn spawn_zcode(exe_path: &str) -> R<()> {
    use std::process::Command;

    Command::new(exe_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| AppError::Msg(format!("重启 ZCode 失败：{}", e)))?;
    Ok(())
}
