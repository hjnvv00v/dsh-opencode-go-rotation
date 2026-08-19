import { randomUUID } from 'node:crypto'

export const KEY_ENV = 'OPENCODE_GO_API_KEY'
export const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000

export function maskKey(key) {
  const text = String(key ?? '')
  if (text.length < 8) return '****'
  return `****${text.slice(-4)}`
}

function normalizedKey(input) {
  const value = String(input ?? '').trim()
  return value.length > 0 ? value : undefined
}

/** In-memory selector. Persistent configuration is deliberately kept separate. */
export class KeyManager {
  constructor(store, { env = process.env, now = () => Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS } = {}) {
    this.store = store
    this.env = env
    this.now = now
    this.cooldownMs = cooldownMs
    this.activeId = undefined
    this.cooldowns = new Map()
  }

  async keys() {
    const doc = await this.store.readDocument()
    const configured = Array.isArray(doc.keys) ? doc.keys : []
    const result = configured
      .map((entry, index) => ({
        id: typeof entry?.id === 'string' ? entry.id : `key-${index + 1}`,
        label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim() : `Key ${index + 1}`,
        key: normalizedKey(entry?.key),
        enabled: entry?.enabled !== false,
      }))
      .filter((entry) => entry.key)
    if (result.length === 0) {
      const fallback = normalizedKey(this.env[KEY_ENV])
      if (fallback) result.push({ id: 'environment', label: '环境变量', key: fallback, enabled: true, environment: true })
    }
    return result
  }

  async select({ advance = false } = {}) {
    const now = this.now()
    const keys = (await this.keys()).filter((key) => key.enabled && (this.cooldowns.get(key.id) ?? 0) <= now)
    if (keys.length === 0) return undefined
    let index = keys.findIndex((key) => key.id === this.activeId)
    if (index < 0) index = 0
    else if (advance) index = (index + 1) % keys.length
    const selected = keys[index]
    this.activeId = selected.id
    return selected
  }

  async current() {
    return this.select()
  }

  async apiKey() {
    return (await this.current())?.key
  }

  async rotateAfterQuota() {
    const current = await this.current()
    if (current) this.cooldowns.set(current.id, this.now() + this.cooldownMs)
    return this.select({ advance: true })
  }

  async publicState() {
    const all = await this.keys()
    const current = await this.current()
    const now = this.now()
    return {
      activeKeyId: current?.id,
      activeKeyLabel: current?.label,
      activeKeyMasked: current ? maskKey(current.key) : undefined,
      keyCount: all.length,
      availableKeyCount: all.filter((key) => key.enabled && (this.cooldowns.get(key.id) ?? 0) <= now).length,
      keys: all.map((key) => ({
        id: key.id,
        label: key.label,
        enabled: key.enabled,
        masked: maskKey(key.key),
        active: key.id === current?.id,
        cooldownUntil: this.cooldowns.get(key.id),
        environment: key.environment === true,
      })),
    }
  }

  async updateKeys(input) {
    if (!Array.isArray(input)) throw new Error('keys 必须是数组')
    if (input.length > 50) throw new Error('最多保存 50 个 Key')
    const current = await this.store.readDocument()
    const old = new Map((Array.isArray(current.keys) ? current.keys : []).map((entry) => [entry.id, entry]))
    const keys = input.map((entry, index) => {
      const id = typeof entry?.id === 'string' && entry.id ? entry.id : randomUUID()
      const previous = old.get(id)
      const provided = normalizedKey(entry?.key)
      const key = provided ?? normalizedKey(previous?.key)
      if (!key) throw new Error(`第 ${index + 1} 个 Key 为空`)
      return {
        id,
        label: typeof entry?.label === 'string' && entry.label.trim() ? entry.label.trim().slice(0, 80) : `Key ${index + 1}`,
        key,
        enabled: entry?.enabled !== false,
      }
    })
    await this.store.writeDocument({ ...current, keys })
    if (this.activeId && !keys.some((key) => key.id === this.activeId && key.enabled)) this.activeId = undefined
    for (const id of this.cooldowns.keys()) if (!keys.some((key) => key.id === id)) this.cooldowns.delete(id)
  }
}
