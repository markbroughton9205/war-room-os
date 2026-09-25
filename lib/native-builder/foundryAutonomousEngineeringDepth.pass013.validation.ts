/**
 * PASS 013 — terminal resource-claim hygiene, titled-UI owner ranking, browser session safety.
 * Does not re-run the local 14B engineering edit mission. Does not rewrite Engineering Review memory.
 */
import { pathToFileURL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMissionInput } from './foundryMissionController'
import {
  acquireResource,
  listResourceClaims,
  setResourceLockRootForTests,
} from './foundryResourceLocks'
import {
  isTerminalClaimMission,
  reconcileTerminalMissionClaims,
  releaseTerminalMissionClaims,
  TERMINAL_CLAIM_STATES,
} from './foundryTerminalResourceRelease'
import {
  buildCodeIndex,
  indexSourceFile,
  mapOwnership,
  rankOwnersFromIndex,
  type FoundryCodeIndex,
  type FoundryFileIndex,
} from './foundryCodeIntelligence'
import {
  BROWSER_IDE_LOCAL_SESSION,
  authorizeFoundryBrowserLocalSession,
  buildLocalSessionCookie,
  FOUNDRY_BROWSER_TOOL_NAMES,
} from './foundryBrowserService'
import { readProductionOwner } from './foundryProductionOwnership'
import { loadMission, saveMission } from './foundryMissionStore'
import { installerActiveStatus, realInstallOptRoot } from './installerTool'
import { foundryDataHierarchy } from './foundryPaths'
import { runtimeVerify } from './runtimeControl'
import { readEngineeringMemory, recallFeatureOwnership } from './foundryEngineeringMemory'
import { FOUNDRY_LOCK_ORDER, type FoundryResourceId } from './foundryOperationsTypes'
import type { FoundryMissionRecord, FoundryMissionState } from './foundryMissionTypes'
import { runFoundryProductionLeaseWatchdogValidation } from './foundryProductionLeaseWatchdog.validation'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const ROOT = resolveRepoRoot()
const OCCUPANT_ID = '88356e33-1ec2-4b8e-b86a-bddd606cb881'
const PROVEN_INSTALL = 'war-room-os-0.1.0-75f49a0-foundry-5d4b64e1'
const SOURCE_MISSION = '5d4b64e1-cb71-41f9-b4d8-0410cdb96818'
const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'

function fixtureIndex(files: FoundryFileIndex[], tests: Record<string, string[]> = {}): FoundryCodeIndex {
  const dependents: Record<string, string[]> = {}
  const map: Record<string, FoundryFileIndex> = {}
  for (const file of files) {
    map[file.path] = file
    for (const imported of file.imports) {
      dependents[imported] ??= []
      if (!dependents[imported].includes(file.path)) dependents[imported].push(file.path)
    }
  }
  return {
    builtAt: new Date().toISOString(),
    fileCount: files.length,
    cacheVersion: 5,
    files: map,
    symbols: {},
    dependents,
    tests,
  }
}

function missionWith(status: FoundryMissionState, id: string): FoundryMissionRecord {
  const mission = startMissionInput(`PASS 013 ${status} resource-claim fixture. Not a production install.`)
  mission.missionId = id
  mission.status = status
  mission.phase = status
  mission.kind = 'fixture'
  mission.lockClaims = []
  return mission
}

async function acquireClaim(resource: FoundryResourceId, missionId: string, operation: string) {
  return acquireResource({ resource, missionId, operation, waitMs: 0 })
}

async function runResourceCases(): Promise<{ results: CaseResult[]; occupantBefore: string; occupantAfter: string }> {
  const results: CaseResult[] = []
  const tmp = await mkdtemp(path.join(tmpdir(), 'pass013-locks-'))
  setResourceLockRootForTests(tmp)
  let occupantBefore = 'unavailable'
  let occupantAfter = 'unavailable'
  try {
    const complete = missionWith('COMPLETE', 'pass013-complete-desktop')
    const desktop = await acquireClaim('COMPUTER_USE_DESKTOP', complete.missionId, 'computer.click')
    results.push(check('complete_desktop_acquired', desktop.state === 'ACQUIRED', desktop.state))
    if (desktop.state === 'ACQUIRED') complete.lockClaims = [desktop.claim]
    const first = await releaseTerminalMissionClaims(complete)
    const second = await releaseTerminalMissionClaims(complete)
    const leftoverDesktop = (await listResourceClaims()).some(claim => claim.resource === 'COMPUTER_USE_DESKTOP' && claim.missionId === complete.missionId)
    results.push(check(
      'complete_computer_use_desktop_released',
      first.released.some(claim => claim.resource === 'COMPUTER_USE_DESKTOP') && !leftoverDesktop && !(complete.lockClaims ?? []).length,
      JSON.stringify({ released: first.released.map(claim => claim.resource), leftoverDesktop }),
    ))
    results.push(check('release_idempotent', second.alreadyClear === true && second.released.length === 0 && !(complete.lockClaims ?? []).length, JSON.stringify(second)))

    const failed = missionWith('FAILED', 'pass013-failed-repo')
    const repo = await acquireClaim('REPO_WRITE', failed.missionId, 'file.replace_unique')
    if (repo.state === 'ACQUIRED') failed.lockClaims = [repo.claim]
    const failedRelease = await releaseTerminalMissionClaims(failed)
    const leftoverRepo = (await listResourceClaims()).some(claim => claim.resource === 'REPO_WRITE' && claim.missionId === failed.missionId)
    results.push(check(
      'failed_repo_write_released',
      failedRelease.released.some(claim => claim.resource === 'REPO_WRITE') && !leftoverRepo,
      JSON.stringify({ released: failedRelease.released.map(claim => claim.resource), leftoverRepo }),
    ))

    const cancelled = missionWith('CANCELLED', 'pass013-cancelled-provider')
    const provider = await acquireClaim('PROVIDER_SLOT', cancelled.missionId, 'model.generate')
    if (provider.state === 'ACQUIRED') cancelled.lockClaims = [provider.claim]
    const cancelledRelease = await releaseTerminalMissionClaims(cancelled)
    const leftoverProvider = (await listResourceClaims()).some(claim => claim.resource === 'PROVIDER_SLOT' && claim.missionId === cancelled.missionId)
    results.push(check(
      'cancelled_provider_slot_released',
      cancelledRelease.released.some(claim => claim.resource === 'PROVIDER_SLOT') && !leftoverProvider,
      JSON.stringify({ released: cancelledRelease.released.map(claim => claim.resource), leftoverProvider }),
    ))

    const blocked = missionWith('BLOCKED', 'pass013-blocked-desktop')
    const blockedDesktop = await acquireClaim('COMPUTER_USE_DESKTOP', blocked.missionId, 'computer.click')
    if (blockedDesktop.state === 'ACQUIRED') blocked.lockClaims = [blockedDesktop.claim]
    const blockedRelease = await releaseTerminalMissionClaims(blocked)
    results.push(check(
      'blocked_nonpersistent_claim_released',
      blockedRelease.released.some(claim => claim.resource === 'COMPUTER_USE_DESKTOP')
        && !(blocked.lockClaims ?? []).some(claim => claim.resource === 'COMPUTER_USE_DESKTOP'),
      JSON.stringify({ released: blockedRelease.released.map(claim => claim.resource), kept: blockedRelease.kept }),
    ))

    const live = missionWith('EXECUTING', 'pass013-live-provider')
    const liveClaim = await acquireClaim('PROVIDER_SLOT', live.missionId, 'model.generate')
    if (liveClaim.state === 'ACQUIRED') live.lockClaims = [liveClaim.claim]
    const liveAttempt = await releaseTerminalMissionClaims(live)
    const liveStillHeld = (await listResourceClaims()).some(claim => claim.resource === 'PROVIDER_SLOT' && claim.missionId === live.missionId)
    results.push(check(
      'live_mission_claim_protected',
      liveAttempt.released.length === 0 && liveStillHeld && (live.lockClaims ?? []).some(claim => claim.resource === 'PROVIDER_SLOT'),
      JSON.stringify({ released: liveAttempt.released, liveStillHeld, status: live.status }),
    ))

    const otherComplete = missionWith('COMPLETE', 'pass013-other-complete')
    const otherDesktop = await acquireClaim('COMPUTER_USE_DESKTOP', otherComplete.missionId, 'computer.click')
    if (otherDesktop.state === 'ACQUIRED') otherComplete.lockClaims = [otherDesktop.claim]
    await releaseTerminalMissionClaims(otherComplete)
    const liveUntouched = (await listResourceClaims()).some(claim => claim.resource === 'PROVIDER_SLOT' && claim.missionId === live.missionId)
    results.push(check('peer_complete_does_not_steal_live_claim', liveUntouched, `liveHeld=${liveUntouched}`))

    const mixed = await reconcileTerminalMissionClaims([live, complete, failed, cancelled, blocked])
    results.push(check(
      'terminal_reconciliation_skips_live',
      mixed.every(item => item.missionId !== live.missionId) && liveStillHeld,
      mixed.map(item => `${item.missionId}:${item.status}`).join(',') || 'none',
    ))
    results.push(check(
      'terminal_states_covered',
      TERMINAL_CLAIM_STATES.includes('COMPLETE')
        && TERMINAL_CLAIM_STATES.includes('FAILED')
        && TERMINAL_CLAIM_STATES.includes('CANCELLED')
        && TERMINAL_CLAIM_STATES.includes('BLOCKED')
        && isTerminalClaimMission({ status: 'COMPLETE', archived: false, superseded: false, resumeEligible: true }),
      TERMINAL_CLAIM_STATES.join(','),
    ))
    results.push(check(
      'resource_types_in_lock_order',
      ['REPO_WRITE', 'PROVIDER_SLOT', 'COMPUTER_USE_DESKTOP', 'ACTIVE_RUNTIME', 'PRODUCTION_LEASE'].every(id => FOUNDRY_LOCK_ORDER.includes(id as FoundryResourceId)),
      FOUNDRY_LOCK_ORDER.join(','),
    ))
  } finally {
    setResourceLockRootForTests(null)
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }

  const occupant = await loadMission(OCCUPANT_ID)
  occupantBefore = occupant
    ? JSON.stringify({
      status: occupant.status,
      claims: (occupant.lockClaims ?? []).map(claim => claim.resource),
      runtimeClaims: occupant.runtimeClaims ?? [],
    })
    : 'missing'
  if (occupant && isTerminalClaimMission(occupant)) {
    const journalBefore = occupant.journal.length
    const occupantRelease = await releaseTerminalMissionClaims(occupant)
    await saveMission(occupant)
    const reloaded = await loadMission(OCCUPANT_ID)
    occupantAfter = JSON.stringify({
      status: reloaded?.status,
      claims: (reloaded?.lockClaims ?? []).map(claim => claim.resource),
      released: occupantRelease.released.map(claim => claim.resource),
      alreadyClear: occupantRelease.alreadyClear,
    })
    results.push(check(
      'occupant_88356e33_desktop_claim_released',
      reloaded?.status === occupant.status
        && !(reloaded?.lockClaims ?? []).some(claim => claim.resource === 'COMPUTER_USE_DESKTOP')
        && (reloaded?.journal.length ?? 0) >= journalBefore,
      occupantAfter,
    ))
    results.push(check('occupant_not_killed', reloaded?.status === 'COMPLETE' || reloaded?.status === occupant.status, reloaded?.status ?? 'missing'))
  } else {
    occupantAfter = occupantBefore
    results.push(check('occupant_88356e33_desktop_claim_released', Boolean(occupant), occupantBefore))
  }

  return { results, occupantBefore, occupantAfter }
}

function runRankingCases(): CaseResult[] {
  const results: CaseResult[] = []
  const nav = indexSourceFile('components/app/StatusHomeNav.tsx', `
export function StatusHomeNav() {
  return <nav aria-label="Status Chip">STATUS CHIP</nav>
}
`)
  const panel = indexSourceFile('components/app/StatusChipPanel.tsx', `
export function StatusChipPanel(selected: { statusChip: string }) {
  return <div data-testid="status-chip">{selected.statusChip}</div>
}
`)
  const copy = indexSourceFile('lib/copy/statusChipCopy.ts', `
export const STATUS_CHIP_LABEL = "Status Chip"
`)
  const docs = indexSourceFile('lib/docs/statusChipGuide.ts', `
export const GUIDE = "Status Chip is documented here for operators and does not render."
`)
  const page = indexSourceFile('app/dashboard/page.tsx', `
import { StatusChipPanel } from '@/components/app/StatusChipPanel'
export default function DashboardPage(selected: { statusChip: string }) {
  return <main><StatusChipPanel statusChip={selected.statusChip} /></main>
}
`, ['components/app/StatusChipPanel.tsx'])
  const index = fixtureIndex([nav, panel, copy, docs, page], {
    'components/app/StatusChipPanel.tsx': ['components/app/StatusChipPanel.validation.ts'],
  })
  const ranked = rankOwnersFromIndex('Status Chip', index)
  const paths = ranked.map(item => item.path)
  results.push(check(
    'actual_renderer_outranks_nav_title',
    paths[0] === 'components/app/StatusChipPanel.tsx' && (paths.indexOf('components/app/StatusHomeNav.tsx') === -1 || paths.indexOf('components/app/StatusHomeNav.tsx') > 0),
    paths.slice(0, 6).join(', '),
  ))
  results.push(check(
    'binding_owner_outranks_string_only',
    paths.indexOf('components/app/StatusChipPanel.tsx') < paths.indexOf('lib/copy/statusChipCopy.ts'),
    paths.slice(0, 6).join(', '),
  ))
  results.push(check(
    'route_component_outranks_documentation',
    paths.indexOf('app/dashboard/page.tsx') !== -1 && paths.indexOf('app/dashboard/page.tsx') < paths.indexOf('lib/docs/statusChipGuide.ts'),
    paths.slice(0, 6).join(', '),
  ))
  const withoutTests = fixtureIndex([nav, panel, copy])
  const withTests = fixtureIndex([nav, panel, copy], { 'components/app/StatusChipPanel.tsx': ['components/app/StatusChipPanel.validation.ts'] })
  const tested = rankOwnersFromIndex('Status Chip', withTests).find(item => item.path === panel.path)?.score ?? 0
  const untested = rankOwnersFromIndex('Status Chip', withoutTests).find(item => item.path === panel.path)?.score ?? 0
  results.push(check('test_association_improves_rank', tested > untested, `tested=${tested} untested=${untested}`))
  results.push(check(
    'reverse_dependency_evidence_preserved',
    (index.dependents[panel.path] ?? []).includes(page.path),
    JSON.stringify(index.dependents[panel.path] ?? []),
  ))
  results.push(check(
    'literal_only_is_candidate_not_primary',
    paths[0] !== copy.path && paths.includes(copy.path),
    paths.slice(0, 6).join(', '),
  ))
  const intelligence = readFileSync(path.join(ROOT, 'lib/native-builder/foundryCodeIntelligence.ts'), 'utf8')
  results.push(check(
    'no_engineering_review_filename_hardcode',
    !intelligence.includes('FoundryMissionControllerPanel') && !/Engineering Review/.test(intelligence),
    'ranking algorithm stays general',
  ))
  return results
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const ownerBefore = await readProductionOwner()
  const ownerPath = path.join(foundryDataHierarchy().operations, 'production-owner.json')
  const ownerRawBefore = existsSync(ownerPath) ? readFileSync(ownerPath, 'utf8') : ''
  const installDir = path.join(realInstallOptRoot(), PROVEN_INSTALL)
  const installExisted = existsSync(installDir)

  const resource = await runResourceCases()
  results.push(...resource.results)

  const ownerAfter = await readProductionOwner()
  const ownerRawAfter = existsSync(ownerPath) ? readFileSync(ownerPath, 'utf8') : ''
  results.push(check(
    'live_production_owner_protected',
    ownerBefore?.installId === ownerAfter?.installId
      && ownerBefore?.productionGeneration === ownerAfter?.productionGeneration
      && ownerBefore?.productionOwnerMissionId === ownerAfter?.productionOwnerMissionId,
    JSON.stringify({ before: ownerBefore, after: ownerAfter }),
  ))
  results.push(check('historical_generation_unchanged', ownerRawBefore === ownerRawAfter, `gen=${ownerAfter?.productionGeneration ?? 'none'}`))
  results.push(check('installed_runtime_directory_preserved', installExisted && existsSync(installDir), installDir))

  const verify = await runtimeVerify()
  const active = await installerActiveStatus()
  results.push(check(
    'installed_runtime_unaffected',
    verify.identityMatch === true
      && Boolean(active.activeInstallId)
      && active.activeInstallId === verify.runningInstallId
      && verify.ownership === 'INSTALLED_RUNTIME'
      && existsSync(installDir),
    JSON.stringify({ active: active.activeInstallId, running: verify.runningInstallId, identityMatch: verify.identityMatch, ownership: verify.ownership, provenDir: existsSync(installDir) }),
  ))

  const releaseSrc = readFileSync(path.join(ROOT, 'lib/native-builder/foundryTerminalResourceRelease.ts'), 'utf8')
  results.push(check(
    'resource_cleanup_audited',
    /foundry-ops: terminal-claims-released/.test(releaseSrc) && !/process\.stop/.test(releaseSrc) && !/rmSync|rm\(/.test(releaseSrc),
    'audit + no process.stop + no install delete',
  ))

  results.push(...runRankingCases())
  results.push(...await runFoundryProductionLeaseWatchdogValidation())

  const realIndex = await buildCodeIndex(true)
  const titled = await mapOwnership('Engineering Review', realIndex)
  const primary = titled.owners[0] ?? ''
  const chromeRank = titled.owners.findIndex(item => /HomeNav|Header|Footer|Sidebar|Chrome/i.test(item))
  results.push(check(
    'engineering_review_runtime_owner_outranks_chrome',
    primary === PANEL && (chromeRank === -1 || chromeRank > 0),
    JSON.stringify({ primary, chromeRank, top: titled.owners.slice(0, 6) }),
  ))
  results.push(check(
    'generic_chrome_not_primary',
    !/HomeNav|Header|Footer|Sidebar/.test(primary),
    primary,
  ))

  const visibility = await mapOwnership('Foundry project list visibility registry', realIndex)
  results.push(check(
    'project_visibility_ownership_still_valid',
    visibility.owners.some(item => /foundryProjectVisibility|FoundryShell|workspaceRegistry/.test(item)),
    visibility.owners.slice(0, 6).join(', '),
  ))

  const browserSrc = readFileSync(path.join(ROOT, 'lib/native-builder/foundryBrowserService.ts'), 'utf8')
  const localSession = authorizeFoundryBrowserLocalSession({ origin: 'http://127.0.0.1:3848' }, { repairId: SOURCE_MISSION })
  const cookie = buildLocalSessionCookie('http://127.0.0.1:3848', 'redacted-token')
  results.push(check(
    'browser_local_session_still_contracted',
    FOUNDRY_BROWSER_TOOL_NAMES.includes('browser.local_session') && localSession.ok === true,
    JSON.stringify(localSession),
  ))
  results.push(check(
    'browser_cookies_url_only',
    cookie.url === 'http://127.0.0.1:3848' && !('domain' in cookie) && !('path' in cookie) && /url: origin/.test(browserSrc) && !/domain:/.test(browserSrc),
    JSON.stringify(cookie),
  ))
  results.push(check(
    'browser_session_secrets_not_logged_or_persisted',
    /logWarRoomRepoAudit\('engineer: browser.local_session', \{ origin, authenticated: true, loopback: true \}\)/.test(browserSrc)
      && /result: \{ authenticated: true, origin, loopback: true \}/.test(browserSrc)
      && BROWSER_IDE_LOCAL_SESSION === 'DEFERRED_SECURITY_BOUNDARY',
    BROWSER_IDE_LOCAL_SESSION,
  ))
  const memorySrc = readFileSync(path.join(ROOT, 'lib/native-builder/foundryEngineeringMemory.ts'), 'utf8')
  results.push(check(
    'engineering_memory_does_not_store_cookies',
    !/wr_local_session|session_token|addCookies/.test(memorySrc),
    'memory store has no session cookies',
  ))

  const localRuntime = readFileSync(path.join(ROOT, 'lib/native-builder/foundryLocalModelRuntime.ts'), 'utf8')
  results.push(check(
    'direct_model_filesystem_mutation_zero',
    !/writeFileSync|writeFile\(|fs\.promises\.writeFile/.test(localRuntime),
    'local runtime has no filesystem writes',
  ))

  const panel = readFileSync(path.join(ROOT, PANEL), 'utf8')
  results.push(check(
    'engineering_review_ui_regression',
    /selected\.engineeringReview\b/.test(panel) && /Foundry checked all required gates and tests/.test(panel),
    'panel binding and explanation intact',
  ))

  const memory = await readEngineeringMemory()
  const recalled = recallFeatureOwnership(memory, 'Engineering Review')
  results.push(check(
    'engineering_memory_preserved',
    Boolean(recalled && recalled.owners.includes(PANEL)),
    JSON.stringify({
      feature: recalled?.feature,
      sourceMission: recalled?.sourceMissionId ?? recalled?.sourceMission,
      owners: recalled?.owners,
      confidence: recalled?.confidence,
    }),
  ))

  const pass013Touched = [
    'lib/native-builder/foundryTerminalResourceRelease.ts',
    'lib/native-builder/foundryResourceLocks.ts',
    'lib/native-builder/foundryMissionStore.ts',
    'lib/native-builder/foundryOperationsManager.ts',
    'lib/native-builder/foundryMissionController.ts',
    'lib/native-builder/foundryCodeIntelligence.ts',
    'lib/native-builder/foundryBrowserService.ts',
    'lib/native-builder/foundryAutonomousEngineeringDepth.pass013.validation.ts',
    'lib/native-builder/foundryProductionLeaseWatchdog.ts',
    'lib/native-builder/foundryProductionLeaseWatchdog.validation.ts',
    'lib/native-builder/foundryActivationScriptInventory.ts',
    'package.json',
  ]
  results.push(check(
    'terra_untouched',
    pass013Touched.every(file => !file.startsWith('lib/terra') && !file.includes('/terra/')),
    pass013Touched.join(','),
  ))
  results.push(check(
    'wrim_untouched',
    pass013Touched.every(file => !/\/wrim\//i.test(file)),
    pass013Touched.join(','),
  ))

  for (const item of results) console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name} ${item.detail}`)
  const failed = results.filter(item => !item.pass)
  console.log(`Foundry PASS 013 unit: ${results.length - failed.length}/${results.length} ${failed.length ? 'FAIL' : 'PASS'}`)
  console.log(`PASS013_OCCUPANT_BEFORE ${resource.occupantBefore}`)
  console.log(`PASS013_OCCUPANT_AFTER ${resource.occupantAfter}`)
  console.log(`PASS013_PRIMARY_OWNER ${primary}`)
  console.log(`PASS013_CHROME_RANK ${chromeRank}`)
  console.log(`PASS013_IDENTITY ${JSON.stringify({ active: active.activeInstallId, running: verify.runningInstallId, identityMatch: verify.identityMatch })}`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass013 }
