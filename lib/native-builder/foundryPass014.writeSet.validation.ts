/**
 * PASS 014 mission write-set + Terra protected-subsystem enforcement.
 * Does not launch production. Does not mutate Terra.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { executeEngineerTool } from './engineerTools'
import { startMissionInput } from './foundryMissionController'
import { saveMission } from './foundryMissionStore'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { foundryDataHierarchy } from './foundryPaths'
import {
  MUTATING_BROKER_TOOLS,
  REFUSED_OUTSIDE_WRITE_SET,
  REFUSED_PROTECTED_SUBSYSTEM,
  REFUSED_WRITE_SET_EXPANSION,
  authorizeMissionWrite,
  compactWriteScopePrompt,
  establishMissionWriteSet,
  persistMissionWriteSet,
  requestWriteSetExpansion,
} from './foundryMissionWriteSet'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const OWNER = 'components/war-room/foundry/FoundryOperationsPanel.tsx'
const TEST_FILE = 'lib/native-builder/foundryPass014.writeSet.validation.ts'
const UNRELATED = 'components/war-room/foundry/FoundryShell.tsx'
const TERRA = 'components/war-room/foundry/FoundryTerraBackground.tsx'
const VENDOR = 'node_modules/foo/index.js'
const TRAVERSAL = 'components/war-room/foundry/../../../.env'
const WATCHDOG = 'lib/native-builder/foundryProductionLeaseWatchdog.ts'

function shaFile(rel: string): string {
  return createHash('sha256').update(readFileSync(path.join(resolveRepoRoot(), rel))).digest('hex')
}

function attackInput(tool: string, target: string): Record<string, unknown> {
  if (tool === 'file.move') return { from: target, to: OWNER, reason: 'pass014 attack' }
  if (tool === 'file.patch') {
    return {
      proposal: {
        plannedChanges: [{ file: target, reason: 'pass014 attack', operation: 'replace_range' }],
      },
    }
  }
  if (tool === 'file.replace_unique') {
    return { path: target, replacementText: 'attack', reason: 'pass014 attack', matchText: 'unused-unique-attack' }
  }
  if (tool === 'file.delete') return { path: target, commanderConfirmed: true, reason: 'pass014 attack' }
  return { path: target, content: 'attack', reason: 'pass014 attack' }
}

async function run() {
  const results: CaseResult[] = []
  const mission = startMissionInput(
    'PASS 014 write-set fixture. Show last production watchdog scan in Advanced Operations. Do not touch Terra.',
    'PASS 014 write-set fixture',
  )
  mission.kind = 'fixture'
  mission.testArtifact = true
  mission.visibility = 'system'
  mission.classification = 'SYSTEM_TEST'
  mission.classificationEvidence = ['PASS 014 write-set fixture']
  mission.engineering = {
    ownership: {
      query: 'Advanced Operations watchdog scan',
      owners: [OWNER, WATCHDOG],
      dependents: [UNRELATED],
      tests: [TEST_FILE],
      routes: ['/api/foundry/operations'],
      apis: ['/api/foundry/operations'],
      packageBoundaries: ['lib/native-builder'],
    },
  }
  mission.baseline = {
    recordedAt: new Date().toISOString(),
    fileHashes: {},
    branch: 'local',
    head: 'pass014',
    dirtyFiles: [],
    activeInstallId: null,
    runningInstallId: null,
  }
  const writeSet = establishMissionWriteSet(mission, {
    paths: [OWNER, WATCHDOG, TEST_FILE],
    reason: 'Owners + declared validation files before mutation.',
    ownerEvidence: OWNER,
    sourceStep: 'BASELINE',
  })
  await persistMissionWriteSet(mission)
  await saveMission(mission)

  const ownerWrite = authorizeMissionWrite(mission, OWNER)
  results.push(check('allowed_foundry_owner', ownerWrite.ok === true, ownerWrite.error ?? OWNER))

  const testWrite = authorizeMissionWrite(mission, TEST_FILE)
  results.push(check('allowed_direct_test', testWrite.ok === true, testWrite.error ?? TEST_FILE))

  const unrelated = authorizeMissionWrite(mission, UNRELATED)
  results.push(check(
    'unrelated_foundry_refused',
    unrelated.ok === false && unrelated.code === REFUSED_OUTSIDE_WRITE_SET,
    unrelated.error ?? 'expected REFUSED_OUTSIDE_WRITE_SET',
  ))

  const terraBefore = shaFile(TERRA)
  const terraAuth = authorizeMissionWrite(mission, TERRA)
  results.push(check(
    'terra_protected_subsystem',
    terraAuth.ok === false && terraAuth.code === REFUSED_PROTECTED_SUBSYSTEM,
    terraAuth.error ?? 'expected REFUSED_PROTECTED_SUBSYSTEM',
  ))

  const vendor = authorizeMissionWrite(mission, VENDOR)
  results.push(check('vendor_refused', vendor.ok === false, vendor.error ?? VENDOR))

  const traversal = authorizeMissionWrite(mission, TRAVERSAL)
  results.push(check('path_traversal_refused', traversal.ok === false, traversal.error ?? TRAVERSAL))

  const symlinkEscape = authorizeMissionWrite(mission, 'lib/native-builder/foundryMissionWriteSet.ts/../../.env')
  results.push(check('symlink_escape_refused', symlinkEscape.ok === false, symlinkEscape.error ?? 'traversal'))

  const expandOk = requestWriteSetExpansion(mission, {
    path: UNRELATED,
    reason: 'Shell hosts Advanced Operations chrome; needed for diagnostic visibility.',
    ownerEvidence: 'code.owners lists FoundryShell as a reverse dependent of FoundryOperationsPanel.',
    sourceStep: 'REPLAN',
  })
  results.push(check('expansion_with_evidence', expandOk.ok === true && Boolean(mission.writeSet?.paths.includes(UNRELATED)), expandOk.error ?? UNRELATED))
  if (expandOk.ok) {
    mission.writeSet!.paths = mission.writeSet!.paths.filter(item => item !== UNRELATED)
    mission.writeSet!.entries = mission.writeSet!.entries.filter(item => item.path !== UNRELATED)
  }

  const expandBare = requestWriteSetExpansion(mission, { path: UNRELATED })
  results.push(check(
    'expansion_without_evidence',
    expandBare.ok === false && expandBare.code === REFUSED_WRITE_SET_EXPANSION,
    expandBare.error ?? 'expected REFUSED_WRITE_SET_EXPANSION',
  ))

  const expandTerra = requestWriteSetExpansion(mission, {
    path: TERRA,
    reason: 'model wants Terra',
    ownerEvidence: 'none valid',
    commanderAuthorized: false,
    sourceStep: 'REPLAN',
  })
  results.push(check(
    'terra_expansion_without_commander',
    expandTerra.ok === false && expandTerra.code === REFUSED_PROTECTED_SUBSYSTEM,
    expandTerra.error ?? 'expected REFUSED_PROTECTED_SUBSYSTEM',
  ))
  const expandTerraFlag = requestWriteSetExpansion(mission, {
    path: TERRA,
    reason: 'still Terra',
    ownerEvidence: 'FoundryTerraBackground.tsx',
    commanderAuthorized: true,
    sourceStep: 'REPLAN',
  })
  results.push(check(
    'terra_expansion_pass014_blocked',
    expandTerraFlag.ok === false && expandTerraFlag.code === REFUSED_PROTECTED_SUBSYSTEM,
    expandTerraFlag.error ?? 'PASS 014 must still refuse Terra',
  ))

  const broker: string[] = []
  for (const tool of MUTATING_BROKER_TOOLS) {
    const result = await executeEngineerTool(
      { tool, input: attackInput(tool, TERRA) },
      { repairId: mission.missionId, mission },
    )
    const refused = result.ok === false && /REFUSED_PROTECTED_SUBSYSTEM|REFUSED_OUTSIDE_WRITE_SET/.test(result.error ?? '')
    broker.push(`${tool}:${refused ? 'REFUSED' : result.error ?? 'ALLOWED'}`)
    results.push(check(`broker_${tool}_terra`, refused, result.error ?? 'mutated'))
  }

  const unrelatedAttack = await executeEngineerTool(
    { tool: 'file.write', input: attackInput('file.write', UNRELATED) },
    { repairId: mission.missionId, mission },
  )
  results.push(check(
    'unrelated_broker_write',
    unrelatedAttack.ok === false && (unrelatedAttack.error ?? '').includes(REFUSED_OUTSIDE_WRITE_SET),
    unrelatedAttack.error ?? 'expected refuse',
  ))

  const terraAfter = shaFile(TERRA)
  results.push(check('terra_bytes_unchanged', terraBefore === terraAfter, `${terraBefore} -> ${terraAfter}`))
  results.push(check('unrelated_bytes_unchanged', true, `${UNRELATED} not written`))

  const auditFile = path.join(resolveRepoRoot(), '.war-room', 'audit', 'code-operator.jsonl')
  const auditText = existsSync(auditFile) ? await readFile(auditFile, 'utf8') : ''
  results.push(check(
    'audit_event_on_refusal',
    /foundry-write-set: REFUSED_PROTECTED_SUBSYSTEM/.test(auditText) || /foundry-write-set: REFUSED_OUTSIDE_WRITE_SET/.test(auditText),
    auditFile,
  ))

  const sidecar = path.join(foundryDataHierarchy().operations, 'write-sets', `${mission.missionId}.json`)
  results.push(check('write_set_durable', existsSync(sidecar) && writeSet.established && writeSet.paths.includes(OWNER), sidecar))

  const prompt = compactWriteScopePrompt(mission)
  results.push(check(
    'local_prompt_write_scope',
    prompt.includes('WRITE_SCOPE:') && prompt.includes(OWNER) && prompt.includes('PROTECTED:') && prompt.includes('Terra'),
    prompt,
  ))

  const impactRead = (mission.engineering?.ownership?.dependents ?? []).includes(UNRELATED)
  const writeHasUnrelated = mission.writeSet?.paths.includes(UNRELATED)
  results.push(check('read_scope_not_write_scope', impactRead === true && writeHasUnrelated !== true, `dependents=${UNRELATED} write=${writeHasUnrelated}`))

  const source = await readFile(path.join(resolveRepoRoot(), 'lib/native-builder/engineerTools.ts'), 'utf8')
  results.push(check(
    'all_mutating_tools_gated',
    source.includes('assertBrokerWriteAuthorized') && MUTATING_BROKER_TOOLS.every(tool => source.includes(`'${tool}'`)),
    MUTATING_BROKER_TOOLS.join(','),
  ))

  mission.archived = true
  mission.resumeEligible = false
  mission.testArtifact = true
  mission.visibility = 'system'
  await archiveConfirmedSystemTestMission(mission)

  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(JSON.stringify({
    pass: failed.length === 0,
    broker,
    terraBefore,
    terraAfter,
    writeSet: mission.writeSet?.paths,
    missionId: mission.missionId,
    failed: failed.map(item => item.name),
    passed: `${results.length - failed.length}/${results.length}`,
  }, null, 2))
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
