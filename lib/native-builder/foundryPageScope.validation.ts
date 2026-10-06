import assert from 'node:assert/strict'
import { missionForSelectedPage, currentWorkForSelectedPage } from './foundryPageScope'
const old = { id: 'old', status: 'BLOCKED' }
assert.equal(missionForSelectedPage(old, null), null)
assert.equal(missionForSelectedPage(old, 'new'), null)
assert.equal(missionForSelectedPage(old, 'old'), old)
const work = { missionId: 'old', workspaceId: 'a', status: 'BLOCKED' }
assert.equal(currentWorkForSelectedPage(work, { missionId: null, workspaceId: 'b', sessionId: 'fresh' }), null)
assert.equal(currentWorkForSelectedPage(work, { missionId: 'new', workspaceId: 'a', sessionId: 'fresh' }), null)
assert.equal(currentWorkForSelectedPage(work, { missionId: 'old', workspaceId: 'a', sessionId: 'existing' }), work)
assert.equal(currentWorkForSelectedPage(work, { missionId: null, workspaceId: 'b', sessionId: null }), null)
assert.equal(currentWorkForSelectedPage(work, { missionId: null, workspaceId: 'a', sessionId: null }), work)
assert.equal(currentWorkForSelectedPage(work, { missionId: null, workspaceId: null, sessionId: null }), work)
console.log('PASS: nine page-selection cases; historical blockers preserved, fresh pages isolated')
