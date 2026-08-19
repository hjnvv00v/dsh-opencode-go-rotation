export const WINDOW_KEYS = ['rolling', 'weekly', 'monthly']

export function usageEndpoint(baseUrl) { return `${String(baseUrl).replace(/\/+$/, '')}/v1/usage` }

export function parseUsage(json) {
  const root = json && typeof json === 'object' ? json : {}
  const usage = root.usage && typeof root.usage === 'object' ? root.usage : root
  const windows = WINDOW_KEYS.flatMap((key) => {
    const value = usage[key]
    if (!value || typeof value !== 'object') return []
    const percent = Number.isFinite(value.percent) ? Math.max(0, Math.min(100, value.percent)) : null
    const resetsInSeconds = Number.isFinite(value.resetsInSeconds)
      ? Math.max(0, Math.floor(value.resetsInSeconds))
      : typeof value.resetsAt === 'string' && Number.isFinite(Date.parse(value.resetsAt))
        ? Math.max(0, Math.floor((Date.parse(value.resetsAt) - Date.now()) / 1000)) : null
    return [{ key, percent, resetsInSeconds, status: typeof value.status === 'string' ? value.status : 'ok' }]
  })
  if (!windows.length) throw new Error('无法解析 OpenCode Go 用量接口响应')
  return { windows, fetchedAt: Date.now() }
}

export async function fetchUsage({ apiKey, baseUrl, timeoutMs = 15_000 }) {
  if (!apiKey) throw new Error('未配置 OpenCode Go API Key')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(usageEndpoint(baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': 'dsh-opencode-go-rotation/0.1' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`OpenCode Go 用量接口返回 HTTP ${response.status}`)
    return parseUsage(await response.json())
  } finally { clearTimeout(timer) }
}
