import assert from 'node:assert/strict'
import test from 'node:test'
import { greeting, STATUS } from './app.mjs'

test('engineering-depth greeting presents SYSTEM GO', () => {
  assert.equal(STATUS, 'SYSTEM GO')
  assert.equal(greeting(), 'SYSTEM GO')
})
