export const API_BASE = '/api/dsh-opencode-go-rotation'
export const API = { state: `${API_BASE}/state`, usage: `${API_BASE}/usage`, config: `${API_BASE}/config` }
const MAX_BODY = 128 * 1024

function loopback(request) {
  const address = request.socket.remoteAddress
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)) return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    return ['127.0.0.1', 'localhost', '[::1]'].includes(hostname) && request.headers['sec-fetch-site'] !== 'cross-site'
  } catch { return false }
}
function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
  response.end(JSON.stringify(body))
}
async function body(request) {
  const chunks = []; let total = 0
  for await (const item of request) {
    total += item.length
    if (total > MAX_BODY) return undefined
    chunks.push(item)
  }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); return value && typeof value === 'object' ? value : undefined } catch { return undefined }
}

export function makeRoutes({ store, keys, usage }) {
  const state = async () => ({ ...(await keys.publicState()), ...(await store.get()) })
  const guard = (request, response, method) => {
    if (!loopback(request)) { json(response, 403, { error: 'forbidden: loopback-only' }); return false }
    if (request.method !== method) { json(response, 405, { error: `method not allowed: ${request.method}` }); return false }
    return true
  }
  return [
    { kind: 'exact', path: API.state, handler: async (request, response) => {
      if (!guard(request, response, 'GET')) return
      json(response, 200, { ok: true, data: await state() })
    } },
    { kind: 'exact', path: API.usage, handler: async (request, response) => {
      if (!guard(request, response, 'GET')) return
      try {
        const config = await store.get(); const current = await keys.current()
        if (!config.enabled) throw new Error('插件已禁用')
        const data = await usage({ apiKey: current?.key, baseUrl: config.baseUrl })
        json(response, 200, { ok: true, data: { ...data, active: await keys.publicState() } })
      } catch (error) { json(response, 200, { ok: false, error: error instanceof Error ? error.message : String(error), data: await state() }) }
    } },
    { kind: 'exact', path: API.config, handler: async (request, response) => {
      if (!loopback(request)) { json(response, 403, { error: 'forbidden: loopback-only' }); return }
      if (request.method === 'GET') { json(response, 200, { ok: true, data: await state() }); return }
      if (request.method !== 'POST') { json(response, 405, { error: `method not allowed: ${request.method}` }); return }
      const patch = await body(request)
      if (!patch) { json(response, 400, { error: 'invalid JSON body' }); return }
      try {
        if (patch.keys !== undefined) await keys.updateKeys(patch.keys)
        await store.update(patch)
        json(response, 200, { ok: true, data: await state() })
      } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : String(error) }) }
    } },
  ]
}
