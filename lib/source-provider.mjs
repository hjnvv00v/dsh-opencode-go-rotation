import { createProvider } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { PLUGIN_NAME, PROVIDER } from './constants.mjs'

const DEFAULT_CONTEXT_WINDOW = 262_144
const DEFAULT_MAX_TOKENS = 32_768
const DEFAULT_INPUT = ['text']
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const APIS = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
}

function providerSettings(settings, sourceProvider) {
  const config = settings?.section?.('llm-pi-ai')
  const source = config?.providers?.[sourceProvider]
  if (!source || typeof source !== 'object') {
    throw new Error(`找不到 DSH 供应商 ID “${sourceProvider}”。请先在设置中创建该自定义供应商，或改回 opencode-go。`)
  }
  return source
}

function customModels(sourceProvider, source) {
  if (!Array.isArray(source.models) || source.models.length === 0) {
    throw new Error(`无法使用 DSH 供应商 ID “${sourceProvider}”：自定义供应商必须配置至少一个模型。`)
  }
  if (typeof source.api !== 'string' || !APIS[source.api]) {
    throw new Error(`无法使用 DSH 供应商 ID “${sourceProvider}”：需要受支持的 api（openai-completions、openai-responses 或 anthropic-messages）。`)
  }
  if (typeof source.baseURL !== 'string' || !source.baseURL) {
    throw new Error(`无法使用 DSH 供应商 ID “${sourceProvider}”：需要配置 baseURL。`)
  }
  const seen = new Set()
  return source.models.map((entry) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id) throw new Error(`无法使用 DSH 供应商 ID “${sourceProvider}”：模型必须有 id。`)
    if (seen.has(entry.id)) throw new Error(`无法使用 DSH 供应商 ID “${sourceProvider}”：模型 “${entry.id}” 重复。`)
    seen.add(entry.id)
    const contextWindow = entry.contextWindow ?? source.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
    const maxTokens = entry.maxTokens ?? source.defaultMaxTokens ?? DEFAULT_MAX_TOKENS
    if (!Number.isInteger(contextWindow) || contextWindow <= 0) throw new Error(`无法使用 DSH 供应商 ID “${sourceProvider}”：模型 “${entry.id}” 的 contextWindow 无效。`)
    if (!Number.isInteger(maxTokens) || maxTokens <= 0) throw new Error(`无法使用 DSH 供应商 ID “${sourceProvider}”：模型 “${entry.id}” 的 maxTokens 无效。`)
    return {
      id: entry.id,
      name: entry.name || entry.id,
      provider: PROVIDER,
      api: source.api,
      baseUrl: source.baseURL,
      input: entry.input || source.defaultInput || DEFAULT_INPUT,
      cost: NO_COST,
      contextWindow,
      maxTokens,
      ...(source.compat || entry.compat ? { compat: { ...source.compat, ...entry.compat } } : {}),
      ...(entry.reasoningEfforts !== undefined ? { reasoningEfforts: entry.reasoningEfforts } : {}),
    }
  })
}

function builtinProfile() {
  const source = builtinProviders().find((provider) => provider.id === 'opencode-go')
  if (!source) throw new Error('pi-ai 未提供 opencode-go catalog')
  const models = source.getModels().map((model) => ({ ...model, provider: PROVIDER }))
  return {
    models,
    piProvider: {
      ...source,
      id: PROVIDER,
      name: 'OpenCode Go (Key rotation)',
      getModels: () => models,
    },
    displayName: 'OpenCode Go (Key rotation)',
    retryPolicy: undefined,
    configuredMaxTokens: new Map(),
  }
}

export function buildRotationProfile(settings, sourceProvider) {
  if (sourceProvider === 'opencode-go') return profileFromBuiltin()
  const source = providerSettings(settings, sourceProvider)
  const models = customModels(sourceProvider, source)
  const displayName = `${source.displayName || sourceProvider} (Key rotation)`
  const api = APIS[source.api]
  const piProvider = createProvider({
    id: PROVIDER,
    name: displayName,
    baseUrl: source.baseURL,
    ...(source.headers ? { headers: { ...source.headers } } : {}),
    auth: {
      apiKey: {
        name: displayName,
        resolve: ({ credential }) => Promise.resolve({ auth: credential?.key ? { apiKey: credential.key } : {}, source: displayName }),
      },
    },
    models,
    api: api(),
  })
  return {
    provider: PROVIDER,
    displayName,
    streamIdleTimeoutMs: source.streamIdleTimeoutMs ?? 300_000,
    retryPolicy: resolveRetryPolicy(source.retryPolicy, `plugin ${PLUGIN_NAME}: source provider "${sourceProvider}"`),
    configuredMaxTokens: new Map(models.filter((model) => source.models.find((entry) => entry.id === model.id)?.maxTokens !== undefined).map((model) => [model.id, model.maxTokens])),
    piProvider,
  }
}

function profileFromBuiltin() {
  const profile = builtinProfile()
  return {
    provider: PROVIDER,
    streamIdleTimeoutMs: 300_000,
    ...profile,
    retryPolicy: resolveRetryPolicy(undefined, `plugin ${PLUGIN_NAME}`),
  }
}

export function configuredSourceProviders(settings) {
  const config = settings?.section?.('llm-pi-ai')
  const providers = config?.providers
  if (!providers || typeof providers !== 'object') return []
  return Object.entries(providers).map(([id, value]) => ({ id, displayName: typeof value?.displayName === 'string' ? value.displayName : id }))
}
