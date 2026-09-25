import assert from 'node:assert/strict'
import test from 'node:test'
import { formatLabel } from './format.mjs'
import { labelA } from './caller-a.mjs'
import { labelB } from './caller-b.mjs'
import { labelC } from './caller-c.mjs'

test('formatLabel object contract is used by all callers', () => {
  assert.equal(formatLabel({ name: 'X' }), 'ITEM:X')
  assert.equal(labelA(), 'ITEM:A')
  assert.equal(labelB(), 'ITEM:B')
  assert.equal(labelC(), 'ITEM:C')
})
