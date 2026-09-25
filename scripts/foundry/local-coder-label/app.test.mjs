import assert from 'node:assert/strict'
import test from 'node:test'
import { html, STATUS } from './app.mjs'

test('local coder fixture presents LOCAL_CODER_BETA', () => {
  assert.equal(STATUS, 'LOCAL_CODER_BETA')
  assert.match(html(), />LOCAL_CODER_BETA</)
})
