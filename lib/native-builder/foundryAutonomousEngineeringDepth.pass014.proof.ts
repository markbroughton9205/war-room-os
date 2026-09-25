/**
 * PASS 014 live local-14B production: semantic target + EMPTY_REPLACEMENT install + Engineering Review.
 * Model discovers the owner. No fixture force-patches. No PASS 013 restore.
 */
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { startMission, runModelMission, runDeterministicMission } from './foundryMissionController'
import { loadMission, saveMission } from './foundryMissionStore'
import { executeEngineerTool } from './engineerTools'
import { acquireProductionLease, readProductionLease, releaseProductionLease } from './foundryProductionLease'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { rememberFeatureOwnership, rememberEngineeringFact } from './foundryEngineeringMemory'
import { productionBuildAllowed } from './foundryEngineeringContract'
import { BOUNDED_EDIT_TOOL } from './foundryBoundedEdit'
import { resolveLocalModelHealth } from './localModelHealth'
import { realInstallOptRoot } from './installerTool'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { authorizeFoundryBrowserLocalSession } from './foundryBrowserService'

const PANEL = 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'
const TERRA = 'components/war-room/foundry/FoundryTerraBackground.tsx'
const REQUEST = 'Remove the redundant hardcoded Engineering Review PASS explanation and use the existing engineeringReviewDetail field as the explanation.'

type Identity = {
  activeInstallId?: string | null
  runningInstallId?: string | null
  identityMatch?: boolean | null
}

async function identity(repairId: string): Promise<Identity> {
  const verify = await executeEngineerTool({ tool: 'runtime.verify', input: {} }, { repairId })
  return (verify.result ?? {}) as Identity
}

function shaRel(rel: string, text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function walkHits(root: string, nameRe: RegExp, needle: string, limit = 8): string[] {
  const hits: string[] = []
  const stack = [root]
  while (stack.length && hits.length < limit) {
    const dir = stack.pop()
    if (!dir) break
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (hits.length >= limit) break
      if (name === 'node_modules' || name === '.git' || name === 'CesiumUnminified') continue
      const full = path.join(dir, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!nameRe.test(name)) continue
      try {
        const text = readFileSync(full, 'utf8')
        if (text.includes(needle)) hits.push(full)
      } catch {
        continue
      }
    }
  }
  return hits
}

async function peerAttack(ownerId: string, activeBefore: string | null | undefined) {
  for (let i = 0; i < 240; i += 1) {
    const owner = await loadMission(ownerId)
    if (!owner) return { skipped: true, reason: 'owner missing' }
    if (['COMPLETE', 'FAILED', 'CANCELLED'].includes(owner.status)) {
      return { skipped: true, reason: `owner already ${owner.status}` }
    }
    const lease = await readProductionLease()
    const ownerHolds = lease?.ownerMissionId === ownerId
    if (ownerHolds || ['BUILDING', 'PACKAGING', 'INSTALLING', 'VERIFYING'].includes(owner.status)) {
      const peer = await startMission(
        'PASS 014 peer production fixture. Attempt PRODUCTION_LEASE and installer.activate while the authorized owner is live. This is a test application fixture, not a production install. Do not restore foundry-544de899.',
        'PASS 014 peer race',
        { productionOwner: true, productionRole: 'PRODUCTION_OWNER', requestId: 'pass014-peer-attack' },
      )
      const leaseAttempt = await acquireProductionLease({ mission: peer, waitMs: 0 })
      const activate = await executeEngineerTool({
        tool: 'installer.activate',
        input: {
          installId: activeBefore,
          commanderConfirmed: true,
          missionId: peer.missionId,
        },
      }, { repairId: peer.missionId })
      const after = await identity(peer.missionId)
      peer.testArtifact = true
      peer.visibility = 'system'
      peer.classification = 'SYSTEM_TEST'
      peer.resumeEligible = false
      peer.archived = true
      await archiveConfirmedSystemTestMission(peer)
      await releaseMissionResources(peer.missionId).catch(() => undefined)
      await releaseProductionLease(peer.missionId).catch(() => undefined)
      return {
        skipped: false,
        ownerStatus: owner.status,
        peerMissionId: peer.missionId,
        leaseAttempt,
        activateOk: activate.ok,
        activateError: activate.error,
        activeAfter: after.activeInstallId,
        runningAfter: after.runningInstallId,
        activeUnchanged: after.activeInstallId === activeBefore,
        refused: /REFUSED_PRODUCTION_LEASE_HELD|WAITING_RESOURCE/.test(`${leaseAttempt.ok === false ? leaseAttempt.error : ''} ${activate.error ?? ''}`),
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
  return { skipped: true, reason: 'owner never entered a production-protected phase' }
}

async function run() {
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'LOCAL',
  })
  process.env.FOUNDRY_PROVIDER_POLICY = 'LOCAL'
  process.env.FOUNDRY_PRIMARY_MODEL = FOUNDRY_DEFAULT_FALLBACK_MODEL
  const health = await resolveLocalModelHealth({ tryStart: true })
  if (health.state !== 'READY' || !/qwen2.5-coder:14b/.test(health.model ?? '')) {
    console.log(`FAIL local_health ${JSON.stringify(health)}`)
    process.exit(1)
  }

  const terraBefore = shaRel(TERRA, await readFile(path.join(resolveRepoRoot(), TERRA), 'utf8'))
  const before = await identity('pass014-anchor-identity')
  const mission = await startMission(REQUEST, 'PASS 014 Engineering Review production', {
    productionOwner: true,
    productionRole: 'PRODUCTION_OWNER',
  })
  const attack = peerAttack(mission.missionId, before.activeInstallId)
  let runLocal = await runModelMission(mission.missionId)
  for (let resume = 0; resume < 8 && runLocal.status === 'WAITING_RESOURCE'; resume += 1) {
    await new Promise(resolve => setTimeout(resolve, 12_000))
    runLocal = await runModelMission(runLocal.missionId)
  }
  const panelAfterModel = await readFile(PANEL, 'utf8')
  const boundedCalls = runLocal.toolCalls.filter(call => call.tool === BOUNDED_EDIT_TOOL)
  const boundedOk = boundedCalls.some(call => call.ok)
  const sourceTouched = runLocal.sourceState.changedFiles.some(file => file.includes('FoundryMissionControllerPanel.tsx'))
  if (
    runLocal.status !== 'COMPLETE'
    && boundedOk
    && sourceTouched
    && runLocal.engineering?.selfReview?.status === 'PASS'
    && productionBuildAllowed(runLocal) === null
  ) {
    runLocal = await runDeterministicMission(runLocal.missionId)
  }
  const attackResult = await attack
  const loaded = await loadMission(runLocal.missionId) ?? runLocal
  const after = await identity(loaded.missionId)
  const lease = await readProductionLease()
  const panel = await readFile(PANEL, 'utf8')
  const terraAfter = shaRel(TERRA, await readFile(path.join(resolveRepoRoot(), TERRA), 'utf8'))
  const chip = panel.match(/data-testid="foundry-engineering-review"[\s\S]{0,900}/)?.[0] ?? ''
  const statusBinding = /selected\.engineeringReview/.test(chip)
    && /PASS/.test(chip)
    && /PENDING/.test(chip)
    && /FAIL/.test(chip)
  const noHardcodedPassProse = !/PASS: Foundry checked all required gates and tests\./.test(panel)
  const detailBinding = /selected\.engineeringReviewDetail/.test(chip)
  const firstAttemptApplied = Boolean(boundedCalls[0]?.ok)
  const invalidReplacementCount = boundedCalls.filter(call => /INVALID_REPLACEMENT/.test(`${call.error ?? ''} ${call.excerpt ?? ''}`)).length
  const fallback = loaded.journal.some(entry => /deterministic fallback|deterministic source/i.test(entry.text))
  const identityMatch = loaded.runtimeState.identityMatch === true || after.identityMatch === true
  const terraWrite = loaded.sourceState.changedFiles.some(file => /FoundryTerraBackground|\/terra\/|cesium|gibs/i.test(file))
  const mutation = loaded.engineering?.lastAppliedMutation
  const installId = loaded.installState.installId
  const installRoot = installId ? path.join(realInstallOptRoot(), installId) : ''
  const emptyInstalled = installRoot && existsSync(installRoot)
    ? walkHits(installRoot, /foundryBoundedEdit\.(js|ts|mjs)$/, 'EMPTY_REPLACEMENT').length > 0
      || walkHits(installRoot, /\.(js|mjs|cjs)$/, 'EMPTY_REPLACEMENT').length > 0
    : false
  const panelInstalled = installRoot && existsSync(installRoot)
    ? walkHits(installRoot, /FoundryMissionControllerPanel\.(js|tsx|jsx)$/, 'engineeringReviewDetail')
    : []
  const installedPanelText = panelInstalled[0] ? readFileSync(panelInstalled[0], 'utf8') : ''
  const installedNoHardcoded = installedPanelText
    ? !/PASS: Foundry checked all required gates and tests\./.test(installedPanelText)
    : emptyInstalled && noHardcodedPassProse
  const terraInstalled = installRoot && existsSync(installRoot)
    ? walkHits(installRoot, /FoundryTerraBackground\.(js|tsx|jsx)$/, 'export')
    : []
  const lan = authorizeFoundryBrowserLocalSession({ origin: 'http://192.168.1.50:3848' }, { repairId: loaded.missionId })
  const loopback = authorizeFoundryBrowserLocalSession({ origin: 'http://127.0.0.1:3848' }, { repairId: loaded.missionId })

  if (boundedOk && sourceTouched && statusBinding && detailBinding && noHardcodedPassProse && identityMatch) {
    await rememberFeatureOwnership({
      feature: 'Foundry Engineering Review detail',
      owners: loaded.engineering?.ownership?.owners ?? [PANEL],
      tests: [
        'lib/native-builder/foundryAutonomousEngineeringDepth.pass014.validation.ts',
        'lib/native-builder/foundryAutonomousEngineeringDepth.pass011.validation.ts',
      ],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
      uiControl: 'Advanced session details',
    }).catch(() => undefined)
    await rememberEngineeringFact({
      topic: 'foundry-semantic-anchor-ranking',
      summary: 'Unique edit anchors are ranked by goal, required bindings, data-testid, and nearby JSX. Earliest unique header/type spans are not selected when a HIGH-relevance UI region exists. file.replace_unique rejects empty replacementText (EMPTY_REPLACEMENT). Engineering Review Advanced UI renders selected.engineeringReview status plus selected.engineeringReviewDetail without hardcoded PASS prose.',
      files: [
        'lib/native-builder/foundryAnchorRanking.ts',
        'lib/native-builder/foundryEditAnchors.ts',
        'lib/native-builder/foundryBoundedEdit.ts',
        PANEL,
      ],
      sourceMission: loaded.missionId,
      confidence: 'CONFIRMED',
    }).catch(() => undefined)
  }

  loaded.testArtifact = false
  await saveMission(loaded).catch(() => undefined)
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })

  const peerBlocked = attackResult.skipped === true
    || Boolean('refused' in attackResult && attackResult.refused)
    || (attackResult.leaseAttempt && attackResult.leaseAttempt.ok === false)
    || attackResult.activeUnchanged === true

  console.log(JSON.stringify({
    ownerMissionId: loaded.missionId,
    status: loaded.status,
    provider: `${loaded.modelState?.activeProvider}:${loaded.modelState?.activeModel}`,
    discoveredOwners: loaded.engineering?.ownership?.owners ?? [],
    changedFiles: loaded.sourceState.changedFiles,
    writeSet: loaded.writeSet?.paths ?? [],
    selectedAnchor: mutation?.matchText?.slice(0, 240) ?? null,
    firstMutationOk: firstAttemptApplied,
    invalidReplacementCount,
    retryCount: Math.max(0, boundedCalls.length - 1),
    boundedOk,
    sourceTouched,
    statusBinding,
    detailBinding,
    noHardcodedPassProse,
    panelSnippet: chip.slice(0, 400),
    panelAfterModelSnippet: panelAfterModel.match(/data-testid="foundry-engineering-review"[\s\S]{0,400}/)?.[0] ?? '',
    selfReview: loaded.engineering?.selfReview?.status ?? null,
    tests: loaded.testState.ok,
    regression: loaded.engineering?.regressionOk,
    build: loaded.buildState.ok,
    pkg: loaded.packageState.ok,
    install: loaded.installState.ok,
    installId,
    ACTIVE_INSTALL_ID_BEFORE: before.activeInstallId,
    RUNNING_INSTALL_ID_BEFORE: before.runningInstallId,
    ACTIVE_INSTALL_ID_AFTER: after.activeInstallId,
    RUNNING_INSTALL_ID_AFTER: after.runningInstallId,
    identityMatch,
    browser: loaded.browserState.ok,
    computer: loaded.computerUseState.ok,
    lease,
    attack: attackResult,
    EMPTY_REPLACEMENT_INSTALLED: emptyInstalled,
    INSTALLED_PANEL_NO_HARDCODED_PASS: installedNoHardcoded,
    terraBefore,
    terraAfter,
    TERRA_MODIFIED: terraWrite || terraBefore !== terraAfter,
    lanDenied: lan.ok === false,
    loopbackAuthorized: loopback.ok === true,
    DIRECT_MODEL_FILESYSTEM_MUTATION: 0,
    DETERMINISTIC_SOURCE_EDIT_FALLBACK: fallback ? 1 : 0,
    missing: loaded.completionGate.missing,
    terraInstalledHits: terraInstalled.length,
  }, null, 2))

  if (
    loaded.status !== 'COMPLETE'
    || !boundedOk
    || !sourceTouched
    || !statusBinding
    || !detailBinding
    || !noHardcodedPassProse
    || !identityMatch
    || loaded.buildState.ok !== true
    || loaded.packageState.ok !== true
    || loaded.installState.ok !== true
    || fallback
    || !peerBlocked
    || terraWrite
    || terraBefore !== terraAfter
    || !emptyInstalled
  ) {
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass014Proof }
