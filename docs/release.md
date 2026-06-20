# 发布说明

## 应用内更新

- 软件会从 GitHub Releases 检查更新：
  `https://github.com/git-l-1031/zcode-switcher/releases/latest/download/latest.json`
- 更新验签公钥保存在 `src-tauri/tauri.conf.json`。
- 更新签名私钥不能提交到仓库。
- 请把更新签名私钥保存在本机安全位置，并把私钥全文写入 GitHub Actions Secrets。
- Release 中必须包含 `latest.json`。如果这个文件缺失，软件内检测更新会失败。
- GitHub Actions 已显式开启 `includeUpdaterJson`，并优先使用 Windows NSIS 安装包生成更新清单。

## GitHub Secrets

发布前需要在仓库的 Actions Secrets 中配置：

- `TAURI_SIGNING_PRIVATE_KEY`：更新签名私钥全文
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成更新签名密钥时使用的密码

## 发布版本

创建并推送版本标签：

```powershell
git tag v1.1.4
git push origin v1.1.4
```

GitHub Actions 会自动创建 Release，并上传安装包和应用内更新所需的签名文件。Release 说明会优先读取 `docs/changelog.md` 中对应版本的小节，应用内检测更新弹窗也会显示这段内容。

## 检测更新失败排查

- 访问 `https://github.com/git-l-1031/zcode-switcher/releases/latest/download/latest.json`。
- 如果返回 `404`，说明当前最新 Release 没有上传更新清单，需要重新发布带 `latest.json` 的版本。
- 如果能打开 JSON，但软件提示验签失败，检查 GitHub Secrets 中的签名私钥是否和 `src-tauri/tauri.conf.json` 中的公钥匹配。
- 如果能打开 JSON 且验签正常，但软件提示已是最新版本，说明当前安装版本不低于 Release 版本。
