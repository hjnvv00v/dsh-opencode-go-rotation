import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { RotationConfigStore } from './lib/config.mjs'
import { DEFAULT_COOLDOWN_MS, KeyManager, cooldownMsFromUsage } from './lib/key-manager.mjs'
import { fetchUsage } from './lib/usage.mjs'
import { makeRoutes } from './lib/routes.mjs'
import { buildBuiltinRotationProfile, buildRotationProfile, configuredSourceProviders } from './lib/source-provider.mjs'
import { DISPLAY_NAME, PLUGIN_NAME, PROVIDER } from './lib/constants.mjs'

export const name = PLUGIN_NAME
export const inject = ['llm', 'webServer', 'settings']
export { PROVIDER }

/** How long to keep serving the built-in catalog before retrying a broken source selection. */
const BROKEN_SOURCE_RETRY_MS = 5_000

export function apply(ctx) {
  const store = new RotationConfigStore()
  const keys = new KeyManager(store)
  let sourceProvider = store.initial().sourceProvider
  // `PiAiAdapter.current()` memoizes its snapshot on the identity of the Map
  // returned by `profiles()`, so that Map may only be replaced when the
  // configuration actually changed -- rebuilding it per request would rebuild
  // the whole pi-ai model catalog on every call.
  let resolved = null
  let broken = null
  let adapterRegistration

  const fallbackProfiles = (message) => {
    if (broken === null || broken.sourceProvider !== sourceProvider) {
      broken = {
        sourceProvider,
        retryAt: 0,
        profiles: new Map([[PROVIDER, buildBuiltinRotationProfile(`${DISPLAY_NAME}（${sourceProvider} 不可用）`)]]),
      }
      ctx.logger.warn(`${name}: 供应商 “${sourceProvider}” 暂时不可用，先回退到内置 opencode-go catalog：${message}`)
    }
    return broken.profiles
  }

  const profiles = () => {
    if (resolved !== null && resolved.sourceProvider === sourceProvider) return resolved.profiles
    if (broken !== null && broken.sourceProvider === sourceProvider && Date.now() < broken.retryAt) return broken.profiles
    try {
      const profile = buildRotationProfile(ctx.settings, sourceProvider)
      resolved = { sourceProvider, profiles: new Map([[PROVIDER, profile]]) }
      broken = null
      return resolved.profiles
    } catch (error) {
      const list = fallbackProfiles(error instanceof Error ? error.message : String(error))
      broken.retryAt = Date.now() + BROKEN_SOURCE_RETRY_MS
      return list
    }
  }

  const setSourceProvider = (next) => {
    const previous = { sourceProvider, resolved, broken }
    sourceProvider = next
    resolved = null
    broken = null
    try {
      const profile = buildRotationProfile(ctx.settings, next)
      resolved = { sourceProvider: next, profiles: new Map([[PROVIDER, profile]]) }
    } catch (error) {
      sourceProvider = previous.sourceProvider
      resolved = previous.resolved
      broken = previous.broken
      throw error
    }
    adapterRegistration?.replace([PROVIDER])
  }

  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey: async () => {
      const key = await keys.apiKey()
      if (!key) throw new Error('OpenCode Go rotation: 没有可用 Key，请在用量面板配置 Key')
      return key
    },
    resolveAttachments: () => ctx.get('attachments'),
    onReplayDegrade: ({ reason }) => ctx.logger.warn(`${name}: replay degraded: ${reason}`),
  })
  adapterRegistration = ctx.llm.registerAdapter([PROVIDER], adapter)

  // A route added to `llm-pi-ai` after this plugin mounted only shows up once the
  // profile is rebuilt, so follow the same configuration-change signal the
  // first-party llm-pi-ai plugin listens to.
  const disposeVolatile = ctx.on('loader/volatile-update', () => {
    resolved = null
    broken = null
    try {
      adapterRegistration?.replace([PROVIDER])
    } catch (error) {
      ctx.logger.error(`${name}: 配置变更后无法重新注册轮换路由`)
      ctx.logger.error(error)
    }
  })

  const routes = makeRoutes({ store, keys, usage: fetchUsage, configuredSources: () => configuredSourceProviders(ctx.settings), setSourceProvider })
  const routeDisposers = routes.map((route) => ctx.webServer.register(route))
  const disposeError = ctx.on('agent/request-error', async (payload, next) => {
    if (payload.provider !== PROVIDER || payload.failure.code !== 'QUOTA') return next()
    let cooldownMs = DEFAULT_COOLDOWN_MS
    const current = await keys.current()
    if (current) {
      try {
        const config = await store.get()
        const usage = await fetchUsage({ apiKey: current.key, baseUrl: config.baseUrl })
        cooldownMs = cooldownMsFromUsage(usage)
      } catch (error) {
        ctx.logger.warn(`${name}: could not read quota reset time; using ${DEFAULT_COOLDOWN_MS / 3_600_000}h fallback: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const nextKey = await keys.rotateAfterQuota({ cooldownMs })
    if (!nextKey) {
      ctx.logger.warn(`${name}: all configured keys are cooling down after quota exhaustion`)
      return next()
    }
    ctx.logger.info(`${name}: quota exhausted; switched active key to ${nextKey.label}`)
    return { kind: 'retry' }
  }, { prepend: true })
  ctx.effect(() => () => {
    disposeVolatile()
    disposeError()
    adapterRegistration()
    for (const dispose of routeDisposers) dispose()
  }, `${name}: dispose`)
}

export { RotationConfigStore, KeyManager }
export default { name, inject, apply }
