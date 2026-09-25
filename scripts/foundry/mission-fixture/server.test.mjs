import assert from 'node:assert/strict'
import test from 'node:test'
import { LABEL } from './server.mjs'

test('fixture status label is FOUNDRY READY until a mission changes it', () => {
  assert.equal(LABEL, 'FOUNDRY READY')
})
