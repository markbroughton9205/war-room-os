import assert from 'node:assert/strict'
import test from 'node:test'
import { html, STATUS } from './app.mjs'

test('tool-choice fixture presents OMEGA', () => {
  assert.equal(STATUS, 'OMEGA')
  assert.match(html(), />OMEGA</)
})
