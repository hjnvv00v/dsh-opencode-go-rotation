import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_COOLDOWN_MS, cooldownMsFromUsage } from '../lib/key-manager.mjs'

test('uses the rolling reset when it is the exhausted window', () => {
  const cooldown = cooldownMsFromUsage({ windows: [
    { key: 'rolling', percent: 100, resetsInSeconds: 1800 },
    { key: 'weekly', percent: 42, resetsInSeconds: 200000 },
    { key: 'monthly', percent: 12, resetsInSeconds: 900000 },
  ] })
  assert.equal(cooldown, 1800 * 1000)
})

test('uses the latest reset when multiple windows are exhausted', () => {
  const cooldown = cooldownMsFromUsage({ windows: [
    { key: 'rolling', percent: 100, resetsInSeconds: 1800 },
    { key: 'weekly', percent: 100, resetsInSeconds: 7200 },
    { key: 'monthly', status: 'quota_exceeded', resetsInSeconds: 3600 },
  ] })
  assert.equal(cooldown, 7200 * 1000)
})

test('falls back to five hours without reliable exhausted-window data', () => {
  assert.equal(cooldownMsFromUsage({ windows: [] }), DEFAULT_COOLDOWN_MS)
  assert.equal(cooldownMsFromUsage({ windows: [
    { key: 'rolling', percent: 80, resetsInSeconds: 1800 },
  ] }), DEFAULT_COOLDOWN_MS)
})
