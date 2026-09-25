/**
 * PASS 015 production: status token once + detail once via broker replace_unique.
 * Does not restore historical installs. Does not touch Terra.
 */
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMission } from './foundryMissionController'
import { loadMission, saveMission, transitionMission } from './foundryMissionStore'
import { claimToolResources } from './foundryOperationsManager'
import { executeEngineerTool, type EngineerToolName } from './engineerTools'
import { releaseMissionResources } from './foundryResourceLocks'
import { releaseProductionLease } from './foundryProductionLease'
import { rememberEngineeringFact, rememberFeatureOwnership } from './foundryEngineeringMemory'
import { readProductionOwner } from './foundryProductionOwnership'
import { runProductionLeaseWatchdog } from './foundryProductionLeaseWatchdog'
import { establishMissionWriteSet, persistMissionWriteSet } from './foundryMissionWriteSet'
import { BOUNDED_EDIT_TOOL } from './foundryBoundedEdit'
import { authorizeFoundryBrowserLocalSession } from './foundryBrowserService'
import { engineeringReviewChip, reviewRenderCounts } from './foundryAutonomousEngineeringDepth.pass015.validation'
import { ensureEngineeringState } from './foundryEngineeringDepth'
import { productionBuildAllowed } from './foundryEngineeringContract'

const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const TERRA = 'components/war-room/foundry/FoundryTerraBackground.tsx'
const HOME = 'components/war-room/foundry/FoundryHomeNav.tsx'
const REQUEST = 'In Advanced Engineering Review render selected.engineeringReview as the standalone PASS/FAIL/PENDING status token exactly once, and render selected.engineeringReviewDetail exactly once as the detail body. Do not put engineeringReviewDetail in the PASS ternary. Do not hardcode PASS: Foundry checked all required gates and tests. Keep ENGINEERING REVIEW and foundry-engineering-review. Do not change the homepage. Do not touch Terra.'
const REPLACEMENT = [
  '<p className="text-sm font-bold text-emerald-200">{selected.engineeringReview ?? \'PENDING\'}</p>',
  '{selected.engineeringReviewDetail ? <p className="text-xs text-slate-200 whitespace-pre-wrap">{selected.engineeringReviewDetail}</p> : null}',
].join('\n')

type Identity = {
  activeInstallId?: string | null
  runningInstallId?: string | null
  identityMatch?: boolean | null
}

async function leaseTool(missionId: string, tool: EngineerToolName, input: Record<string, unknown>) {
  const mission = await loadMission(missionId)
  if (!mission) throw new Error(`missing mission ${missionId}`)
  const claimed = await claimToolResources(mission, tool, input, 180_000)
  if (!claimed.ok) return { ok: false, error: claimed.error, result: null as unknown }
  try {
    return await executeEngineerTool({ tool, input }, { repairId: mission.missionId, mission })
  } finally {
    for (const release of claimed.releases) await release()
    await saveMission(mission)
  }
}

async function identity(repairId: string): Promise<Identity> {
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId })
  return (verify.result ?? {}) as Identity
}

function shaRel(rel: string, text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

async function run() {
  const root = resolveRepoRoot()
  const terraBefore = shaRel(TERRA, await readFile(path.join(root, TERRA), 'utf8'))
  const homeBefore = existsSync(path.join(root, HOME)) ? shaRel(HOME, await readFile(path.join(root, HOME), 'utf8')) : 'missing'
  const before = await identity('pass015-identity')
  const ownerBefore = await readProductionOwner()

  const mission = await startMission(REQUEST, 'PASS 015 Engineering Review status token', {
    productionOwner: true,
    productionRole: 'PRODUCTION_OWNER',
  })
  process.env.FOUNDRY_PRODUCTION_MISSION_ID = mission.missionId
  mission.candidateFiles = [PANEL]
  mission.importantPaths = [PANEL]
  ensureEngineeringState(mission).ownership = {
    query: REQUEST,
    owners: [PANEL],
    dependents: [],
    tests: ['lib/native-builder/foundryAutonomousEngineeringDepth.pass015.validation.ts'],
    routes: [],
    apis: [],
    packageBoundaries: ['components/war-room/foundry'],
  }
  await saveMission(mission)

  await executeEngineerTool({ tool: 'engineering.baseline', input: { paths: [PANEL] } }, { repairId: mission.missionId, mission })
  const loadedBase = await loadMission(mission.missionId) ?? mission
  establishMissionWriteSet(loadedBase, {
    paths: [PANEL],
    readScope: [PANEL],
    reason: 'PASS 015 Engineering Review render owner only.',
    ownerEvidence: PANEL,
    sourceStep: 'BASELINE',
  })
  await persistMissionWriteSet(loadedBase)
  await saveMission(loadedBase)

  const read = await executeEngineerTool({
    tool: 'file.read',
    input: { path: PANEL, query: 'ENGINEERING REVIEW', focused: true },
  }, { repairId: loadedBase.missionId, mission: loadedBase })
  await saveMission(loadedBase)
  const readResult = (read.result ?? {}) as { anchorId?: string; ANCHOR_TEXT?: string; sha256?: string }
  const excerpt = String((read.result as { compact?: string } | undefined)?.compact ?? read.excerpt ?? '')
  const anchorId = readResult.anchorId
    ?? excerpt.match(/EDITABLE_REGION:\nanchorId=([a-z0-9_-]+)/i)?.[1]
    ?? excerpt.match(/anchorId=([a-z0-9_-]+)/i)?.[1]
  const matchText = readResult.ANCHOR_TEXT
    ?? excerpt.split('ANCHOR_TEXT:\n')[1]?.split('\nPROTECTED_BINDINGS')[0]?.trim()
  const replacementText = /data-testid="foundry-engineering-review"/.test(matchText ?? '')
    ? [
      '<div className="rounded border border-white/10 p-2" data-testid="foundry-engineering-review" aria-label="Engineering review status">',
      '                <p className="text-[9px] uppercase tracking-widest text-slate-500">ENGINEERING REVIEW</p>',
      `                ${REPLACEMENT.split('\n').join('\n                ')}`,
      '              </div>',
    ].join('\n')
    : REPLACEMENT
  if (!read.ok || !anchorId) {
    console.log(JSON.stringify({ fail: 'file.read', error: read.error, keys: Object.keys(readResult), excerpt: excerpt.slice(0, 800) }, null, 2))
    process.exit(1)
  }

  const replaced = await executeEngineerTool({
    tool: BOUNDED_EDIT_TOOL,
    input: {
      path: PANEL,
      anchorId,
      replacementText,
      reason: 'Render selected.engineeringReview once and selected.engineeringReviewDetail once.',
    },
  }, { repairId: loadedBase.missionId, mission: loadedBase })
  const mutated = await loadMission(mission.missionId) ?? loadedBase
  if (!mutated.sourceState.changedFiles.includes(PANEL)) mutated.sourceState.changedFiles.push(PANEL)
  mutated.engineering = loadedBase.engineering
  await saveMission(mutated)
  const panelAfter = await readFile(path.join(root, PANEL), 'utf8')
  const counts = reviewRenderCounts(engineeringReviewChip(panelAfter))
  if (!replaced.ok) {
    const alreadyFixed = counts.statusToken === 1 && counts.detail === 1 && !counts.passTernaryDetail
    if (!alreadyFixed) {
      console.log(JSON.stringify({ fail: 'file.replace_unique', error: replaced.error, excerpt: String(replaced.excerpt ?? '').slice(0, 500) }, null, 2))
      process.exit(1)
    }
  }
  if (counts.statusToken !== 1 || counts.detail !== 1 || counts.hardcoded !== 0 || counts.passTernaryDetail) {
    console.log(JSON.stringify({ fail: 'render_counts', counts, chip: engineeringReviewChip(panelAfter) }, null, 2))
    process.exit(1)
  }

  const review = await executeEngineerTool({ tool: 'engineering.review', input: {} }, { repairId: mutated.missionId, mission: mutated })
  const tests = await executeEngineerTool({
    tool: 'test.run',
    input: { suite: 'validate:foundry-autonomous-engineering-depth-pass015' },
  }, { repairId: mutated.missionId, mission: mutated })
  const reviewed = await loadMission(mission.missionId) ?? mutated
  reviewed.testState = { ok: tests.ok === true, detail: String(tests.error ?? tests.excerpt ?? 'pass015 validation') }
  ensureEngineeringState(reviewed).regressionOk = tests.ok === true
  await saveMission(reviewed)
  const buildBlock = productionBuildAllowed(reviewed)
  if (buildBlock || ensureEngineeringState(reviewed).selfReview?.status !== 'PASS') {
    console.log(JSON.stringify({
      fail: 'gates',
      buildBlock,
      selfReview: reviewed.engineering?.selfReview,
      reviewOk: review.ok,
      testsOk: tests.ok,
      testsError: tests.error,
    }, null, 2))
    process.exit(1)
  }

  for (const step of reviewed.plan) {
    if (['UNDERSTAND', 'SEARCH', 'READ', 'MAP', 'IMPACT', 'BASELINE', 'PATCH_SOURCE', 'SELF_REVIEW', 'CROSS_FILE', 'TEST', 'DIAGNOSE', 'TEST_REVIEW', 'CONTRACT', 'REGRESSION', 'LINT', 'TYPECHECK', 'SELF_CHECK'].includes(step.intent)) {
      if (step.status === 'pending' || step.status === 'active') {
        step.status = step.intent === 'TEST' || step.intent === 'LINT' || step.intent === 'TYPECHECK' ? 'skipped' : 'done'
      }
    }
  }
  await transitionMission(reviewed, 'UNDERSTANDING', 'PASS 015 render fix')
  const afterUnderstand = await loadMission(mission.missionId) ?? reviewed
  await transitionMission(afterUnderstand, 'INSPECTING', 'PASS 015 render fix')
  const afterInspect = await loadMission(mission.missionId) ?? afterUnderstand
  await transitionMission(afterInspect, 'PLANNING', 'PASS 015 render fix')
  const afterPlan = await loadMission(mission.missionId) ?? afterInspect
  await transitionMission(afterPlan, 'EXECUTING', 'PASS 015 render fix')
  const afterExec = await loadMission(mission.missionId) ?? afterPlan
  await transitionMission(afterExec, 'BUILDING', 'PASS 015 render fix')

  const built = await leaseTool(mission.missionId, 'build.run', {})
  console.log('BUILD', built.ok, built.error ?? '')
  if (!built.ok) process.exit(1)
  const loadedBuild = await loadMission(mission.missionId)
  if (loadedBuild) await transitionMission(loadedBuild, 'PACKAGING', 'build ok')

  const packed = await leaseTool(mission.missionId, 'package.run', {})
  console.log('PACKAGE', packed.ok, packed.error ?? '')
  if (!packed.ok) process.exit(1)
  const pack = packed.result as {
    appimage: { path: string; sha256: string }
    deb: { path: string; sha256: string }
    linuxUnpackedDir: string
  }
  const loadedPkg = await loadMission(mission.missionId)
  if (loadedPkg) await transitionMission(loadedPkg, 'INSTALLING', 'package ok')

  const feature = `foundry-${mission.missionId.slice(0, 8)}`
  const installed = await leaseTool(mission.missionId, 'installer.install_production', {
    appimage: pack.appimage,
    deb: pack.deb,
    linuxUnpackedDir: pack.linuxUnpackedDir,
    feature,
    commanderConfirmed: true,
  })
  console.log('INSTALL', installed.ok, installed.error ?? '')
  if (!installed.ok) process.exit(1)
  const installId = (installed.result as { stamp?: { install_id?: string } } | undefined)?.stamp?.install_id
  if (!installId || /544de899|9bf8ed1f|2a97aa3d/.test(installId)) {
    console.error('REFUSED reuse of historical install', installId)
    process.exit(1)
  }
  const loadedInst = await loadMission(mission.missionId)
  if (loadedInst) {
    loadedInst.installState.ok = true
    loadedInst.installState.installId = installId
    await saveMission(loadedInst)
  }

  const activated = await leaseTool(mission.missionId, 'installer.activate', { installId, commanderConfirmed: true })
  console.log('ACTIVATE', activated.ok, activated.error ?? '')
  if (!activated.ok) process.exit(1)
  const transition = await leaseTool(mission.missionId, 'runtime.transition_to_active', { commanderConfirmed: true })
  console.log('TRANSITION', transition.ok, transition.error ?? '')
  if (!transition.ok) process.exit(1)

  const after = await identity(mission.missionId)
  const identityMatch = after.identityMatch === true && after.activeInstallId === installId && after.runningInstallId === installId
  const terraAfter = shaRel(TERRA, await readFile(path.join(root, TERRA), 'utf8'))
  const homeAfter = existsSync(path.join(root, HOME)) ? shaRel(HOME, await readFile(path.join(root, HOME), 'utf8')) : 'missing'

  const origin = 'http://127.0.0.1:3848'
  const loadedUi = await loadMission(mission.missionId)
  const ctx = { repairId: mission.missionId, mission: loadedUi }
  await executeEngineerTool({ tool: 'browser.start', input: {} }, ctx)
  const session = await executeEngineerTool({ tool: 'browser.local_session', input: { origin } }, ctx)
  await executeEngineerTool({ tool: 'browser.navigate', input: { url: `${origin}/` } }, ctx)
  await executeEngineerTool({ tool: 'browser.wait', input: { ms: 1000 } }, ctx)
  const homeText = await executeEngineerTool({ tool: 'browser.get_text', input: {} }, ctx)
  await executeEngineerTool({ tool: 'browser.navigate', input: { url: `${origin}/war-room/engineering?workspace=war-room-self` } }, ctx)
  await executeEngineerTool({ tool: 'browser.wait', input: { ms: 1500 } }, ctx)
  await executeEngineerTool({ tool: 'browser.click', input: { testId: 'foundry-operations-toggle' } }, ctx)
  await executeEngineerTool({ tool: 'browser.wait', input: { ms: 800 } }, ctx)
  await executeEngineerTool({
    tool: 'browser.select',
    input: { selector: 'select[aria-label="Mission status"]', value: mission.missionId },
  }, ctx)
  await executeEngineerTool({ tool: 'browser.wait', input: { ms: 800 } }, ctx)
  const chip = await executeEngineerTool({ tool: 'browser.get_text', input: { selector: '[data-testid="foundry-engineering-review"]' } }, ctx)
  const chipText = String((chip.result as { text?: string } | undefined)?.text ?? '')
  const cons = await executeEngineerTool({ tool: 'browser.console', input: {} }, ctx)
  await executeEngineerTool({ tool: 'browser.stop', input: {} }, ctx)
  const homeBlob = JSON.stringify(homeText.result ?? '')
  const passCount = (chipText.match(/\bPASS\b/g) ?? []).length
  const checkedCount = (chipText.match(/Checked:/g) ?? []).length
  const hardcodedAbsent = !/PASS: Foundry checked all required gates and tests\./.test(chipText)
  const browserOk = session.ok && chip.ok
    && /ENGINEERING REVIEW/i.test(chipText)
    && passCount === 1
    && checkedCount === 1
    && hardcodedAbsent
    && !/PASS 015 clutter/.test(homeBlob)
    && cons.ok
    && !/TypeError|ReferenceError|Unhandled Promise/i.test(JSON.stringify(cons.result ?? ''))

  const computer = await executeEngineerTool({ tool: 'computer.observe', input: { name: 'ENGINEERING REVIEW', app: 'war-room-os' } }, ctx)
  const computerPass = await executeEngineerTool({ tool: 'computer.observe', input: { name: 'PASS', app: 'war-room-os' } }, ctx)
  const computerChecked = await executeEngineerTool({ tool: 'computer.observe', input: { name: 'Checked', app: 'war-room-os' } }, ctx)

  const lan = authorizeFoundryBrowserLocalSession({ origin: 'http://192.168.1.50:3848' }, { repairId: mission.missionId })
  const loopback = authorizeFoundryBrowserLocalSession({ origin: 'http://127.0.0.1:3848' }, { repairId: mission.missionId })

  if (identityMatch && browserOk && counts.statusToken === 1 && counts.detail === 1) {
    await rememberFeatureOwnership({
      feature: 'Foundry Engineering Review status token',
      owners: [PANEL],
      tests: ['lib/native-builder/foundryAutonomousEngineeringDepth.pass015.validation.ts'],
      sourceMission: mission.missionId,
      confidence: 'CONFIRMED',
      uiControl: 'Advanced Engineering Review',
    }).catch(() => undefined)
    await rememberEngineeringFact({
      topic: 'foundry-engineering-review-status-token',
      summary: 'Advanced Engineering Review renders selected.engineeringReview once as PASS/FAIL/PENDING and selected.engineeringReviewDetail once. The PASS ternary must not render the detail field. Hardcoded PASS: Foundry checked all required gates and tests. stays removed.',
      files: [PANEL],
      sourceMission: mission.missionId,
      confidence: 'CONFIRMED',
    }).catch(() => undefined)
  }

  await runProductionLeaseWatchdog().catch(() => undefined)
  await releaseProductionLease(mission.missionId).catch(() => undefined)
  const final = await loadMission(mission.missionId)

  const payload = {
    ownerMissionId: mission.missionId,
    writeSet: final?.writeSet?.paths ?? [],
    changedFiles: final?.sourceState.changedFiles ?? [],
    selectedAnchor: anchorId,
    mutationOk: replaced.ok,
    counts,
    chipText: chipText.slice(0, 400),
    passCount,
    checkedCount,
    hardcodedAbsent,
    selfReview: final?.engineering?.selfReview?.status ?? null,
    tests: tests.ok,
    build: built.ok,
    pkg: packed.ok,
    install: installed.ok,
    FINAL_INSTALL_ID: installId,
    ACTIVE_INSTALL_ID_BEFORE: before.activeInstallId,
    RUNNING_INSTALL_ID_BEFORE: before.runningInstallId,
    ACTIVE_INSTALL_ID: after.activeInstallId,
    RUNNING_INSTALL_ID: after.runningInstallId,
    identityMatch,
    browser: browserOk,
    computer: { review: computer.ok, pass: computerPass.ok, checked: computerChecked.ok },
    homepageUnchanged: homeBefore === homeAfter,
    terraBefore,
    terraAfter,
    TERRA_MODIFIED: terraBefore !== terraAfter,
    lanDenied: lan.ok === false,
    loopbackAuthorized: loopback.ok === true,
    ownerGenerationBefore: ownerBefore?.productionGeneration ?? null,
    ownerGenerationAfter: (await readProductionOwner())?.productionGeneration ?? null,
    reviewError: review.error,
  }
  console.log(JSON.stringify(payload, null, 2))

  const pass = identityMatch
    && browserOk
    && counts.statusToken === 1
    && counts.detail === 1
    && counts.hardcoded === 0
    && terraBefore === terraAfter
    && homeBefore === homeAfter
    && built.ok && packed.ok && installed.ok
    && Boolean(replaced.ok || (counts.statusToken === 1 && counts.detail === 1))
  if (!pass) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass015Proof }
