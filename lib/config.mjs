import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_CONFIG_PATH = join(homedir(), '.dsh', 'dsh-opencode-go-rotation.json')
export const DEFAULT_BASE_URL = 'https://opencode.ai/zen/go'
export const DEFAULT_REFRESH_SECONDS = 300

export class RotationConfigStore {
  constructor(path = DEFAULT_CONFIG_PATH) { this.path = path }
  async readDocument() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'))
      return value && typeof value === 'object' ? value : {}
    } catch { return {} }
  }
  async writeDocument(document) {
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    try { await chmod(this.path, 0o600) } catch { /* Windows ACLs do not map to POSIX mode bits. */ }
  }
  async get() {
    const doc = await this.readDocument()
    return {
      baseUrl: typeof doc.baseUrl === 'string' && doc.baseUrl ? doc.baseUrl : DEFAULT_BASE_URL,
      refreshSeconds: Number.isFinite(doc.refreshSeconds) ? Math.max(30, Math.round(doc.refreshSeconds)) : DEFAULT_REFRESH_SECONDS,
      enabled: doc.enabled !== false,
    }
  }
  async update(patch) {
    const current = await this.readDocument()
    const next = { ...current }
    if (typeof patch?.baseUrl === 'string' && patch.baseUrl.trim()) next.baseUrl = patch.baseUrl.trim()
    if (patch?.refreshSeconds !== undefined && Number.isFinite(Number(patch.refreshSeconds))) next.refreshSeconds = Math.max(30, Math.round(Number(patch.refreshSeconds)))
    if (patch?.enabled !== undefined) next.enabled = Boolean(patch.enabled)
    await this.writeDocument(next)
  }
}
