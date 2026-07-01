<h1 align="center">ZCode Switcher</h1>

<div align="center">

[简体中文](README.md) | **English**

<br />

<img src="https://raw.githubusercontent.com/git-l-1031/zcode-switcher/main/src/assets/zcode-logo.png" alt="ZCode Switcher Logo" width="132" />

<p><strong>A desktop tool for managing and seamlessly switching ZCode accounts</strong></p>
<p>Local account vault · Quota display · Auto switching · Capsule floating window · In-app updates</p>

[![Release](https://img.shields.io/github/v/release/git-l-1031/zcode-switcher?style=flat-square)](https://github.com/git-l-1031/zcode-switcher/releases)
[![Downloads](https://img.shields.io/github/downloads/git-l-1031/zcode-switcher/total?style=flat-square)](https://github.com/git-l-1031/zcode-switcher/releases)
[![Last Commit](https://img.shields.io/github/last-commit/git-l-1031/zcode-switcher?style=flat-square)](https://github.com/git-l-1031/zcode-switcher/commits/main)
[![Windows](https://img.shields.io/badge/Windows-10%2B-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/git-l-1031/zcode-switcher/releases)
[![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/git-l-1031/zcode-switcher/releases)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=222)](https://react.dev/)

[Download Latest](https://github.com/git-l-1031/zcode-switcher/releases) · [Usage Guide](docs/usage.md) · [Changelog](docs/changelog.md)

</div>

---

## Overview

ZCode Switcher saves and manages multiple ZCode accounts locally. It supports quota display, seamless account switching without restarting ZCode, and GLM-5.2 low-quota auto switching.

All account profiles are stored on your own computer and are not uploaded to any third-party server.

## Features

| Feature | Description |
| --- | --- |
| Local account management | Save, rename, delete, and batch-delete multiple accounts |
| JSON import/export | Back up and migrate account profiles |
| Seamless switching | Switch accounts without restarting ZCode; config changes take effect immediately |
| Quota display | Show quota, subscription status, and refresh results |
| GLM-5.2 auto switching | Automatically switch to an account with more remaining quota when the current quota is below the threshold |
| Capsule floating window | Show GLM-5.2 account pool stats and support resizing |
| Scheduled refresh | Refresh quota by minute and keep the latest quota data after closing the app |
| Multi-language UI | Supports Chinese, English, and Russian |
| In-app updates | Check for new versions, view release notes, download, and install updates in the app |

## Download

Download the installer for your platform from [Releases](https://github.com/git-l-1031/zcode-switcher/releases):

- Windows x64: `ZCode.Switcher_x.x.x_x64-setup.exe`
- macOS Apple Silicon beta: `ZCode.Switcher_x.x.x_aarch64.dmg`

The macOS build is not yet notarized with an Apple Developer ID. On first launch, you may need to allow it in System Settings → Privacy & Security.

## Usage Flow

1. Log in to one account in ZCode as usual.
2. Open ZCode Switcher and click "Save current account" to save the current login state to the local account vault.
3. To add more accounts, switch accounts in ZCode first, use OAuth login in the tool, or import a JSON / ZIP backup file.
4. Saved accounts will show nickname, subscription expiration date, quota progress bars, and refresh status in the list.
5. After enabling seamless switching, click the switch button on an account card to switch accounts. The switch does not require restarting ZCode, and the account config takes effect immediately.
6. If you use GLM-5.2, enable low-quota auto switching. When the current account quota is below the threshold, the app automatically switches to an account with more remaining quota.
7. If you want account pool status to stay visible, enable capsule floating mode and place the quota stats in a desktop corner.

## Screenshots

### Main Window

<p align="center">
  <img src="docs/images/readme-main-window.png" alt="Main Window" width="620" />
</p>

### Add Account

<p align="center">
  <img src="docs/images/add-account.png" alt="Add Account" width="420" />
</p>

### Seamless Switching

No ZCode restart is required. Account config takes effect immediately after switching.

<p align="center">
  <img src="docs/images/no-restart-switch.png" alt="Seamless Switching" width="260" />
</p>

### Capsule Floating Window

<p align="center">
  <img src="docs/images/floating-window.png" alt="Capsule Floating Window" width="320" />
</p>

## Documentation

- [Usage Guide](docs/usage.md)
- [Changelog](docs/changelog.md)
- [Development Guide](docs/development.md)
- [Release Guide](docs/release.md)

## Notice

Exported JSON files and local account profiles contain sensitive information. Keep them safe and do not upload them to public places.

## Disclaimer

This is a third-party helper tool and is not affiliated with ZCode / Z.ai. Please follow the relevant platform rules and use accounts at your own risk.
