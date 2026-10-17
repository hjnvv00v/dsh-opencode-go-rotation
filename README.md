# DSH OpenCode Go Key Rotation

DeepSeek Harness (DSH) plugin for OpenCode Go. It supports multiple API keys, automatic key rotation after quota exhaustion, and active-key usage display. It also works when OpenCode Go is configured as a custom DSH provider route.

## Requirements

- DSH desktop **44.7.0** or newer, i.e. DSH runtime **`>= 0.2.0-rc.2`** (verified on `0.2.1-rc.2`).
- The plugin is loaded by the DSH profile as a bundle, so it needs no build step.

DSH 0.1.x is no longer supported: `0.3.0` reads the provider configuration through `ctx.settings.describe()` because the old `ctx.settings.section()` API was removed, and it resolves `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-llm-pi-ai` and `@earendil-works/pi-ai` from the running DSH installation instead of shipping its own stale copies.

## Features

- Rotate to the next enabled key after a quota failure.
- Keep the active key in memory and cool down exhausted keys until their reported quota reset (5 hours is the fallback).
- Show rolling, weekly, and monthly usage for the active key.
- Display the active key label without exposing API key material.
- Configure keys from the DSH usage panel.

## Install

```powershell
dsh plugin --profile desktop add https://github.com/hjnvv00v/dsh-opencode-go-rotation.git
```

Then restart DSH (the desktop app, or `dsh web`). After DSH starts, choose provider `opencode-go-rotation` and a model, then open the usage panel to add keys.

## Custom DSH provider

The default source provider is `opencode-go`. If you created OpenCode Go as a custom provider in DSH Settings, enter that provider's **ID** in the `DSH 供应商 ID` field in the usage panel and save.

The custom provider must already declare its `api`, `baseURL`, and at least one model in `llm-pi-ai.providers`; the rotation plugin copies that provider's request settings and only replaces its API key handling. The visible provider used in conversations remains `opencode-go-rotation`.

If the selected provider ID cannot be read yet (for example while DSH is still mounting its settings), the plugin keeps serving the built-in `opencode-go` catalog and retries for a few seconds instead of failing every request. An unknown provider ID is still rejected when you save it, with an error shown in the usage panel.

The plugin stores configuration locally at:

```text
$DSH_HOME\dsh-opencode-go-rotation.json      # when DSH_HOME is set
%USERPROFILE%\.dsh\dsh-opencode-go-rotation.json   # otherwise
```

This is the same precedence DSH itself uses (`$DSH_HOME`, else `~/.dsh`), so a scratch or test profile that overrides `DSH_HOME` never reads or overwrites the real user's keys.

Do not commit or share that file. Each user must configure their own keys.

## Local Development

```powershell
dsh plugin --profile desktop add file:C:\path\to\dsh-opencode-go-rotation
```

Restart DSH after changing the plugin. The plugin has no build step; `npm test` runs the unit tests with the Node test runner.

## Changelog

### 0.3.0

- Adapted to DSH runtime `0.2.1-rc.2` / DSH desktop 44.7.0.
- Read `llm-pi-ai.providers` through `ctx.settings.describe()` (the `ctx.settings.section()` API was removed in 0.2).
- Build the registered profile lazily and completely: `modelErrors`, `maxRequestImageBytes`, `requestImagePixelBudget` and `requestImageMaxBytes` are now supplied, which fixes the `TypeError: Cannot read properties of undefined (reading 'get')` crash on model lookup.
- Resolve `@deepseek-ai/dsh-llm`, `@deepseek-ai/dsh-llm-pi-ai` and `@earendil-works/pi-ai` from the running DSH installation via `peerDependencies` instead of installing `0.1.0-rc.7` / `0.82.1` copies.
- Declare `engines.dsh` and re-register the rotation route when the DSH configuration changes.
- Fixed `dsh.client.inject`, which named a client package that does not exist on the 0.2 line.
- Resolve the key store through `$DSH_HOME` (falling back to `~/.dsh`) instead of the hardcoded OS home, matching DSH's own home resolution.

### 0.2.1

- Support custom DSH provider routes.

## License

MIT
