import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { RotationConfigStore } from './lib/config.mjs'
import { KeyManager } from './lib/key-manager.mjs'
import { fetchUsage } from './lib/usage.mjs'
import { makeRoutes } from './lib/routes.mjs'

export const name = 'opencode-go-rotation'
export const inject = ['llm', 'webServer']
export const PROVIDER = 'opencode-go-rotation'

function rotationProfile() {
  const source = builtinProviders().find((provider) => provider.id === 'opencode-go')
  if (!source) throw new Error('pi-ai 未提供 opencode-go catalog')
  const models = source.getModels().map((model) => ({ ...model, provider: PROVIDER }))
  const piProvider = {
    ...source,
    id: PROVIDER,
    name: 'OpenCode Go (Key rotation)',
    getModels: () => models,
  }
  return {
    provider: PROVIDER,
    displayName: 'OpenCode Go (Key rotation)',
    streamIdleTimeoutMs: 300_000,
    retryPolicy: resolveRetryPolicy(undefined, `plugin ${name}`),
    configuredMaxTokens: new Map(),
    piProvider,
  }
}

export function apply(ctx) {
  const store = new RotationConfigStore()
  const keys = new KeyManager(store)
  const profile = rotationProfile()
  const profiles = new Map([[PROVIDER, profile]])
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: async () => {
      const key = await keys.apiKey()
      if (!key) throw new Error('OpenCode Go rotation: 没有可用 Key，请在用量面板配置 Key')
      return key
    },
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: ({ reason }) => ctx.logger.warn(`${name}: replay degraded: ${reason}`),
  })
  const adapterRegistration = ctx.llm.registerAdapter([PROVIDER], adapter)
  const routes = makeRoutes({ store, keys, usage: fetchUsage })
  const routeDisposers = routes.map((route) => ctx.webServer.register(route))
  const disposeError = ctx.on('agent/request-error', async (payload, next) => {
    if (payload.provider !== PROVIDER || payload.failure.code !== 'QUOTA') return next()
    const nextKey = await keys.rotateAfterQuota()
    if (!nextKey) {
      ctx.logger.warn(`${name}: all configured keys are cooling down after quota exhaustion`)
      return next()
    }
    ctx.logger.info(`${name}: quota exhausted; switched active key to ${nextKey.label}`)
    return { kind: 'retry' }
  }, { prepend: true })
  ctx.effect(() => () => {
    disposeError()
    adapterRegistration()
    for (const dispose of routeDisposers) dispose()
  }, `${name}: dispose`)
}

export { RotationConfigStore, KeyManager }
export default { name, inject, apply }
