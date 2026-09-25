import assert from 'node:assert/strict'
import test from 'node:test'
import { STATUS } from './app.mjs'

test('stale-expect fixture still asserts the old greeting', () => {
  assert.equal(STATUS, 'SYSTEM RDY')
})
