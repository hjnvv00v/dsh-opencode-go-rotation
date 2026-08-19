# DSH OpenCode Go Key Rotation

DeepSeek Harness (DSH) plugin for OpenCode Go. It supports multiple API keys, automatic key rotation after quota exhaustion, and active-key usage display.

## Features

- Rotate to the next enabled key after a quota failure.
- Keep the active key in memory and cool down exhausted keys until their reported quota reset (5 hours is the fallback).
- Show rolling, weekly, and monthly usage for the active key.
- Display the active key label without exposing API key material.
- Configure keys from the DSH usage panel.

## Install

```powershell
dsh plugin --profile web add https://github.com/hjnvv00v/dsh-opencode-go-rotation.git
dsh web
```

After DSH starts, choose provider `opencode-go-rotation` and model `deepseek-v4-flash`, then open the usage panel to add keys.

The plugin stores configuration locally at:

```text
%USERPROFILE%\.dsh\dsh-opencode-go-rotation.json
```

Do not commit or share that file. Each user must configure their own keys.

## Local Development

```powershell
dsh plugin --profile web add file:C:\path\to\dsh-opencode-go-rotation
```

Restart `dsh web` after changing the plugin.

## License

MIT
