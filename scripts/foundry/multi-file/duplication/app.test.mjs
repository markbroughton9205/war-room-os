import assert from 'node:assert/strict'
import test from 'node:test'
import { greet as greetAlpha } from './alpha.mjs'
import { greet as greetBeta } from './beta.mjs'
import { greet as greetGamma } from './gamma.mjs'

test('duplicated greet callers all present READY', () => {
  assert.equal(greetAlpha(), 'READY')
  assert.equal(greetBeta(), 'READY')
  assert.equal(greetGamma(), 'READY')
})
