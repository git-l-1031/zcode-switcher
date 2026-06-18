# Release

## Updater

- The app checks updates from GitHub Releases:
  `https://github.com/git-1-1031/zcode-switcher/releases/latest/download/latest.json`
- The updater public key is stored in `src-tauri/tauri.conf.json`.
- The updater private key must not be committed to the repository.
- The local private key created for this project is:
  `C:\Users\Sunset\Desktop\zcode-switcher-updater.key`

## GitHub Secrets

Before publishing releases from GitHub Actions, add these repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `zcode-switcher-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: `zcode-switcher-updater`

## Publish

Create and push a version tag:

```powershell
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions will create the release and upload the installer plus updater artifacts.
