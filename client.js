window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-rotation',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement
    const API = '/api/dsh-opencode-go-rotation'
    const css = {
      wrap: { boxSizing: 'border-box', order: 3, width: 'min(900px, 100%)', maxWidth: '900px', margin: '0 auto', padding: '4px 8px 0', textAlign: 'center', fontSize: 12, color: 'var(--dsw-alias-label-secondary, #61666b)' },
      badge: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '3px 8px', fontSize: 12 },
      card: { border: '1px solid var(--dsw-alias-border-l2, #ddd)', background: 'var(--dsw-alias-bg-module-platform, #fff)', borderRadius: 8, padding: 12, color: 'var(--dsw-alias-label-primary, #111)' },
      top: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
      button: { border: '1px solid var(--dsw-alias-border-l2, #ddd)', background: 'transparent', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: 'inherit' },
      row: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', minWidth: 0 },
      bar: { height: 6, flex: 1, background: 'var(--dsw-alias-border-l2, #ddd)', borderRadius: 4, overflow: 'hidden' },
      input: { minWidth: 0, flex: 1, padding: '4px 6px', border: '1px solid var(--dsw-alias-border-l2, #ddd)', borderRadius: 4, color: 'inherit', background: 'transparent' },
      config: { borderTop: '1px solid var(--dsw-alias-border-l2, #ddd)', marginTop: 8, paddingTop: 8 },
      error: { color: 'var(--dsw-alias-danger, #c33)', marginTop: 6 },
    }
    async function request(path, options) {
      const response = await fetch(`${API}${path}`, { cache: 'no-store', ...options })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      return data
    }
    function remaining(seconds) {
      if (!Number.isFinite(seconds)) return '重置时间未知'
      if (seconds <= 0) return '已重置'
      const minutes = Math.floor(seconds / 60)
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor(minutes % 1440 / 60)
      const restMinutes = minutes % 60
      const parts = []
      if (days) parts.push(`${days}天`)
      if (hours) parts.push(`${hours}小时`)
      if (!days && restMinutes) parts.push(`${restMinutes}分钟`)
      return `${parts.join(' ') || '不到1分钟'}后重置`
    }
    function Usage() {
      const [expanded, setExpanded] = React.useState(false)
      const [usage, setUsage] = React.useState()
      const [state, setState] = React.useState()
      const [error, setError] = React.useState()
      const [saving, setSaving] = React.useState(false)
      const [draft, setDraft] = React.useState([])
      const draftInitialized = React.useRef(false)
      const previousActiveKey = React.useRef()
      const refreshUsage = React.useCallback(async () => {
        try {
          const snapshot = await request('/usage')
          setUsage(snapshot.ok ? snapshot.data : undefined)
          setError(snapshot.ok ? undefined : snapshot.error)
        } catch (e) { setError(e.message) }
      }, [])
      const refreshState = React.useCallback(async (resetDraft = false) => {
        try {
          const info = await request('/state')
          const next = info.data
          const activeChanged = previousActiveKey.current !== undefined && previousActiveKey.current !== next.activeKeyId
          previousActiveKey.current = next.activeKeyId
          setState(next)
          if (resetDraft || !draftInitialized.current) {
            setDraft((next.keys || []).map((key) => ({ id: key.id, label: key.label, enabled: key.enabled, masked: key.masked, key: '' })))
            draftInitialized.current = true
          }
          if (activeChanged) void refreshUsage()
        } catch (e) { setError(e.message) }
      }, [refreshUsage])
      const load = React.useCallback(async (resetDraft = false) => {
        await Promise.all([refreshState(resetDraft), refreshUsage()])
      }, [refreshState, refreshUsage])
      React.useEffect(() => { load(true) }, [load])
      React.useEffect(() => {
        const timer = setInterval(() => { void refreshState() }, 5000)
        return () => clearInterval(timer)
      }, [refreshState])
      React.useEffect(() => {
        if (!state?.refreshSeconds) return undefined
        const timer = setInterval(() => { void refreshUsage() }, state.refreshSeconds * 1000)
        return () => clearInterval(timer)
      }, [refreshUsage, state?.refreshSeconds])
      const save = async () => {
        setSaving(true); setError(undefined)
        try {
          await request('/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keys: draft.map(({ masked, ...key }) => key) }) })
          await load(true)
        } catch (e) { setError(e.message) } finally { setSaving(false) }
      }
      const active = state || usage?.active
      const summary = usage?.windows?.map((item) => `${({ rolling: '滚动用量', weekly: '每周用量', monthly: '每月用量' })[item.key] || item.key} ${item.percent ?? '?'}%`).join(' · ')
      const caption = active?.activeKeyLabel ? `OpenCode Go · ${active.activeKeyLabel} · ${summary || '用量加载中'}` : 'OpenCode Go · 未配置 Key'
      const update = (index, patch) => setDraft((list) => list.map((entry, item) => item === index ? { ...entry, ...patch } : entry))
      return h('div', { style: css.wrap },
        h('button', { style: css.badge, title: '查看 OpenCode Go 当前 Key 用量及轮询配置', onClick: () => setExpanded(!expanded) }, caption),
        expanded && h('div', { style: css.card },
          h('div', { style: css.top }, h('strong', { style: { flex: 1 } }, 'OpenCode Go 当前 Key 用量'), h('button', { style: css.button, onClick: load }, '刷新'), h('button', { style: css.button, onClick: () => setExpanded(false) }, '收起')),
          active && h('div', null, `当前使用：${active.activeKeyLabel || '无'}，可用 Key ${active.availableKeyCount ?? 0}/${active.keyCount ?? 0}`),
          usage?.windows?.map((item) => h('div', { style: css.row, key: item.key }, h('span', { style: { width: 88, textAlign: 'left' } }, ({ rolling: '滚动用量', weekly: '每周用量', monthly: '每月用量' })[item.key] || item.key), h('div', { style: css.bar }, h('div', { style: { height: '100%', width: `${item.percent ?? 0}%`, background: item.percent >= 90 ? '#d34b4b' : '#3b8c6e' } })), h('span', { style: { width: 42, textAlign: 'right' } }, item.percent === null ? '?' : `${item.percent}%`), h('span', { style: { width: 110, fontSize: 11 } }, remaining(item.resetsInSeconds)))),
          error && h('div', { style: css.error }, error),
          h('div', { style: css.config }, h('strong', null, '轮询 Key'),
            draft.map((entry, index) => h('div', { style: css.row, key: entry.id || index }, h('input', { style: { ...css.input, maxWidth: 115 }, value: entry.label, placeholder: `Key ${index + 1}`, onChange: (e) => update(index, { label: e.target.value }) }), h('input', { style: css.input, value: entry.key, placeholder: entry.masked ? '已保存，留空保持不变' : '粘贴 API Key', type: 'password', onChange: (e) => update(index, { key: e.target.value }) }), h('label', null, h('input', { type: 'checkbox', checked: entry.enabled, onChange: (e) => update(index, { enabled: e.target.checked }) }), '启用'), h('button', { style: css.button, onClick: () => setDraft((list) => list.filter((_, item) => item !== index)) }, '删除'))),
            h('div', { style: css.row }, h('button', { style: css.button, onClick: () => setDraft((list) => [...list, { label: `Key ${list.length + 1}`, enabled: true, key: '' }]) }, '添加 Key'), h('button', { style: css.button, disabled: saving, onClick: save }, saving ? '保存中' : '保存 Key 列表')))
        )
      )
    }
    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'opencode-go-rotation', order: 200, inject: () => ({}) }, Usage)), 'opencode-go-rotation: usage dock')
    }
    module.exports = { inject: ['slots'], apply, Usage }
    return module.exports
  }
})
