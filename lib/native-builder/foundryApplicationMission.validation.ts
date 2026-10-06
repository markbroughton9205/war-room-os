/** Contract/gate regression tests. These are NOT P7 application-build acceptance proofs. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runWithWorkspaceRoot } from '../repo/workspaceContext'
import { buildRepoMap } from './repoMap'
import { applicationSourceSnapshot, reviewApplicationBuild } from './foundryApplicationReview'
import { applicationCompletionMissing, deriveApplicationMission, initialApplicationBuildState } from './foundryApplicationMission'

async function isolated(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'foundry-application-contract-'))
  try { await runWithWorkspaceRoot(root, () => run(root)) } finally { await rm(root, { recursive: true, force: true }) }
}

test('derive the contract from an actual empty directory and preserve the goal', async () => isolated(async () => {
  const map = await buildRepoMap()
  const goal = 'Build a CLI reading log with file-backed persistence.'
  const contract = deriveApplicationMission({ missionId: 'contract-test', goal, map })
  assert.equal(contract.existingOrGreenfield, 'greenfield')
  assert.equal(contract.commanderGoal, goal)
  assert.equal(contract.projectType, 'cli')
  assert.deepEqual(contract.runtimeRequirements, ['cli', 'persistence', 'restart', 'shutdown'])
  assert.ok(contract.acceptanceCriteria.includes(goal))
  assert.ok(applicationCompletionMissing(initialApplicationBuildState(contract), true).length > 0)
}))

test('existing framework and explicit acceptance survive inspection', async () => isolated(async root => {
  // Real configuration data; no framework or runtime is simulated.
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.2.4' } }))
  const contract = deriveApplicationMission({ missionId: 'contract-test', goal: 'Extend the web UI and HTTP API.', map: await buildRepoMap(), acceptanceCriteria: ['Reject malformed input.'], packageManager: 'npm' })
  assert.equal(contract.existingOrGreenfield, 'existing')
  assert.equal(contract.framework, 'react')
  assert.equal(contract.packageManager, 'npm')
  assert.ok(contract.acceptanceCriteria.includes('Reject malformed input.'))
  assert.ok(contract.runtimeRequirements.includes('ui'))
  assert.ok(contract.runtimeRequirements.includes('api'))
}))

test('Phase 6 rejects green tests without runtime evidence on actual product source', async () => {
  const source = await readFile(new URL('./foundryApplicationMission.ts', import.meta.url), 'utf8')
  await isolated(async root => {
    await writeFile(path.join(root, 'foundryApplicationMission.ts'), source)
    const contract = deriveApplicationMission({ missionId: 'contract-test', goal: 'Derive an application mission.', map: await buildRepoMap() })
    const state = initialApplicationBuildState(contract)
    state.sourceDigest = (await applicationSourceSnapshot()).digest
    state.testedDigest = state.sourceDigest
    const review = await reviewApplicationBuild(state, true, ['foundryApplicationMission.ts'])
    assert.equal(review.state.phase6?.complete, false)
    assert.ok(review.independentVerdict.findings.some(f => f.claim.includes('acceptance contract')))
    assert.ok(review.state.missing.some(s => s.includes('Runtime evidence')))
    assert.ok(review.state.missing.some(s => s.includes('shutdown')))
  })
})

test('real source mutations invalidate previous test identity and review generation', async () => {
  const source = await readFile(new URL('./foundryApplicationMission.ts', import.meta.url), 'utf8')
  await isolated(async root => {
    const file = path.join(root, 'foundryApplicationMission.ts')
    await writeFile(file, source)
    const state = initialApplicationBuildState(deriveApplicationMission({ missionId: 'contract-test', goal: 'Derive an application mission.', map: await buildRepoMap() }))
    state.sourceDigest = (await applicationSourceSnapshot()).digest
    state.testedDigest = state.sourceDigest
    await writeFile(file, source.replace("if (!state.sourceDigest)", 'if (false)'))
    const reviewed = await reviewApplicationBuild(state, true, ['foundryApplicationMission.ts'])
    assert.equal(reviewed.state.generation, 1)
    assert.notEqual(reviewed.state.sourceDigest, reviewed.state.testedDigest)
    assert.ok(reviewed.state.missing.some(s => s.includes('Real tests')))
    assert.equal(reviewed.state.phase6?.complete, false)
  })
})

test('unreadable source cannot silently disappear from the acceptance snapshot', async () => isolated(async root => {
  await writeFile(path.join(root, 'large.js'), 'x'.repeat(513 * 1024))
  await assert.rejects(applicationSourceSnapshot(), /cannot read/)
}))

test('the latest failed runtime observation supersedes an older passing observation', async () => isolated(async () => {
  const state = initialApplicationBuildState(deriveApplicationMission({ missionId: 'contract-test', goal: 'Build a CLI.', map: await buildRepoMap() }))
  state.sourceDigest = (await applicationSourceSnapshot()).digest
  state.testedDigest = state.sourceDigest
  // Controlled inputs to the real gate; these are not application acceptance receipts.
  state.runtimeEvidence = [
    { kind: 'cli', sourceDigest: state.sourceDigest, evidenceRef: 'earlier-observation', passed: true, criteria: state.contract.acceptanceCriteria },
    { kind: 'cli', sourceDigest: state.sourceDigest, evidenceRef: 'later-observation', passed: false, criteria: [] },
  ]
  assert.ok(applicationCompletionMissing(state, true).some(s => s.includes('Real cli verification')))
}))
