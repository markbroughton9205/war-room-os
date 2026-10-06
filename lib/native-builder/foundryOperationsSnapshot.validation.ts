import assert from 'node:assert/strict'
import { createOperationsSnapshotReader } from './foundryOperationsSnapshot'
let release!: () => void
let calls = 0
let barrier = new Promise<void>(resolve => { release = resolve })
const read = createOperationsSnapshotReader(async view => {
  calls++
  await barrier
  return { view, revision: calls }
})
const overlapping = Array.from({length: 5}, () => read('commander'))
await Promise.resolve()
assert.equal(calls, 1)
assert.ok(overlapping.every(p => p === overlapping[0]))
const history = read('history')
await Promise.resolve()
assert.equal(calls, 2)
release()
assert.ok((await Promise.all(overlapping)).every(v => v.view === 'commander'))
assert.equal((await history).view, 'history')
await read('commander')
assert.equal(calls, 3, 'completed snapshots must never be cached')
let failures = 0
const fails = createOperationsSnapshotReader(async () => { failures++; throw Error('read failed') })
const a = fails('commander'), b = fails('commander')
assert.equal(a,b)
await assert.rejects(a,/read failed/)
await assert.rejects(fails('commander'),/read failed/)
assert.equal(failures,2,'failed read must allow a fresh next request')
console.log('PASS: overlapping reads, view isolation, fresh subsequent reads, failure recovery')
