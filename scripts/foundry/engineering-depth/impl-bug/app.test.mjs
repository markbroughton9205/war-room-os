import assert from 'node:assert/strict'
import test from 'node:test'
import { STATUS } from './app.mjs'

test('impl-bug fixture expects the correct greeting', () => {
  assert.equal(STATUS, 'SYSTEM READY')
})
