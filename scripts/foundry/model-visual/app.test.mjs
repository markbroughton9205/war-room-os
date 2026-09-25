import assert from 'node:assert/strict'
import test from 'node:test'
import { STATUS_STYLE, html } from './app.mjs'

test('visual fixture visibly renders the status', () => {
  assert.equal(STATUS_STYLE, 'opacity:1')
  assert.match(html(), /SYSTEM NOMINAL/)
})
