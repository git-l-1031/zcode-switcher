## 2026-06-17 - Task: Use email as the only account identity
### What was done
- Unified account matching around email for active-account detection, current-status matching, save-current behavior, import validation, and delete-current protection.
- Saving current credentials now requires a readable email and updates the existing profile for that email instead of creating a duplicate.
- New profile ids now derive from the normalized email hash instead of user id or credential hash.
- Added a short account identity document for future maintenance.
### Testing
- Passed: `cargo check` in `src-tauri`.
- Passed: `cargo fmt` in `src-tauri`.
- Not completed: `npm run build` failed before TypeScript/Vite ran because Node could not `lstat 'C:\Users\Sunset'` inside the sandbox (`EPERM`). A privilege escalation retry was requested but not approved by the approval service.
### Notes
- `src-tauri/src/profile.rs`：changed account identity matching, current profile detection, save-current update behavior, import validation, and delete-current protection to use email.
- `docs/account-identity.md`：documented that email is the only stable account identity and `cred_hash` only records a credential version.
- Rollback: revert this task by restoring `src-tauri/src/profile.rs` to its previous hash/user-id based behavior and deleting `docs/account-identity.md`; this entry marks the rollback point.

## 2026-06-18 - Task: Support phone identity and rounded app icons
### What was done
- Extended account identity matching from email-only to email-first with phone-number fallback.
- Added phone fields to profile data, portable export/import data, current status, and frontend display.
- Updated account identity documentation to describe email-or-phone matching.
- Applied rounded-corner masks to app logo PNG assets and regenerated `icon.ico` / `icon.icns` from the rounded source.
### Testing
- Passed: `cargo check` in `src-tauri`.
- Passed: `cargo fmt` in `src-tauri`.
- Passed: sampled rounded PNG icon corners have transparent alpha.
- Not completed: `npm run build` and `npx tsc --noEmit` both failed before TypeScript/Vite ran because Node could not `lstat 'C:\Users\Sunset'` inside the sandbox (`EPERM`).
### Notes
- `src-tauri/src/crypto.rs`：added compatible phone/mobile fields when parsing decrypted ZCode user info.
- `src-tauri/src/profile.rs`：changed account identity matching, save/import/export/current-status/delete protection, and generated profile ids to use email first and phone number as fallback.
- `src/lib/api.ts`：added phone fields to frontend API types.
- `src/App.tsx`：uses current phone as a fallback default account name.
- `src/components/AccountCard.tsx`：shows phone-number identities when email is unavailable.
- `src/components/Modal.tsx`：shows phone-number identities in batch export selection.
- `docs/account-identity.md`：updated identity rules from email-only to email-or-phone.
- `src/assets/zcode-logo.png`：rounded the in-app logo asset.
- `src-tauri/icons/*`：rounded generated app icon assets and regenerated `icon.ico` / `icon.icns`.
- Rollback: restore the files listed above from the previous revision; for icons, restore the pre-rounded icon assets from backup/source control or regenerate from the original square source.

## 2026-06-18 - Task: Build and copy latest EXE to Desktop
### What was done
- Built the updated Tauri application through the release executable stage.
- Copied the latest release executable to the desktop as `zcode-switcher-latest.exe` because the existing desktop `zcode-switcher.exe` was in use and could not be overwritten.
### Testing
- Passed: frontend production build completed as part of `npm run tauri build`.
- Passed: Rust release build completed and produced `src-tauri/target/release/zcode-switcher.exe`.
- Passed: desktop copy exists at `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe` with matching size.
- Not completed: MSI bundling failed at the WiX `light.exe` stage after the exe had already been built.
### Notes
- `dist/`：regenerated frontend production assets during Tauri build.
- `src-tauri/target/release/zcode-switcher.exe`：latest release executable generated from the current source.
- `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe`：desktop copy of the latest executable for manual inspection.
- Rollback: delete `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe`; rebuild artifacts can be regenerated or removed with a clean build process.

## 2026-06-18 - Task: Add no-restart switch test
### 本次说明
- 在设置中增加了“优先尝试不重启切换”的开关。
- 切换账号时，如果开启该开关，程序会先只替换本地登录态并提示用户先观察结果，不主动重启 ZCode。
- 保留原有自动重启开关，方便用户在免重启失败时继续使用原流程。
### Testing
- Passed: `cargo fmt` in `src-tauri`.
- Passed: `cargo check` in `src-tauri`.
- Not completed: `npm run build` failed inside the sandbox because Node could not `lstat 'C:\Users\Sunset'` (`EPERM`).
- Not completed: escalation retry for `npm run build` was rejected by the approval service.
### 备注
- `src/store.ts`：新增免重启切换设置并接入切换流程。
- `src/components/SettingsPanel.tsx`：新增设置开关和说明文案。
- `docs/account-identity.md`：补充切换行为说明。
- `src-tauri/src/profile.rs`、`src-tauri/src/crypto.rs`、`src/lib/api.ts`、`src/App.tsx`、`src/components/AccountCard.tsx`、`src/components/Modal.tsx`：本轮未改动。
- 回滚：删除本次新增的免重启设置相关代码，并将设置面板恢复到原有“自动重启”单一策略。

## 2026-06-18 - Task: Rebuild latest EXE for desktop review
### 本次说明
- 使用当前源码重新构建了 release 版可执行文件。
- 已把最新可执行文件复制到桌面：`C:\Users\Sunset\Desktop\zcode-switcher-latest.exe`。
### Testing
- Passed: `npm run build` 在 Tauri 构建流程中完成。
- Passed: Rust release 构建完成并生成 `src-tauri/target/release/zcode-switcher.exe`。
- Passed: 桌面文件 `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe` 存在，时间为本次构建时间。
- Not completed: MSI 安装包仍在 WiX `light.exe` 阶段失败；本次交付的是可直接运行的 exe。
### 备注
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/zcode-switcher.exe`：重新生成 release 可执行文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe`：桌面检查用最新可执行文件。
- 回滚：删除桌面的 `zcode-switcher-latest.exe`；构建产物可通过重新构建恢复。

## 2026-06-18 - 记录格式调整
### 本次说明
- 后续新增的 `progress.md` 记录统一改用中文。
- 既有历史记录保持不改，避免破坏追加式日志规范。
### 备注
- 以后如果需要继续记录进展，我会直接用中文写 `What was done`、`Testing` 和 `Notes` 对应内容。

## 2026-06-18 - 任务：探索更激进的切换账号方案
### 本次说明
- 读取并分析了 ZCode 本体的打包代码，确认它会单独拉起 `app-server --stdio` 子进程。
- 把“实验性免重启切换”升级为“切换后刷新 ZCode 后台服务”，不再只是写入凭据文件。
- 恢复了被误写成 ZCode 本体信息的 `package.json`，避免后续构建再次跑偏。
- 重新构建了 release 版可执行文件，并复制到桌面供检查。
### Testing
- Passed: `cargo fmt` in `src-tauri`.
- Passed: `cargo check` in `src-tauri`.
- Passed: `npm run build`.
- Passed: `cargo build --release`.
- Passed: 桌面存在最新文件 `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe`。
### Notes
- `src-tauri/src/restart.rs`：新增 `refresh_zcode_app_server`，只结束 ZCode 的 `app-server --stdio` 子进程。
- `src-tauri/src/lib.rs`：注册新的后端命令。
- `src/lib/api.ts`：增加前端调用接口。
- `src/store.ts`：切换账号时，实验性模式改为刷新后台服务。
- `src/components/SettingsPanel.tsx`：更新免重启说明文案。
- `docs/account-identity.md`：补充后台刷新行为说明。
- `package.json`：恢复切换器项目的正确配置。
- `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe`：本轮最新可执行文件。
- 回滚：删除本轮新增的后台刷新命令和前端调用，再把 `package.json` 恢复为本次修改前的版本即可；桌面 exe 可直接删除后重新构建。

## 2026-06-18 - 任务：启动异常兜底与右键菜单处理
### 本次说明
- 给 ZCode 后台服务刷新增加了兜底逻辑：先尝试只刷新 `app-server --stdio`，短时间内没恢复就自动重启 ZCode，避免用户卡在 `localhost` 拒绝连接页。
- 在主界面增加了网络/本地服务异常提示条，软件仍可正常进入，不再被异常页面挡住。
- 全局拦截了右键菜单，取消软件内右键弹出的系统菜单。
- 重新构建了 release 版可执行文件，并另存到桌面供检查。
### Testing
- Passed: `cargo fmt` in `src-tauri`.
- Passed: `cargo check` in `src-tauri`.
- Passed: `npm run build`.
- Passed: `cargo build --release`.
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-latest-20260618-030446.exe` 存在。
- Not completed: 旧的 `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe` 被占用，未能覆盖。
### Notes
- `src-tauri/src/restart.rs`：增加后台服务恢复检测与自动重启兜底。
- `src/lib/api.ts`：调整刷新后台服务接口返回结构。
- `src/store.ts`：切换后根据后台恢复结果给出对应提示。
- `src/main.tsx`：全局禁用右键菜单。
- `src/App.tsx`：增加网络/本地服务异常提示条。
- `docs/account-identity.md`：同步更新切换行为说明。
- `C:\Users\Sunset\Desktop\zcode-switcher-latest-20260618-030446.exe`：本轮桌面检查用最新 exe。
- 回滚：删除本轮新增的兜底与提示逻辑，恢复 `src/main.tsx` 的右键默认行为；桌面新增 exe 可直接删除，旧文件若需覆盖需先关闭占用它的进程。

## 2026-06-18 - 任务：修正桌面版启动入口
### 本次说明
- 发现之前复制到桌面的可执行文件是通过 `cargo build --release` 产出的，仍会保留开发入口，导致启动后继续指向 `localhost:1420`。
- 改用 Tauri 正式打包流程重新生成了 release 可执行文件，避免桌面版再走开发服务入口。
- 重新生成后的可执行文件已另存到桌面，供你直接检查。
### Testing
- Passed: `npm run tauri build -- --no-bundle` 成功完成 Tauri 正式构建流程。
- Passed: 新的 release exe 存在于 `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-031630.exe`。
- Passed: 启动新 exe 后，系统中可见对应进程 `zcode-switcher-release-20260618-031630.exe` 正常拉起。
- Not completed: 旧桌面文件 `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe` 仍被占用，未覆盖。
### Notes
- `src-tauri/target/release/zcode-switcher.exe`：这次正式打包生成的 release 程序。
- `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-031630.exe`：本次给你检查的新桌面文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-latest.exe`：旧桌面文件，当前被占用，未改动。
- 回滚：删除桌面的新 exe；如需回到旧流程，可重新用 `cargo build --release` 或恢复上一次桌面文件。

## 2026-06-18 - Task: 切换账号时同步 ZCode start-plan 配置
### What was done
- 切换账号时除了替换 `credentials.json`，还会从目标账号凭据中解出 `zcodejwttoken`，同步写入 `config.json` 的 `builtin:zai-start-plan.options.apiKey`。
- 写入 `config.json` 前会在 `account-backups` 目录备份当前配置，便于切换异常时回滚。
- 保守保留其他 provider 配置，不覆盖 `builtin:zai-coding-plan` 等非 JWT 形态的 apiKey。
- 已更新账号身份与切换行为说明文档，并重新生成桌面检查用 exe。
### Testing
- Passed: `cargo fmt` in `src-tauri`.
- Passed: `cargo check` in `src-tauri`，仅保留既有 `UserInfo.user_id` 未使用警告。
- Passed: `npm run build`.
- Partial: `npm run tauri build -- --no-bundle` 已生成 release exe，但仍在 WiX `light.exe` 打包 MSI 阶段失败。
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-062317.exe` 存在，时间为本次构建时间。
### Notes
- `src-tauri/src/profile.rs`：切换账号时准备并写入 Z.ai start-plan 的配置同步，增加 config 备份与异常回滚处理。
- `docs/account-identity.md`：补充切换时同步 `config.json` 与不自动重启的说明。
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/zcode-switcher.exe`：重新生成 release 可执行文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-062317.exe`：本轮桌面检查用最新 exe。
- 回滚：用本次切换前生成的 `account-backups/config.switch.*.json` 和 `credentials.switch.*.json` 覆盖回 `~/.zcode/v2/config.json`、`~/.zcode/v2/credentials.json`；代码侧可移除 `profile.rs` 中本轮新增的 config 同步函数与调用，文档恢复对应段落。

## 2026-06-18 - Task: 无感切换文案、GLM-5.2 自动切换与额度显示修复
### What was done
- 把设置中的“实验性免重启切换”改为“无感切换”，并同步主界面提示文案。
- 新增 GLM-5.2 低额度自动切换设置：当前账号低于配置阈值时，自动切到 GLM-5.2 剩余额度大于 150 万的账号。
- 修复额度刷新后部分进度条消失的问题：余额接口失败或返回空明细时不再伪装为成功；前端有旧额度时会保留上次进度条并提示本次刷新失败。
- 更新说明文档，并重新生成桌面检查用 exe。
### Testing
- Passed: 使用本地账号档案做脱敏额度诊断，确认账号接口返回 GLM-5.2 与 GLM-5-Turbo 两条余额明细。
- Passed: `cargo fmt` in `src-tauri`.
- Passed: `cargo check` in `src-tauri`，仅保留既有 `UserInfo.user_id` 未使用警告。
- Passed: `npm run build`.
- Partial: `npm run tauri build -- --no-bundle` 已生成 release exe，但仍在 WiX `light.exe` 打包 MSI 阶段失败。
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-065503.exe` 存在，时间为本次构建时间。
### Notes
- `src/store.ts`：新增 GLM-5.2 自动切换配置、阈值持久化、刷新后自动切换判断，并在额度刷新失败时保留旧额度。
- `src/components/SettingsPanel.tsx`：设置项改为无感切换，并新增 GLM-5.2 自动切换开关和阈值输入。
- `src/components/AccountCard.tsx`：刷新失败但存在旧额度时继续显示进度条，并提示保留上次额度。
- `src/App.tsx`：同步底部无感切换提示文案。
- `src-tauri/src/quota.rs`：余额接口失败或返回空明细时返回错误，避免前端被空数据覆盖。
- `docs/account-identity.md`：补充额度刷新保留策略和 GLM-5.2 自动切换规则。
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/zcode-switcher.exe`：重新生成 release 可执行文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-065503.exe`：本轮桌面检查用最新 exe。
- 回滚：移除 `store.ts` 中 GLM-5.2 自动切换与保留旧额度逻辑，恢复设置面板和文案；`quota.rs` 可恢复为余额失败返回空列表的旧行为；桌面新增 exe 可直接删除。

## 2026-06-18 - Task: 额度刷新节奏、无感切换互斥与版本显示调整
### What was done
- 将账号额度全量刷新改为按账号列表顺序执行，每批最多刷新 3 个账号，避免一次性并发刷新全部账号。
- 将 GLM-5.2 低额度自动切换阈值默认值调整为 35 万；开启低额度自动切换后，当前使用账号会额外每 1 分钟刷新一次并触发自动切换判断，不影响其他账号的定时刷新频率。
- 移除了设置页里的“立即重启 ZCode”和“打开时自动刷新额度”入口；打开或刷新软件时自动刷新额度成为默认逻辑。
- 新增额度本地缓存，刷新到的最新额度会即时保留，关闭并重新打开软件时可先显示上次额度。
- 修复无感切换开启后仍能手动开启“自动重启 ZCode”的问题，并修正关于区图标与版本号对齐；版本统一更新为 `v 1.0.1` / `1.0.1`。
- 更新说明文档，并重新生成桌面检查用 exe。
### Testing
- Passed: `npm run build`。
- Passed: `cargo fmt` in `src-tauri`。
- Passed: `cargo check` in `src-tauri`，仅保留既有 `UserInfo.user_id` 未使用警告。
- Partial: `npm run tauri build -- --no-bundle` 已生成 release exe，但仍在 WiX `light.exe` 打包 MSI 阶段失败。
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-073208.exe` 存在，大小为 13,148,160 字节。
### Notes
- `src/store.ts`：调整额度默认刷新逻辑、批量刷新节奏、GLM-5.2 默认阈值、当前账号 1 分钟自动检查、额度缓存持久化，以及无感切换与自动重启互斥保护。
- `src/App.tsx`：开启 GLM-5.2 低额度自动切换时，增加只刷新当前账号的一分钟定时器。
- `src/components/SettingsPanel.tsx`：移除截图中的两个设置入口，禁用互斥状态下的自动重启开关，并调整版本显示和行内对齐。
- `docs/account-identity.md`：补充默认自动刷新、三账号批次刷新、额度缓存和低额度自动切换刷新频率说明。
- `docs/account-identity.md`：同步说明无感切换与自动重启互斥，并移除旧的设置内手动重启入口描述。
- `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`：同步应用版本为 `1.0.1`。
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/zcode-switcher.exe`：重新生成 release 可执行文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-073208.exe`：本轮桌面检查用最新 exe。
- 回滚：恢复 `store.ts` 中本轮新增的缓存、批次刷新、当前账号自动检查和互斥保护逻辑；恢复 `SettingsPanel.tsx` 中被移除的两个入口及旧版本号；恢复版本号相关配置到上一版本；桌面新增 exe 可直接删除。

## 2026-06-18 - Task: 设置提示补充与中英俄语言切换
### What was done
- 在 GLM-5.2 低额度自动切换说明中明确提示：开启后仅当前账号每 1 分钟刷新一次，不影响其他账号。
- 将右上角原“当前登录”区域改为中文、英文、俄文三段语言切换器，并把当前登录状态移到账号数量旁边继续显示。
- 新增界面语言持久化，选择语言后下次打开仍会保留。
- 将主界面、账号卡片、空状态、设置页、常用弹窗和主要提示文案接入中英俄三套文本。
- 更新说明文档，并重新生成桌面检查用 exe。
### Testing
- Passed: `npm run build`。
- Passed: `cargo fmt` in `src-tauri`。
- Passed: `cargo check` in `src-tauri`，仅保留既有 `UserInfo.user_id` 未使用警告。
- Partial: `npm run tauri build -- --no-bundle` 已生成 release exe，但仍在 WiX `light.exe` 打包 MSI 阶段失败。
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-080306.exe` 存在，大小为 13,156,352 字节。
### Notes
- `src/i18n.ts`：新增中英俄语言文本表、语言列表和模板替换工具。
- `src/store.ts`：新增语言状态持久化，并让主要 toast 提示跟随当前语言。
- `src/App.tsx`：右上角改为语言切换器，当前登录状态移到工具栏，并接入中英俄界面文本。
- `src/components/SettingsPanel.tsx`：设置页文案接入语言文本，并补充低额度自动切换的一分钟当前账号刷新提示。
- `src/components/AccountCard.tsx`：账号卡片按钮、状态、额度错误提示接入语言文本。
- `src/components/EmptyState.tsx`：空状态接入语言文本。
- `src/components/Modal.tsx`：保存、确认、批量导出弹窗接入语言文本。
- `docs/account-identity.md`：补充语言切换入口与当前登录状态位置说明，并记录低额度自动切换提示已展示。
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/zcode-switcher.exe`：重新生成 release 可执行文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-080306.exe`：本轮桌面检查用最新 exe。
- 回滚：移除 `src/i18n.ts` 与各组件中的语言文本接入，恢复右上角当前登录状态显示；恢复 `SettingsPanel.tsx` 中 GLM-5.2 低额度自动切换旧说明；桌面新增 exe 可直接删除。

## 2026-06-18 - Task: 简化低额度提示与保存按钮字体适配
### What was done
- 将 GLM-5.2 低额度自动切换说明简化为“剩余额度低于阈值时，自动切到一个剩余大于 150 万的账号。开启后当前账号每 1 分钟刷新一次额度。”并同步英文、俄文文案。
- 保存当前账号按钮在英文、俄文等长文本下会自动缩小按钮内文字字号，减少显示不全。
- 重新生成桌面检查用 exe。
### Testing
- Passed: `npm run build`。
- Passed: `cargo fmt` in `src-tauri`。
- Passed: `cargo check` in `src-tauri`，仅保留既有 `UserInfo.user_id` 未使用警告。
- Partial: `npm run tauri build -- --no-bundle` 已生成 release exe，但仍在 WiX `light.exe` 打包 MSI 阶段失败。
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-081822.exe` 存在，大小为 13,156,352 字节。
### Notes
- `src/i18n.ts`：简化 GLM-5.2 低额度自动切换说明的中英俄文案。
- `src/App.tsx`：保存当前账号按钮根据文本长度动态缩小内部文字字号。
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/zcode-switcher.exe`：重新生成 release 可执行文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-081822.exe`：本轮桌面检查用最新 exe。
- 回滚：恢复 `src/i18n.ts` 中上一版 GLM-5.2 自动切换说明；移除 `src/App.tsx` 中保存按钮文字动态字号逻辑；桌面新增 exe 可直接删除。

## 2026-06-18 - Task: 修改 GLM-5.2 切换阈值提示
### What was done
- 将 GLM-5.2 切换阈值说明改为“开启GLM-5.2 低额度自动切换生效”，并同步英文、俄文文案。
### Testing
- Passed: `npm run build`。
- Passed: `cargo fmt` in `src-tauri`。
- Passed: `cargo check` in `src-tauri`，仅保留既有 `UserInfo.user_id` 未使用警告。
- Partial: `npm run tauri build -- --no-bundle` 已生成 release exe，但仍在 WiX `light.exe` 打包 MSI 阶段失败。
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-083630.exe` 存在，大小为 13,156,352 字节。
### Notes
- `src/i18n.ts`：更新 GLM-5.2 切换阈值说明文案。
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/zcode-switcher.exe`：重新生成 release 可执行文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-release-20260618-083630.exe`：本轮桌面检查用最新 exe。
- 回滚：恢复 `src/i18n.ts` 中上一版 `glmThresholdDesc` 文案，并重新运行 `npm run build`；桌面新增 exe 可直接删除。

## 2026-06-18 - Task: 生成正式安装包
### What was done
- 将 Windows 打包目标调整为 NSIS 安装器，避免继续走此前失败的 WiX/MSI 打包路径。
- 重新执行正式 Tauri 构建，生成可安装、可卸载的 Windows 安装包。
- 将最新安装包复制到桌面，方便直接检查和发布。
### Testing
- Passed: `npm run tauri build` 完整通过。
- Passed: 构建生成 `src-tauri/target/release/bundle/nsis/ZCode 账号切换器_1.0.1_x64-setup.exe`，大小为 3,411,768 字节。
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-installer-20260618-092156.exe` 存在，大小为 3,411,768 字节。
- Note: Rust 构建仍保留既有 `UserInfo.user_id` 未使用警告，不影响安装包生成。
### Notes
- `src-tauri/tauri.conf.json`：将 `bundle.targets` 从 `all` 调整为 `["nsis"]`，后续默认生成 NSIS 正式安装包。
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/zcode-switcher.exe`：重新生成 release 可执行文件。
- `src-tauri/target/release/bundle/nsis/ZCode 账号切换器_1.0.1_x64-setup.exe`：本轮生成的正式安装包。
- `C:\Users\Sunset\Desktop\zcode-switcher-installer-20260618-092156.exe`：本轮桌面检查用正式安装包。
- 回滚：将 `src-tauri/tauri.conf.json` 中 `bundle.targets` 恢复为 `"all"`；桌面新增安装包可直接删除。

## 2026-06-18 - Task: 添加应用内检测更新与发布配置
### What was done
- 在设置页版本号右侧添加“检测更新”按钮。
- 检测到 GitHub Release 新版本时，软件会在应用内提示下载并安装，不打开发布页；安装完成后自动重启应用。
- 接入 Tauri updater 与 process 插件，配置 GitHub Releases 更新源、公钥、NSIS 更新包签名产物。
- 新增 GitHub Actions 发布流水线，用于按版本标签自动生成 Release、安装包和 updater 文件。
- 生成 updater 签名密钥，私钥保存在仓库外的桌面路径，未提交到仓库。
- 重新生成正式安装包并复制到桌面。
### Testing
- Passed: `npm run build`。
- Passed: `cargo fmt` in `src-tauri`。
- Passed: `cargo check` in `src-tauri`，仅保留既有 `UserInfo.user_id` 未使用警告；首次依赖下载遇到 TLS 握手失败，使用 Cargo 网络重试参数后通过。
- Passed: `npm run tauri build` 在提供 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 后完整通过。
- Passed: 构建生成 `src-tauri/target/release/bundle/nsis/ZCode 账号切换器_1.0.1_x64-setup.exe` 和对应 `.sig` 签名文件。
- Passed: 桌面新文件 `C:\Users\Sunset\Desktop\zcode-switcher-installer-20260618-102249.exe` 存在，大小为 3,699,110 字节。
### Notes
- `src/components/SettingsPanel.tsx`：版本号右侧新增检测更新按钮，接入更新检查、确认下载、下载安装进度提示和安装后重启。
- `src/i18n.ts`：新增中英俄更新相关文案。
- `src-tauri/tauri.conf.json`：启用 updater artifacts，配置 GitHub 更新源、公钥和 Windows passive 安装模式。
- `src-tauri/src/lib.rs`：注册 updater 与 process 插件。
- `src-tauri/capabilities/default.json`：新增 updater 和重启进程权限。
- `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`：新增 updater/process Rust 插件依赖。
- `package.json`、`package-lock.json`：新增 updater/process 前端依赖。
- `.github/workflows/release.yml`：新增 GitHub Release 构建发布流水线。
- `docs/account-identity.md`：补充设置页应用内更新行为。
- `docs/release.md`：新增发布、updater 私钥和 GitHub Secrets 说明。
- `dist/`：重新生成前端生产资源。
- `src-tauri/target/release/bundle/nsis/ZCode 账号切换器_1.0.1_x64-setup.exe`：本轮生成的正式安装包。
- `src-tauri/target/release/bundle/nsis/ZCode 账号切换器_1.0.1_x64-setup.exe.sig`：本轮生成的 updater 签名文件。
- `C:\Users\Sunset\Desktop\zcode-switcher-installer-20260618-102249.exe`：本轮桌面检查用正式安装包。
- `C:\Users\Sunset\Desktop\zcode-switcher-updater.key`：本机 updater 私钥，不提交仓库；需作为 GitHub Secret 保存。
- `C:\Users\Sunset\Desktop\zcode-switcher-updater.key.pub`：本机 updater 公钥备份。
- 回滚：移除设置页更新按钮与 updater/process 插件调用；删除 `tauri.conf.json` 中 updater 配置和 `createUpdaterArtifacts`；移除新增依赖、发布流水线和 `docs/release.md`；桌面新增安装包和密钥文件可按需删除。
