import assert from 'node:assert/strict'
import { interpretCommanderRequest, requestWithoutProhibitions, correctLegacyMissionIntent } from './foundryMissionPlanner'
const coding = 'Fix add in calc.mjs and run npm test. Do not change tests or package.json. Do not commit, push, deploy, install anything or spend money.'
assert.equal(interpretCommanderRequest(coding).kind, 'fixture')
assert.equal(interpretCommanderRequest('Fix calc.mjs and verify package.json stays unchanged.').kind, 'fixture')
for (const prefix of ['Do not install anything.', "Don't deploy the application.", 'Never package the app.', 'No install allowed.']) {
  assert.equal(interpretCommanderRequest(prefix + ' Fix calc.mjs and run tests.').kind, 'fixture')
}
for (const request of ['Install the runtime.', 'Package the app.', 'Activate the installed app.', 'Build the production runtime.', 'Do not change tests. Install the runtime.', 'Do not push, but install the runtime.']) {
  assert.equal(interpretCommanderRequest(request).kind, 'application', request)
}
assert.match(requestWithoutProhibitions('Do not change package.json. Install the runtime.'), /Install the runtime/)
assert.equal(interpretCommanderRequest('Fix the War Room header. Do not install anything.').kind, 'application')
console.log('PASS negative governance and package.json do not request installation; affirmative installation and War Room lanes preserved')

for (const prefix of ['Without installing anything.', 'No installation permitted.', 'Not installing the app.', 'Must not install.', 'Should not activate.', 'Avoid installing.', 'Refrain from installing.', 'Don’t install.', 'Never restart the installed app.']) {
  assert.equal(interpretCommanderRequest(prefix + ' Fix calc.mjs.').kind, 'fixture', prefix)
}
for (const request of ['Verify the installation.', 'Verify after installing the application.', 'Check activation.', 'The activated runtime needs verification.', 'Verify packages.', 'Do not push, and install the runtime.', 'Do not install the app and then install it.']) {
  assert.equal(interpretCommanderRequest(request).kind, 'application', request)
}
assert.equal(interpretCommanderRequest('Fix calc.mjs. Do not modify Terra or the War Room header.').kind, 'fixture')
assert.equal(interpretCommanderRequest('Fix calc.mjs; package-lock.json and the package manager stay unchanged.').kind, 'fixture')
console.log('PASS gerund, noun, mixed-clause and negative application references preserve affirmative gates')

const { startMissionInput } = await import('./foundryMissionController')
const legacy = startMissionInput(coding)
legacy.kind = 'application'; legacy.interpretation.kind = 'application'; legacy.status = 'BLOCKED'
legacy.plan.push({ id: 'old-build', intent: 'BUILD', title: 'Historical build', status: 'failed', note: 'preserved failed build evidence' })
legacy.journal.push({ at: legacy.createdAt, kind: 'decision', text: 'original history' })
const preserved = JSON.stringify({ plan: legacy.plan, journal: legacy.journal, permissions: legacy.permissions, maxLoops: legacy.maxLoops, loopCount: legacy.loopCount, constraints: legacy.constraints, capabilities: legacy.interpretation.capabilityAssessment, sourceState: legacy.sourceState })
assert.equal(correctLegacyMissionIntent(legacy), true)
assert.equal(legacy.kind, 'fixture')
assert.equal(JSON.stringify({ plan: legacy.plan, journal: legacy.journal, permissions: legacy.permissions, maxLoops: legacy.maxLoops, loopCount: legacy.loopCount, constraints: legacy.constraints, capabilities: legacy.interpretation.capabilityAssessment, sourceState: legacy.sourceState }), preserved)
assert.equal(correctLegacyMissionIntent(legacy), false, 'correction is idempotent')
for (const guard of ['installed', 'packaged', 'unpacked', 'affirmative', 'running']) {
  const m = startMissionInput(coding); m.kind = 'application'; m.status = 'BLOCKED'
  if (guard === 'installed') m.installState.installId = 'existing-install'
  if (guard === 'packaged') m.packageState.deb = { path: 'existing.deb', sha256: 'existing' }
  if (guard === 'unpacked') m.packageState.linuxUnpackedDir = '/existing'
  if (guard === 'affirmative') m.userRequest = 'Do not change tests. Install the runtime.'
  if (guard === 'running') m.status = 'EXECUTING'
  assert.equal(correctLegacyMissionIntent(m), false, guard)
  assert.equal(m.kind, 'application', guard)
}
console.log('PASS resumable correction preserves plan/history/source/permissions/capability assessment/ceilings; active or packaged installation cannot downgrade')

for (const request of ['Do not push, install the runtime.', 'Do not push, and please install the runtime.', 'Do not change tests, and also install the app.', 'If the app is not installed, install it.']) {
  assert.equal(interpretCommanderRequest(request).kind, 'application', request)
}
console.log('PASS comma/please/also and conditional-status continuations preserve application gates')
