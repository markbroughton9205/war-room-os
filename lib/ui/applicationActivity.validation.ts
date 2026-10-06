import assert from 'node:assert/strict'

import { deriveApplicationActivity } from './applicationActivity'

const home = deriveApplicationActivity('/', true, true)
assert.equal(home.mode, 'HOME_ACTIVE')
assert.equal(home.animationFps, 15)
assert.equal(home.pollingMultiplier, 1)

const terra = deriveApplicationActivity('/terra', true, true)
assert.equal(terra.mode, 'TERRA_ACTIVE')
assert.equal(terra.animationFps, 30)

const foundry = deriveApplicationActivity('/war-room/engineering', true, true)
assert.equal(foundry.mode, 'FOUNDRY_ACTIVE')

const unfocused = deriveApplicationActivity('/', true, false)
assert.equal(unfocused.mode, 'HOME_ACTIVE')
assert.equal(unfocused.animationFps, 4)
assert.equal(unfocused.pollingMultiplier, 2)

const hidden = deriveApplicationActivity('/terra', false, false)
assert.equal(hidden.mode, 'BACKGROUND_IDLE')
assert.equal(hidden.animationFps, 0)
assert.equal(hidden.pollingMultiplier, 4)

console.log(JSON.stringify({ ok: true, home, terra, foundry, unfocused, hidden }))
