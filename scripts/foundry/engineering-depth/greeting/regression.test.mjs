import assert from 'node:assert/strict'
import test from 'node:test'
import { STATUS } from './app.mjs'

test('engineering-depth greeting regression keeps SYSTEM prefix', () => {
  assert.match(STATUS, /^SYSTEM\b/)
})
