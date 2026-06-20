//! ZCode 启动快捷方式管理：为 ZCode.exe 的 .lnk 快捷方式追加
//! `--remote-debugging-port=9229` 参数，让我们能通过 CDP 远程触发"刷新"
//! 而无需杀进程或等待轮询。
//!
//! 设计：
//! - 扫描桌面 / 开始菜单 / 任务栏固定项三处常见快捷方式位置。
//! - 用 Win32 IShellLinkW + IPersistFile 读写 .lnk。
//! - 把修改前的 Arguments 备份到 settings 文件中以便一键还原。
//! - 仅匹配 target 文件名为 ZCode.exe 的 .lnk，避免误改其他程序。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::profile::AppError;

type R<T> = std::result::Result<T, AppError>;

pub const REMOTE_DEBUGGING_FLAG: &str = "--remote-debugging-port=9229";

#[derive(Debug, Clone, Serialize)]
pub struct ShortcutInfo {
    pub path: String,
    pub target: String,
    pub arguments: String,
    pub has_flag: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct LauncherBackup {
    /// 快捷方式路径 → 修改前的原 arguments（用于还原）
    #[serde(default)]
    original_args: std::collections::HashMap<String, String>,
}

fn backup_file() -> R<PathBuf> {
    // 与 ZCode 数据目录保持一致（env-aware：ZCODE_DATA_BASE_DIR / HOME / homedir）
    Ok(crate::profile::zcode_v2_dir()?.join("zcode-switcher-launcher-backup.json"))
}

fn load_backup() -> LauncherBackup {
    let Ok(path) = backup_file() else {
        return LauncherBackup::default();
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return LauncherBackup::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save_backup(backup: &LauncherBackup) -> R<()> {
    let path = backup_file()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let data = serde_json::to_vec_pretty(backup)?;
    std::fs::write(path, data)?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn scan_zcode_shortcuts() -> R<Vec<ShortcutInfo>> {
    win::scan_zcode_shortcuts()
}

#[cfg(not(target_os = "windows"))]
pub fn scan_zcode_shortcuts() -> R<Vec<ShortcutInfo>> {
    Ok(vec![])
}

/// 返回第一个指向 ZCode.exe 且带 --remote-debugging-port=9229 参数的快捷方式（按 has_flag 优先）。
/// 给 restart_zcode 用：重启时优先走带 flag 的快捷方式，保住 CDP 端口。
pub fn find_preferred_shortcut() -> Option<ShortcutInfo> {
    let list = scan_zcode_shortcuts().unwrap_or_default();
    // 优先带 flag 的；没有再退到任意一个
    list.iter().find(|s| s.has_flag).cloned()
        .or_else(|| list.into_iter().next())
}

/// 给所有 ZCode 快捷方式追加 --remote-debugging-port=9229；返回 (修改数, 已有数, 总数)。
#[cfg(target_os = "windows")]
pub fn enable_remote_debug() -> R<(usize, usize, usize)> {
    win::enable_remote_debug()
}

#[cfg(not(target_os = "windows"))]
pub fn enable_remote_debug() -> R<(usize, usize, usize)> {
    Ok((0, 0, 0))
}

/// 还原所有曾修改过的快捷方式 arguments；返回还原数量。
#[cfg(target_os = "windows")]
pub fn disable_remote_debug() -> R<usize> {
    win::disable_remote_debug()
}

#[cfg(not(target_os = "windows"))]
pub fn disable_remote_debug() -> R<usize> {
    Ok(0)
}

#[cfg(target_os = "windows")]
mod win {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::{Path, PathBuf};
    use std::ptr;

    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::{BOOL, MAX_PATH};
    use windows::Win32::Storage::FileSystem::WIN32_FIND_DATAW;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    use super::{LauncherBackup, ShortcutInfo, REMOTE_DEBUGGING_FLAG};
    use super::{backup_file, load_backup, save_backup};
    use crate::profile::AppError;

    type R<T> = std::result::Result<T, AppError>;
    const ZCODE_EXE: &str = "ZCode.exe";

    fn ensure_com_init() {
        use std::sync::OnceLock;
        static INIT: OnceLock<()> = OnceLock::new();
        INIT.get_or_init(|| unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        });
    }

    fn to_wide(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn wide_to_string(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        std::ffi::OsString::from_wide(&buf[..end])
            .to_string_lossy()
            .into_owned()
    }

    /// 三处常见 .lnk 位置（用户级，不动系统级避免权限问题）。
    fn shortcut_search_dirs() -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join("Desktop"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
            dirs.push(
                appdata
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs"),
            );
            dirs.push(
                appdata
                    .join("Microsoft")
                    .join("Internet Explorer")
                    .join("Quick Launch")
                    .join("User Pinned")
                    .join("TaskBar"),
            );
        }
        if let Some(public) = std::env::var_os("PUBLIC").map(PathBuf::from) {
            dirs.push(public.join("Desktop"));
        }
        if let Some(programdata) = std::env::var_os("ProgramData").map(PathBuf::from) {
            dirs.push(
                programdata
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs"),
            );
        }
        dirs
    }

    /// 递归找一个目录下的所有 .lnk 文件（深度限制 3 层，避免误扫太深）。
    fn collect_lnk_files(root: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth == 0 || !root.is_dir() {
            return;
        }
        let Ok(entries) = std::fs::read_dir(root) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_lnk_files(&path, depth - 1, out);
            } else if path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("lnk"))
                .unwrap_or(false)
            {
                out.push(path);
            }
        }
    }

    /// 读取一个 .lnk 文件的 target + arguments。
    fn read_shortcut(lnk_path: &Path) -> windows::core::Result<(String, String)> {
        ensure_com_init();
        unsafe {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let persist: IPersistFile = link.cast()?;

            let lnk_wide = to_wide(&lnk_path.to_string_lossy());
            persist.Load(PCWSTR(lnk_wide.as_ptr()), STGM_READ)?;

            let mut target_buf = vec![0u16; MAX_PATH as usize];
            let pfd: *mut WIN32_FIND_DATAW = ptr::null_mut();
            link.GetPath(&mut target_buf, pfd, 0)?;
            let target = wide_to_string(&target_buf);

            let mut args_buf = vec![0u16; 1024];
            link.GetArguments(&mut args_buf)?;
            let args = wide_to_string(&args_buf);

            Ok((target, args))
        }
    }

    /// 写入一个 .lnk 文件的 arguments。
    fn write_shortcut_arguments(lnk_path: &Path, args: &str) -> windows::core::Result<()> {
        ensure_com_init();
        unsafe {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let persist: IPersistFile = link.cast()?;

            let lnk_wide = to_wide(&lnk_path.to_string_lossy());
            persist.Load(PCWSTR(lnk_wide.as_ptr()), STGM(0))?; // 读写模式

            let args_wide = to_wide(args);
            link.SetArguments(PCWSTR(args_wide.as_ptr()))?;

            persist.Save(PCWSTR(lnk_wide.as_ptr()), BOOL(1))?;
            Ok(())
        }
    }

    fn is_zcode_target(target: &str) -> bool {
        let lower = target.to_lowercase();
        // 严格匹配文件名为 ZCode.exe，不匹配 ZCode Switcher.exe 等
        let base = Path::new(&lower)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        base.eq_ignore_ascii_case(ZCODE_EXE)
    }

    fn ensure_flag(args: &str) -> (String, bool) {
        if args
            .split_whitespace()
            .any(|tok| tok.eq_ignore_ascii_case(REMOTE_DEBUGGING_FLAG))
        {
            return (args.to_string(), true);
        }
        let trimmed = args.trim();
        let new_args = if trimmed.is_empty() {
            REMOTE_DEBUGGING_FLAG.to_string()
        } else {
            format!("{} {}", trimmed, REMOTE_DEBUGGING_FLAG)
        };
        (new_args, false)
    }

    pub fn scan_zcode_shortcuts() -> R<Vec<ShortcutInfo>> {
        let mut lnks = Vec::new();
        for dir in shortcut_search_dirs() {
            collect_lnk_files(&dir, 3, &mut lnks);
        }

        let mut results = Vec::new();
        for lnk in lnks {
            let Ok((target, args)) = read_shortcut(&lnk) else {
                continue;
            };
            if !is_zcode_target(&target) {
                continue;
            }
            let has_flag = args
                .split_whitespace()
                .any(|tok| tok.eq_ignore_ascii_case(REMOTE_DEBUGGING_FLAG));
            results.push(ShortcutInfo {
                path: lnk.to_string_lossy().into_owned(),
                target,
                arguments: args,
                has_flag,
            });
        }
        Ok(results)
    }

    pub fn enable_remote_debug() -> R<(usize, usize, usize)> {
        let shortcuts = scan_zcode_shortcuts()?;
        let total = shortcuts.len();
        if total == 0 {
            return Ok((0, 0, 0));
        }
        let mut backup = load_backup();
        let mut modified = 0usize;
        let mut already = 0usize;
        for sc in &shortcuts {
            if sc.has_flag {
                already += 1;
                continue;
            }
            let (new_args, _) = ensure_flag(&sc.arguments);
            // 备份原 arguments（如果之前没备份过）
            backup
                .original_args
                .entry(sc.path.clone())
                .or_insert_with(|| sc.arguments.clone());
            if write_shortcut_arguments(Path::new(&sc.path), &new_args).is_ok() {
                modified += 1;
            }
        }
        let _ = save_backup(&backup);
        let _ = backup_file();
        Ok((modified, already, total))
    }

    pub fn disable_remote_debug() -> R<usize> {
        let backup = load_backup();
        if backup.original_args.is_empty() {
            // 没有备份记录时，也扫描一遍把当前带 flag 的快捷方式 flag 拿掉
            let shortcuts = scan_zcode_shortcuts()?;
            let mut restored = 0usize;
            for sc in shortcuts {
                if !sc.has_flag {
                    continue;
                }
                let cleaned = sc
                    .arguments
                    .split_whitespace()
                    .filter(|tok| !tok.eq_ignore_ascii_case(REMOTE_DEBUGGING_FLAG))
                    .collect::<Vec<_>>()
                    .join(" ");
                if write_shortcut_arguments(Path::new(&sc.path), &cleaned).is_ok() {
                    restored += 1;
                }
            }
            return Ok(restored);
        }

        let mut restored = 0usize;
        let mut new_backup = LauncherBackup::default();
        for (path, original) in &backup.original_args {
            if write_shortcut_arguments(Path::new(path), original).is_ok() {
                restored += 1;
            } else {
                // 还原失败的保留在备份里，下次再试
                new_backup
                    .original_args
                    .insert(path.clone(), original.clone());
            }
        }
        let _ = save_backup(&new_backup);
        Ok(restored)
    }
}
