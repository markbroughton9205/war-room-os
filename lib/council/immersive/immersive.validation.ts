/** Immersive Council: truthful progress stars, planet status, scene model, XR readiness. */
import assert from 'node:assert/strict'
import { deriveProgressStars, roundPhaseFrom, type StarMissionInput } from './signals'
import { foundryPlanet, hvsPlanet, terraPlanet } from './planets'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildSceneModel, xrReadiness } from './scene'

let passed = 0
const ok = (name: string) => { passed += 1; console.log(`PASS ${name}`) }
const star = (stars: ReturnType<typeof deriveProgressStars>, id: string) => stars.find(s => s.id === id)

// 1. nothing running -> nothing glows
{
  const s = deriveProgressStars({ round: { phase: 'idle' } })
  assert.equal(s.length, 1); assert.equal(s[0].state, 'idle')
  ok('1: an idle Council produces one idle star and no activity')
}

// 2. round phases map to real states; a finished discussion is done, never verified; failure is failure
{
  assert.equal(star(deriveProgressStars({ round: { phase: 'deliberating', members: ['ORION', 'LUMEN'] } }), 'council')!.state, 'active')
  assert.match(star(deriveProgressStars({ round: { phase: 'deliberating', members: ['ORION', 'LUMEN'] } }), 'council')!.label, /ORION, LUMEN/)
  assert.equal(star(deriveProgressStars({ round: { phase: 'done' } }), 'council')!.state, 'done')
  const f = star(deriveProgressStars({ round: { phase: 'failed', reason: 'model backend unreachable' } }), 'council')!
  assert.equal(f.state, 'failed'); assert.match(f.label, /unreachable/)
  assert.equal(roundPhaseFrom({ loading: false, presence: 'idle', researchActive: false, failed: true, hasReply: false, failReason: 'x' }).phase, 'failed')
  assert.equal(roundPhaseFrom({ loading: true, presence: 'thinking', researchActive: false, failed: false, hasReply: false }).phase, 'deliberating')
  assert.equal(roundPhaseFrom({ loading: false, presence: 'idle', researchActive: false, failed: false, hasReply: true }).phase, 'done')
  assert.equal(roundPhaseFrom({ loading: true, presence: 'synthesizing', researchActive: false, failed: false, hasReply: false }).phase, 'synthesizing')
  ok('2: round phases come from observable state; done is never verified; failure is shown as failure')
}

// 3. research: verified needs completed status AND >=2 accepted; partial/failed stay partial/failed
{
  const base = { round: { phase: 'done' as const } }
  assert.equal(star(deriveProgressStars({ ...base, research: { active: true } }), 'research')!.state, 'active')
  assert.equal(star(deriveProgressStars({ ...base, research: { active: false, status: 'COMPLETED', accepted: 3, considered: 9 } }), 'research')!.state, 'verified')
  assert.equal(star(deriveProgressStars({ ...base, research: { active: false, status: 'COMPLETED', accepted: 1, considered: 9 } }), 'research')!.state, 'partial')
  assert.equal(star(deriveProgressStars({ ...base, research: { active: false, status: 'PARTIAL', accepted: 5, considered: 24 } }), 'research')!.state, 'partial')
  assert.equal(star(deriveProgressStars({ ...base, research: { active: false, status: 'FAILED', accepted: 0, considered: 12 } }), 'research')!.state, 'failed')
  assert.equal(star(deriveProgressStars({ ...base, research: null }), 'research'), undefined)
  ok('3: research is verified only when completed with enough accepted sources; partial and failed are never promoted')
}

// 4. missions: verified only with verifier exit 0 AND a verified receipt AND Foundry state COMPLETED
{
  const mk = (over: Partial<StarMissionInput>): StarMissionInput => ({ proposalId: 'p1', title: 'Fix add()', status: 'RUNNING', foundry: { missionId: 'msn-1', state: 'RUNNING' }, ...over })
  const get = (m: StarMissionInput) => deriveProgressStars({ round: { phase: 'idle' }, missions: [m] }).find(s => s.id === 'mission:p1')!
  assert.equal(get(mk({ status: 'PROPOSED', foundry: null })).state, 'pending')
  assert.match(get(mk({ status: 'PROPOSED', foundry: null })).label, /awaiting your approval/)
  assert.equal(get(mk({})).state, 'active')
  assert.match(get(mk({ foundry: { missionId: 'msn-1', state: 'VERIFYING' } })).label, /Verification underway/)
  assert.equal(get(mk({ status: 'INTERRUPTED' })).state, 'blocked')
  assert.equal(get(mk({ status: 'START_FAILED', foundry: null })).state, 'blocked')
  assert.equal(get(mk({ status: 'FAILED', foundry: { missionId: 'msn-1', state: 'FAILED' } })).state, 'failed')
  assert.equal(get(mk({ status: 'CANCELLED' })).state, 'blocked')
  const good = { missionId: 'msn-1', state: 'COMPLETED', verifierExit: 0, receiptVerified: true }
  assert.equal(get(mk({ status: 'COMPLETED', foundry: good })).state, 'verified')
  for (const bad of [{ ...good, verifierExit: 1 }, { ...good, verifierExit: null }, { ...good, receiptVerified: false }, { ...good, state: 'FAILED' }, undefined]) {
    assert.notEqual(get(mk({ status: 'COMPLETED', foundry: bad as never })).state, 'verified', JSON.stringify(bad))
  }
  assert.equal(deriveProgressStars({ round: { phase: 'idle' }, missions: [mk({ status: 'REJECTED' })] }).length, 1, 'rejected proposals draw no star')
  ok('4: a mission star is verified only with verifier exit 0, a verified receipt and Foundry state COMPLETED; every other state is shown as what it is')
}

// 5. computer ownership
{
  assert.match(star(deriveProgressStars({ round: { phase: 'idle' }, computer: { controlState: 'COMMANDER_CONTROL' } }), 'computer')!.label, /You hold/)
  assert.match(star(deriveProgressStars({ round: { phase: 'idle' }, computer: { controlState: 'AGENT_CONTROL', url: 'https://example.com' } }), 'computer')!.label, /Council computer open/)
  assert.equal(star(deriveProgressStars({ round: { phase: 'idle' }, computer: { controlState: 'CLOSED' } }), 'computer'), undefined)
  ok('5: the computer star states who holds control and disappears when the session is closed')
}

// 6. every star states its evidence
{
  const s = deriveProgressStars({ round: { phase: 'failed' }, research: { active: false, status: 'FAILED' }, missions: [{ proposalId: 'p', title: 't', status: 'PROPOSED' }], computer: { controlState: 'AGENT_CONTROL' } })
  for (const x of s) assert.ok(x.evidence.length > 5, x.id)
  ok('6: every star carries the record it is derived from')
}

// 7. planets are truthful
{
  const unread = foundryPlanet({ available: true, missions: null, reason: 'engine offline' })
  assert.equal(unread.health, 'UNAVAILABLE'); assert.match(unread.headline, /engine offline/); assert.equal(unread.activity, false)
  const idle = foundryPlanet({ available: true, missions: [] })
  assert.equal(idle.health, 'READY'); assert.equal(idle.activity, false)
  const running = foundryPlanet({ available: true, missions: [{ id: 'msn-1', title: 'x', state: 'RUNNING', liveness: 'ALIVE', progress: { stepsDone: 1, stepsTotal: 4 }, worker: { workerId: 'w1', heartbeatAgeSec: 3 } }] })
  assert.equal(running.health, 'ACTIVE'); assert.equal(running.activity, true); assert.ok(running.facts.some(f => /step 1\/4/.test(f)))
  const dead = foundryPlanet({ available: true, missions: [{ id: 'msn-2', title: 'x', state: 'RUNNING', liveness: 'DEAD' }] })
  assert.equal(dead.activity, false, 'a dead run is not activity')
  const proven = foundryPlanet({ available: true, missions: [{ id: 'm', title: 't', state: 'COMPLETED', verifierExit: 0, receiptVerified: true }, { id: 'n', title: 't', state: 'COMPLETED', verifierExit: 1, receiptVerified: true }] })
  assert.match(proven.facts.join(' '), /1 mission\(s\) completed with verifier exit 0/)
  const noTools = hvsPlanet({ projects: 3, jobs: [], toolsOk: false, toolsReason: 'missing: ffmpeg' })
  assert.equal(noTools.health, 'DEGRADED'); assert.match(noTools.facts.join(' '), /rendering cannot run/)
  const rendering = hvsPlanet({ projects: 3, jobs: [{ status: 'running', updatedAt: new Date().toISOString() }, { status: 'queued' }], toolsOk: true })
  assert.equal(rendering.health, 'ACTIVE'); assert.match(rendering.facts.join(' '), /1 running, 1 queued/)
  assert.equal(hvsPlanet({ projects: null, jobs: null, toolsOk: null, error: 'catalog unreadable' }).health, 'UNAVAILABLE')
  assert.equal(terraPlanet({ terra: { status: 'AVAILABLE', reasons: [] }, world: { status: 'AVAILABLE', reasons: [] } }).health, 'READY')
  assert.equal(terraPlanet({ terra: { status: 'AVAILABLE', reasons: [] }, world: { status: 'DEGRADED', reasons: ['imagery unreachable'] } }).health, 'DEGRADED')
  assert.equal(terraPlanet({ terra: null, world: null }).health, 'UNAVAILABLE')
  ok('7: planets report real activity only; unreadable sources are UNAVAILABLE; dead runs, unverified completions and missing tooling are not hidden')
}

// 8. scene model + XR readiness
{
  const scene = buildSceneModel()
  assert.equal(scene.seated, true); assert.equal(scene.locomotion, 'none')
  for (const p of scene.planets) { const d = Math.hypot(p.position.x, p.position.y - scene.eyeHeightM, p.position.z); assert.ok(d >= 2.5 && d <= 12, `${p.id} at a comfortable distance ${d.toFixed(1)}`) }
  assert.ok(scene.panels.every(p => p.distanceM >= 0.8 && p.distanceM <= 2.5), 'panels within reach/reading distance')
  assert.deepEqual(scene.planets.map(p => p.id).sort(), ['foundry', 'hvs', 'terra'])
  assert.equal(xrReadiness({ hasXr: false }).state, 'NOT_AVAILABLE')
  const r = xrReadiness({ hasXr: true, immersiveVrSupported: true })
  assert.equal(r.state, 'SUPPORTED_BY_BROWSER'); assert.match(r.note, /not been tested on a headset/i)
  assert.equal(xrReadiness({ hasXr: true, immersiveVrSupported: false }).state, 'NOT_AVAILABLE')
  ok('8: the scene model is seated, no-locomotion and comfort-bounded; XR readiness never claims headset acceptance')
}

// 9. review findings: stale/unconfirmed activity, research wording, pending requests
{
  const stalled = foundryPlanet({ available: true, missions: [{ id: 'm', title: 't', state: 'RUNNING', liveness: 'STALLED' }] })
  assert.equal(stalled.activity, false); assert.equal(stalled.health, 'DEGRADED'); assert.match(stalled.headline, /stalled/)
  const queued = foundryPlanet({ available: true, missions: [{ id: 'm', title: 't', state: 'QUEUED', liveness: null }] })
  assert.equal(queued.activity, false); assert.match(queued.headline, /queued, none running/)
  const unchecked = foundryPlanet({ available: true, missions: [{ id: 'm', title: 't', state: 'COMPLETED', verifierExit: 0, receiptVerified: false, receiptChecked: false }] })
  assert.match(unchecked.items[0].detail, /not checked/)
  const now = Date.parse('2026-10-16T12:00:00Z')
  const staleJob = hvsPlanet({ now, projects: 1, jobs: [{ status: 'running', updatedAt: '2026-10-16T09:00:00Z' }], toolsOk: true })
  assert.equal(staleJob.activity, false); assert.match(staleJob.facts.join(' '), /unconfirmed/)
  const freshJob = hvsPlanet({ now, projects: 1, jobs: [{ status: 'running', updatedAt: '2026-10-16T11:58:00Z' }], toolsOk: true })
  assert.equal(freshJob.activity, true)
  assert.equal(hvsPlanet({ now, projects: 2, jobs: null, toolsOk: null }).health, 'DEGRADED')
  assert.equal(hvsPlanet({ now, projects: 2, jobs: [], toolsOk: null }).health, 'DEGRADED')
  const base = { round: { phase: 'done' as const } }
  const resp = star(deriveProgressStars({ ...base, research: { active: false, status: 'RESPONDED', responded: 3 } }), 'research')!
  assert.equal(resp.state, 'partial'); assert.match(resp.label, /not independently checked/)
  assert.equal(star(deriveProgressStars({ ...base, research: { active: false, status: 'UNAVAILABLE' } }), 'research')!.state, 'blocked')
  const req = star(deriveProgressStars({ ...base, pendingRequests: 2 }), 'requests')!
  assert.equal(req.state, 'pending'); assert.match(req.label, /2 Council requests waiting for you/)
  assert.equal(star(deriveProgressStars({ ...base, pendingRequests: 0 }), 'requests'), undefined)
  ok('9: stalled/queued/stale/unreadable sources never light a planet; research "responded" is not "accepted"; pending Council requests get a star')
}

// 10. every planet link points at a route that exists in the app (a 404 from the Foundry planet was caused by a hard-coded /foundry)
{
  const root = process.cwd()
  const pageFor = (href: string) => path.join(root, 'app', href.replace(/^\//, ''), 'page.tsx')
  const planets = [
    foundryPlanet({ available: true, missions: [] }),
    hvsPlanet({ projects: 0, jobs: [], toolsOk: true }),
    terraPlanet({ terra: { status: 'AVAILABLE', reasons: [] }, world: { status: 'AVAILABLE', reasons: [] } }),
  ]
  for (const p of planets) assert.ok(existsSync(pageFor(p.href)), `${p.id} planet link ${p.href} must be an existing page`)
  assert.equal(planets[0].href, '/war-room/engineering')
  ok('10: every planet link resolves to an existing page; Foundry opens /war-room/engineering')
}

console.log(`\n${passed}/10 immersive council validations passed`)
assert.equal(passed, 10)
