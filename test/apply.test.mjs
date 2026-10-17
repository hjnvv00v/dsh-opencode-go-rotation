import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The plugin resolves its key store at import time, so point DSH_HOME at a
// throwaway directory before importing it: the test must never read or write
// the real user's `~/.dsh/dsh-opencode-go-rotation.json`.
const home = mkdtempSync(join(tmpdir(), 'dsh-rotation-apply-'))
process.env.DSH_HOME = home
delete process.env.OPENCODE_GO_API_KEY

let plugin = null
let skip = false
try {
  plugin = await import('../index.mjs')
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') skip = 'host DSH packages are not resolvable from this checkout'
  else throw error
}

after(() => rmSync(home, { recursive: true, force: true }))

const PROVIDER = 'opencode-go-rotation'
const SETTINGS = {
  describe: () => [{
    ns: 'llm-pi-ai',
    value: {
      providers: {
        'opencode-go': {
          displayName: 'OpenCode Go',
          baseURL: 'https://opencode.ai/zen/go',
          api: 'openai-completions',
          models: [{ id: 'deepseek-v4-flash' }],
        },
        'my-route': {
          displayName: 'My Route',
          baseURL: 'https://example.test/v1',
          api: 'openai-completions',
          models: [{ id: 'm1', maxTokens: 4096 }],
        },
      },
    },
  }],
}

function makeContext(settings = SETTINGS) {
  const seen = { adapterRoutes: null, adapter: null, routes: [], listeners: new Map(), disposers: [], replaced: null }
  const ctx = {
    logger: { warn() {}, info() {}, error() {} },
    settings,
    llm: {
      registerAdapter(routes, adapter) {
        seen.adapterRoutes = routes
        seen.adapter = adapter
        const dispose = () => { seen.adapterDisposed = true }
        dispose.replace = (next) => { seen.replaced = next }
        return dispose
      },
    },
    webServer: { register(route) { seen.routes.push(route); return () => {} } },
    on(event, handler, options) { seen.listeners.set(event, { handler, options }); return () => {} },
    effect(execute) { seen.disposers.push(execute()); return () => {} },
    get() { return undefined },
  }
  return { ctx, seen }
}

function fakeResponse() {
  const out = { status: 0, headers: null, body: '' }
  return {
    out,
    writeHead(status, headers) { out.status = status; out.headers = headers },
    end(chunk) { out.body = chunk ?? '' },
  }
}

function fakeRequest(method, payload) {
  const request = { method, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3401' } }
  if (payload !== undefined) {
    request[Symbol.asyncIterator] = async function* iterator() { yield Buffer.from(JSON.stringify(payload)) }
  }
  return request
}

async function call(route, method, payload) {
  const response = fakeResponse()
  await route.handler(fakeRequest(method, payload), response)
  return { status: response.out.status, body: response.out.body ? JSON.parse(response.out.body) : undefined }
}

test('apply() wires the adapter and the three exact routes', { skip }, () => {
  const { ctx, seen } = makeContext()
  plugin.apply(ctx)
  assert.deepEqual(seen.adapterRoutes, [PROVIDER])
  assert.deepEqual(seen.routes.map((route) => route.path).sort(), [
    '/api/dsh-opencode-go-rotation/config',
    '/api/dsh-opencode-go-rotation/state',
    '/api/dsh-opencode-go-rotation/usage',
  ])
  assert.ok(seen.routes.every((route) => route.kind === 'exact'))
  assert.ok(seen.listeners.has('agent/request-error'))
  assert.equal(seen.listeners.get('agent/request-error').options.prepend, true)
  assert.ok(seen.listeners.has('loader/volatile-update'))
})

test('the registered adapter resolves models instead of crashing on modelErrors', { skip }, async () => {
  const { ctx, seen } = makeContext()
  plugin.apply(ctx)
  const resolved = await seen.adapter.resolveModel(PROVIDER, 'deepseek-v4-flash')
  assert.equal(resolved.provider, PROVIDER)
  assert.equal(resolved.id, 'deepseek-v4-flash')
  assert.ok(resolved.context.contextWindow > 0)
  assert.equal(seen.adapter.providerInfo(PROVIDER).name, 'OpenCode Go (Key rotation)')
})

test('GET /state reports the live source providers', { skip }, async () => {
  const { ctx, seen } = makeContext()
  plugin.apply(ctx)
  const state = seen.routes.find((route) => route.path.endsWith('/state'))
  const result = await call(state, 'GET')
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.data.sourceProvider, 'opencode-go')
  assert.equal(result.body.data.sourceProviderDisplayName, 'OpenCode Go')
  assert.deepEqual(result.body.data.sourceProviders.map((entry) => entry.id), ['opencode-go', 'my-route'])
})

test('POST /config rejects an unknown source provider and keeps the old one', { skip }, async () => {
  const { ctx, seen } = makeContext()
  plugin.apply(ctx)
  const config = seen.routes.find((route) => route.path.endsWith('/config'))
  const rejected = await call(config, 'POST', { sourceProvider: 'nope' })
  assert.equal(rejected.status, 400)
  assert.match(rejected.body.error, /找不到 DSH 供应商 ID/)
  const state = await call(config, 'GET')
  assert.equal(state.body.data.sourceProvider, 'opencode-go')
})

test('POST /config accepts a readable source provider and re-registers the route', { skip }, async () => {
  const { ctx, seen } = makeContext()
  plugin.apply(ctx)
  const config = seen.routes.find((route) => route.path.endsWith('/config'))
  const accepted = await call(config, 'POST', { sourceProvider: 'my-route' })
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.data.sourceProvider, 'my-route')
  assert.deepEqual(seen.replaced, [PROVIDER])
  const resolved = await seen.adapter.resolveModel(PROVIDER, 'm1')
  assert.equal(resolved.defaultMaxTokens, 4096)
})

test('the quota listener defers to the next handler when no key is available', { skip }, async () => {
  const { ctx, seen } = makeContext()
  plugin.apply(ctx)
  const listener = seen.listeners.get('agent/request-error').handler
  const next = () => 'NEXT'
  assert.equal(await listener({ provider: 'someone-else', failure: { code: 'QUOTA' } }, next), 'NEXT')
  assert.equal(await listener({ provider: PROVIDER, failure: { code: 'SERVER' } }, next), 'NEXT')
  assert.equal(await listener({ provider: PROVIDER, failure: { code: 'QUOTA' } }, next), 'NEXT')
})

test('the effect disposer tears everything down without throwing', { skip }, () => {
  const { ctx, seen } = makeContext()
  plugin.apply(ctx)
  assert.equal(seen.disposers.length, 1)
  assert.doesNotThrow(() => seen.disposers[0]())
})
