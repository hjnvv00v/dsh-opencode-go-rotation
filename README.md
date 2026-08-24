# DSH OpenCode Go Key Rotation

DeepSeek Harness (DSH) plugin for OpenCode Go. It supports multiple API keys, automatic key rotation after quota exhaustion, and active-key usage display. It also works when OpenCode Go is configured as a custom DSH provider route.

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

After DSH starts, choose provider `opencode-go-rotation` and a model, then open the usage panel to add keys.

## Custom DSH provider

The default source provider is `opencode-go`. If you created OpenCode Go as a custom provider in DSH Settings, enter that provider's **ID** in the `DSH 供应商 ID` field in the usage panel and save.

The custom provider must already declare its `api`, `baseURL`, and at least one model in `llm-pi-ai.providers`; the rotation plugin copies that provider's request settings and only replaces its API key handling. The visible provider used in conversations remains `opencode-go-rotation`.

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
