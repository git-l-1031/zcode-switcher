# Account Identity

ZCode Switcher treats the account identifier parsed from `credentials.json` as the stable account identity.

- Email is used first when it is readable.
- Phone number is used when email is not available.
- Saving the current account requires a readable email or phone number.
- Saving another credential for an existing identifier updates that profile instead of creating a duplicate.
- The active account marker is matched by the same identifier.
- `cred_hash` records a specific credential file version and is not used as the account identity.

## Switch behavior

- The app can try an experimental background-service refresh after switching credentials.
- That mode terminates only ZCode's `app-server --stdio` child process and keeps the main ZCode window open.
- When switching, the app also syncs the Z.ai start-plan API key in `config.json` from the target account's `zcodejwttoken`.
- The app backs up both `credentials.json` and, when changed, `config.json` before replacing the active files.
- If the background service does not come back within a short wait, the app asks the user to restart ZCode manually instead of restarting it automatically.
- When no-restart switching is enabled, the automatic restart setting is kept disabled because the two modes are mutually exclusive.
- The settings panel no longer exposes a manual restart button; if ZCode still keeps the old runtime auth state, restart ZCode outside the switcher or disable no-restart switching and use automatic restart on the next switch.

## Quota behavior

- Opening or refreshing the app always starts quota refresh by default; the old manual "refresh on open" switch is no longer shown.
- Full quota refresh follows the account list order and processes three accounts per batch, then continues with the next batch.
- The latest quota data is cached locally after each refresh, so closing and reopening the app can restore the last visible balances before the next network refresh finishes.
- Quota refresh keeps the last visible balances when a later refresh fails, so a transient network or billing error does not clear the progress bars.
- The GLM-5.2 auto-switch rule runs after full quota refresh. When it is enabled, the active account is also refreshed once per minute for the auto-switch check without changing other accounts' refresh frequency; this behavior is shown in the setting description.
- The default GLM-5.2 auto-switch threshold is 350,000 units.
- When enabled, if the active account's GLM-5.2 remaining quota is below the configured threshold, the app switches to another saved account whose GLM-5.2 remaining quota is greater than 1,500,000 units.

## Interface behavior

- The top-right header area is used for language switching instead of the current-login text.
- Supported interface languages are Chinese, English, and Russian.
- The current-login status is still visible beside the account count in the toolbar.
- The About section shows a check-update button next to the version. When a GitHub Release update is available, the app can download, install, and relaunch in place without opening the release page.
