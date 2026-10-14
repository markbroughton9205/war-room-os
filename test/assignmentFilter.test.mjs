import { test } from 'node:test'
import assert from 'node:assert'
import { rowState, filterRows, stateCounts } from '../lib/agents/ops/assignmentFilter.mjs'

test('[C1] rowState returns state from last segment', () => {
  assert.strictEqual(rowState({ title: 'Task · RUNNING' }), 'RUNNING')
  assert.strictEqual(rowState({ title: 'Task · CANCEL_REQUESTED' }), 'CANCEL_REQUESTED')
  assert.strictEqual(rowState({ title: 'Task · UNKNOWN' }), 'UNKNOWN')
  assert.strictEqual(rowState({ title: 'Task · ' }), 'UNKNOWN')
  assert.strictEqual(rowState({ title: '' }), 'UNKNOWN')
  assert.strictEqual(rowState({}), 'UNKNOWN')
  assert.strictEqual(rowState(null), 'UNKNOWN')
})

test('[C1] rowState separator rule', () => {
  assert.strictEqual(rowState({ title: 'Task · RUNNING' }), 'RUNNING')
  assert.strictEqual(rowState({ title: 'RUNNING' }), 'UNKNOWN')
  assert.strictEqual(rowState({ title: 'Task · running' }), 'UNKNOWN')
  assert.strictEqual(rowState({ title: 'Task · RUNNING_UNDERSCORE' }), 'RUNNING_UNDERSCORE')
  assert.strictEqual(rowState({ title: 'Task · RUNNING·' }), 'UNKNOWN')
})

test('[C2] filterRows by state', () => {
  const rows = [
    { title: 'Task · RUNNING', detail: 'details' },
    { title: 'Task · STOPPED', detail: 'details' },
    { title: 'Task · RUNNING', detail: 'details' }
  ]
  assert.strictEqual(filterRows(rows, { state: 'RUNNING' }).length, 2)
  assert.strictEqual(filterRows(rows, { state: 'STOPPED' }).length, 1)
  assert.strictEqual(filterRows(rows, { state: 'ALL' }).length, 3)
  assert.strictEqual(filterRows(rows, {}).length, 3)
  assert.strictEqual(filterRows(rows, { state: '' }).length, 3)
  assert.strictEqual(filterRows([], { state: 'RUNNING' }).length, 0)
  assert.strictEqual(filterRows(null, { state: 'RUNNING' }).length, 0)
})

test('[C2] filterRows by text alone', () => {
  const rows = [
    { title: 'Task · RUNNING', detail: 'details' },
    { title: 'Task · STOPPED', detail: 'details' },
    { title: 'Task · RUNNING', detail: 'details' }
  ]
  assert.strictEqual(filterRows(rows, { text: 'task' }).length, 3)
  assert.strictEqual(filterRows(rows, { text: 'RUNNING' }).length, 2)
  assert.strictEqual(filterRows(rows, { text: 'details' }).length, 3)
  assert.strictEqual(filterRows(rows, { text: 'STOPPED' }).length, 1)
  assert.strictEqual(filterRows(rows, { text: 'unknown' }).length, 0)
})

test('[C2] filterRows by state and text together', () => {
  const rows = [
    { title: 'Task · RUNNING', detail: 'details' },
    { title: 'Task · STOPPED', detail: 'details' },
    { title: 'Task · RUNNING', detail: 'details' }
  ]
  assert.strictEqual(filterRows(rows, { state: 'RUNNING', text: 'task' }).length, 2)
  assert.strictEqual(filterRows(rows, { state: 'RUNNING', text: 'STOPPED' }).length, 0)
  assert.strictEqual(filterRows(rows, { state: 'STOPPED', text: 'details' }).length, 1)
  assert.strictEqual(filterRows(rows, { state: 'ALL', text: 'RUNNING' }).length, 2)
})

test('[C2] filterRows preserves order and does not modify input', () => {
  const rows = [
    { title: 'Task 1 · RUNNING', detail: 'details 1' },
    { title: 'Task 2 · STOPPED', detail: 'details 2' },
    { title: 'Task 3 · RUNNING', detail: 'details 3' }
  ]
  const filtered = filterRows(rows, { state: 'RUNNING' })
  assert.strictEqual(filtered[0].title, 'Task 1 · RUNNING')
  assert.strictEqual(filtered[1].title, 'Task 3 · RUNNING')
  assert.strictEqual(rows.length, 3)
})

test('[C3] stateCounts returns counts per state', () => {
  const rows = [
    { title: 'Task · RUNNING', detail: 'details' },
    { title: 'Task · STOPPED', detail: 'details' },
    { title: 'Task · RUNNING', detail: 'details' }
  ]
  const counts = stateCounts(rows)
  assert.strictEqual(counts.RUNNING, 2)
  assert.strictEqual(counts.STOPPED, 1)
  assert.strictEqual(Object.keys(counts).length, 2)
  assert.strictEqual(Object.keys(stateCounts([])).length, 0)
})
