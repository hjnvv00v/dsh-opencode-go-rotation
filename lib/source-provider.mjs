import { createProvider } from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { DISPLAY_NAME, PLUGIN_NAME, PROVIDER } from './constants.mjs'

/** Profile entry id of the shipped pi-ai route table inside the DSH composition. */
const SOURCE_NAMESPACE = 'llm-pi-ai'
/** Route id of the pi-ai catalog provider this plugin rotates keys for. */
const BUILTIN_SOURCE = 'opencode-go'
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20_971_520
const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 4_194_304
const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1_048_576
const DEFAULT_CONTEXT_WINDOW = 262_144
const DEFAULT_MAX_TOKENS = 32_768
const DEFAULT_INPUT = ['text']
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const APIS = {
  'openai-completions': openAICompletionsApi,
  'openai-responses': openAIResponsesApi,
  'anthropic-messages': anthropicMessagesApi,
}

/**
 * Read the effective `llm-pi-ai` route table out of the running composition.
 *
 * DSH 0.2 moved plugin configuration into the profile's Cordis tree and removed
 * `ctx.settings.section()`. `ctx.settings.describe()` is the supported reader: it
 * returns the resolved, schema-validated live value of every active configurable
 * entry. It only lists entries that are already mounted, so this has to be read
 * lazily -- never once during `apply()`.
 */
function sourceRoutes(settings) {
  if (typeof settings?.describe === 'function') {
    try {
      const described = settings.describe()
      if (Array.isArray(described)) {
        const exact = described.find((entry) => entry?.ns === SOURCE_NAMESPACE)
        const providers = (exact ?? described.find((entry) => entry?.value?.providers !== undefined))?.value?.providers
        if (providers !== undefined) return providers !== null && typeof providers === 'object' ? providers : undefined
      }
    } catch {
      // Fall through to the legacy reader: a failing description must not take the route down.
    }
  }
  const providers = (typeof settings?.section === 'function' ? settings.section(SOURCE_NAMESPACE) : undefined)?.providers
  return providers !== null && typeof providers === 'object' ? providers : undefined
}

function providerSettings(settings, sourceProvider) {
  const source = sourceRoutes(settings)?.[sourceProvider]
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

/**
 * Reuse the catalog provider pi-ai ships for `opencode-go`, re-pointed at this
 * plugin's route id so key rotation can be layered underneath it.
 *
 * The resolved profile has to carry every field `PiAiAdapter` reads directly:
 * `modelOf()` dereferences `profile.modelErrors` unconditionally, and the image
 * branch reads the three request-image budgets. Omitting them is not a cosmetic
 * gap -- it throws `TypeError: Cannot read properties of undefined (reading 'get')`
 * on the first model lookup.
 */
export function buildBuiltinRotationProfile(displayName = DISPLAY_NAME) {
  const source = builtinProviders().find((provider) => provider.id === BUILTIN_SOURCE)
  if (!source) throw new Error('pi-ai 未提供 opencode-go catalog')
  const models = source.getModels().map((model) => ({ ...model, provider: PROVIDER }))
  const piProvider = { ...source, id: PROVIDER, name: displayName, getModels: () => models }
  return {
    provider: PROVIDER,
    displayName,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: DEFAULT_REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: resolveRetryPolicy(undefined, `plugin ${PLUGIN_NAME}`),
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    piProvider,
  }
}

/**
 * Build the single profile this plugin registers, mirroring the field set
 * `resolveProfiles()` produces for a first-party `llm-pi-ai` route.
 */
export function buildRotationProfile(settings, sourceProvider) {
  if (sourceProvider === BUILTIN_SOURCE) return buildBuiltinRotationProfile()
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
  const { apiKeyEnv: _apiKeyEnv, retryPolicy, models: _models, displayName: _displayName, ...rest } = source
  return {
    ...rest,
    provider: PROVIDER,
    displayName,
    streamIdleTimeoutMs: source.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    maxRequestImageBytes: source.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: source.requestImagePixelBudget ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: source.requestImageMaxBytes ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES,
    retryPolicy: resolveRetryPolicy(retryPolicy, `plugin ${PLUGIN_NAME}: source provider "${sourceProvider}"`),
    ...(rest.headers === undefined ? {} : { headers: { ...rest.headers } }),
    ...(rest.thinkingBudgets === undefined ? {} : { thinkingBudgets: { ...rest.thinkingBudgets } }),
    configuredMaxTokens: new Map(
      models
        .filter((model) => source.models.find((entry) => entry.id === model.id)?.maxTokens !== undefined)
        .map((model) => [model.id, model.maxTokens]),
    ),
    modelErrors: new Map(),
    piProvider,
  }
}

export function configuredSourceProviders(settings) {
  const providers = sourceRoutes(settings)
  if (providers === undefined) return []
  return Object.entries(providers).map(([id, value]) => ({ id, displayName: typeof value?.displayName === 'string' ? value.displayName : id }))
}
