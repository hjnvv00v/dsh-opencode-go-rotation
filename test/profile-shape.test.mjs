import assert from 'node:assert/strict'
import test from 'node:test'

// `lib/source-provider.mjs` imports the host DSH packages, which only resolve
// inside a DSH installation or a profile that links this plugin. Skip rather
// than fail when this checkout is standalone.
const provider = await import('../lib/source-provider.mjs').catch((error) => {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined
  throw error
})
const skip = provider === undefined ? 'host DSH packages are not resolvable from this checkout' : false

test('the builtin rotation profile carries every field PiAiAdapter dereferences', { skip }, () => {
  const profile = provider.buildBuiltinRotationProfile()
  assert.equal(profile.provider, 'opencode-go-rotation')
  assert.equal(profile.displayName, 'OpenCode Go (Key rotation)')
  assert.equal(profile.streamIdleTimeoutMs, 300_000)
  assert.equal(profile.maxRequestImageBytes, 20_971_520)
  assert.equal(profile.requestImagePixelBudget, 4_194_304)
  assert.equal(profile.requestImageMaxBytes, 1_048_576)
  assert.ok(profile.configuredMaxTokens instanceof Map)
  // `PiAiAdapter.modelOf()` calls `profile.modelErrors.get(model)` unconditionally.
  assert.ok(profile.modelErrors instanceof Map)
  assert.equal(typeof profile.retryPolicy, 'object')
  const models = profile.piProvider.getModels()
  assert.ok(models.length > 0)
  for (const model of models) assert.equal(model.provider, 'opencode-go-rotation')
})

test('the builtin profile can be relabelled for a broken source selection', { skip }, () => {
  assert.equal(provider.buildBuiltinRotationProfile('X').displayName, 'X')
})

test('configuredSourceProviders reads the live route table through settings.describe()', { skip }, () => {
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', value: { providers: { 'opencode-go': { displayName: 'OpenCode Go' }, mine: {} } } }],
  }
  assert.deepEqual(provider.configuredSourceProviders(settings), [
    { id: 'opencode-go', displayName: 'OpenCode Go' },
    { id: 'mine', displayName: 'mine' },
  ])
})

test('configuredSourceProviders finds the route table under a renamed entry id', { skip }, () => {
  const settings = { describe: () => [{ ns: 'llm', value: {} }, { ns: 'llm-pi-ai-2', value: { providers: { a: { displayName: 'A' } } } }] }
  assert.deepEqual(provider.configuredSourceProviders(settings), [{ id: 'a', displayName: 'A' }])
})

test('configuredSourceProviders falls back to section() for DSH 0.1.x', { skip }, () => {
  const settings = { section: (ns) => (ns === 'llm-pi-ai' ? { providers: { legacy: { displayName: 'Legacy' } } } : undefined) }
  assert.deepEqual(provider.configuredSourceProviders(settings), [{ id: 'legacy', displayName: 'Legacy' }])
})

test('configuredSourceProviders survives a throwing describe()', { skip }, () => {
  const settings = { describe: () => { throw new Error('boom') }, section: () => ({ providers: { legacy: {} } }) }
  assert.deepEqual(provider.configuredSourceProviders(settings), [{ id: 'legacy', displayName: 'legacy' }])
})

test('a missing source provider is reported instead of silently ignored', { skip }, () => {
  const settings = { describe: () => [{ ns: 'llm-pi-ai', value: { providers: {} } }] }
  assert.throws(() => provider.buildRotationProfile(settings, 'nope'), /找不到 DSH 供应商 ID/)
})

test('a custom source provider builds a profile with the same required fields', { skip }, () => {
  const settings = {
    describe: () => [{
      ns: 'llm-pi-ai',
      value: {
        providers: {
          mine: {
            displayName: 'Mine',
            api: 'openai-completions',
            baseURL: 'https://example.test/v1',
            streamIdleTimeoutMs: 12_345,
            headers: { 'x-test': '1' },
            models: [{ id: 'm1', maxTokens: 4_096 }],
          },
        },
      },
    }],
  }
  const profile = provider.buildRotationProfile(settings, 'mine')
  assert.equal(profile.provider, 'opencode-go-rotation')
  assert.equal(profile.displayName, 'Mine (Key rotation)')
  assert.equal(profile.streamIdleTimeoutMs, 12_345)
  assert.equal(profile.maxRequestImageBytes, 20_971_520)
  assert.equal(profile.requestImagePixelBudget, 4_194_304)
  assert.equal(profile.requestImageMaxBytes, 1_048_576)
  assert.deepEqual(profile.headers, { 'x-test': '1' })
  assert.equal(profile.headers['x-test'], '1')
  assert.ok(profile.modelErrors instanceof Map)
  assert.equal(profile.configuredMaxTokens.get('m1'), 4_096)
  assert.equal(profile.piProvider.id, 'opencode-go-rotation')
  assert.equal(profile.piProvider.getModels()[0].id, 'm1')
  // The profile must not leak the source route's own id into the catalog.
  assert.equal(profile.piProvider.getModels()[0].provider, 'opencode-go-rotation')
})
