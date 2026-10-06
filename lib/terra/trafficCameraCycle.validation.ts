import { adjacentTrafficCamera } from './trafficCameraCycle'

type Camera = { id: string; layerId: string; media: string; observedAt: string }
const sequence: Camera[] = [
  { id: 'A', layerId: 'provider', media: 'a.jpg', observedAt: '2026-09-19T10:00:00Z' },
  { id: 'B', layerId: 'provider', media: 'b.jpg', observedAt: '2026-09-19T10:01:00Z' },
  { id: 'C', layerId: 'provider', media: 'c.jpg', observedAt: '2026-09-19T10:02:00Z' },
]

let current = sequence[1]
const transitions: string[] = [current.id]
for (const offset of [1, -1, -1, 1] as const) {
  const next = adjacentTrafficCamera(sequence, current, offset)
  if (!next) throw new Error(`Missing adjacent camera from ${current.id} offset ${offset}`)
  current = next
  transitions.push(current.id)
}

const expected = 'B>C>B>A>B'
const actual = transitions.join('>')
const noWrapPrevious = adjacentTrafficCamera(sequence, sequence[0], -1) === null
const noWrapNext = adjacentTrafficCamera(sequence, sequence[2], 1) === null
const mediaChangedExactlyOnce = new Set(sequence.map(camera => `${camera.media}:${camera.observedAt}`)).size === 3

console.log(`${actual === expected ? 'PASS' : 'FAIL'} previous_next_sequence ${actual}`)
console.log(`${noWrapPrevious && noWrapNext ? 'PASS' : 'FAIL'} no_unintended_wrap previous=${noWrapPrevious} next=${noWrapNext}`)
console.log(`${mediaChangedExactlyOnce ? 'PASS' : 'FAIL'} distinct_camera_media_and_timestamps`)

if (actual !== expected || !noWrapPrevious || !noWrapNext || !mediaChangedExactlyOnce) process.exit(1)
