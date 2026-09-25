import assert from 'node:assert/strict'
import test from 'node:test'
import { status } from './status.mjs'

test('status happy path presents READY', () => {
  assert.equal(status('READY'), 'READY')
})

test('status empty and null collapse to EMPTY', () => {
  assert.equal(status(null), 'EMPTY')
  assert.equal(status('   '), 'EMPTY')
})
