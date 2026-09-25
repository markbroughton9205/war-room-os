import assert from 'node:assert/strict'
import test from 'node:test'
import { ACTUAL_STATUS } from './status-source.mjs'
import { html } from './app.mjs'

test('replan fixture status comes from status-source', () => {
  assert.equal(ACTUAL_STATUS, 'FIXED')
  assert.match(html(), />FIXED</)
})
