import assert from 'node:assert/strict'
import { test } from 'node:test'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { DEFAULT_CONFIG_PATH, DSH_HOME_ENV, resolveDshHome } from '../lib/config.mjs'

const fallback = join(homedir(), '.dsh')

test('the DSH home override wins over the OS home', () => {
  assert.equal(resolveDshHome({ [DSH_HOME_ENV]: 'D:/scratch/dsh-home' }), resolve('D:/scratch/dsh-home'))
})

test('an empty or whitespace-only override counts as unset', () => {
  assert.equal(resolveDshHome({ [DSH_HOME_ENV]: '' }), fallback)
  assert.equal(resolveDshHome({ [DSH_HOME_ENV]: '   ' }), fallback)
  assert.equal(resolveDshHome({}), fallback)
})

test('the key store lives directly inside the resolved DSH home', () => {
  assert.equal(DEFAULT_CONFIG_PATH, join(fallback, 'dsh-opencode-go-rotation.json'))
})
