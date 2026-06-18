# ZCode Switcher

ZCode 账号管理与切换桌面工具，支持额度显示和无感切换。

## 主要功能

- 本地保存并管理多个 ZCode 账号。
- 支持无感切换账号，减少切换后手动重启 ZCode 的频率。
- 显示账号额度信息，并在关闭软件后保留最近一次额度数据。
- 支持 GLM-5.2 低额度自动切换。
- 支持中文、英文、俄文界面。
- 支持在软件内检测更新、下载并安装 GitHub Releases 中的签名版本。

## 下载

请到 GitHub Releases 下载最新版 Windows 安装包：

https://github.com/git-l-1031/zcode-switcher/releases

## 开发

安装依赖：

```powershell
npm install
```

启动开发模式：

```powershell
npm run tauri dev
```

构建前端：

```powershell
npm run build
```

构建 Windows 安装包：

```powershell
npm run tauri build
```

## 发布

发布构建由 GitHub Actions 处理。推送 `v*` 版本标签后，会自动创建 Release 并上传安装包。应用内更新签名与发布说明见 `docs/release.md`。

## 免责声明

本工具是第三方辅助工具，与 ZCode / Z.ai 官方无关。
