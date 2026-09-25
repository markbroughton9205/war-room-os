/**
 * PASS 014 — 5-run local 14B target-selection fixture.
 * Large TSX with header types and a lower Engineering Review region.
 * Requires 5/5 CORRECT_TARGET_REGION. Not a production install.
 */
import { pathToFileURL } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { startMission, runModelMission } from './foundryMissionController'
import { saveMission } from './foundryMissionStore'
import { ensureEngineeringState } from './foundryEngineeringDepth'
import { resolveLocalModelHealth } from './localModelHealth'
import { persistFoundryRuntimeConfig } from './foundryRuntimeConfig'
import { FOUNDRY_DEFAULT_FALLBACK_MODEL, FOUNDRY_DEFAULT_PRIMARY_MODEL } from './foundryOperationsTypes'
import { archiveConfirmedSystemTestMission } from './foundryMissionVisibility'
import { releaseMissionResources } from './foundryResourceLocks'
import { BOUNDED_EDIT_TOOL } from './foundryBoundedEdit'
import { establishMissionWriteSet } from './foundryMissionWriteSet'
import { resolveRepoRoot } from '@/lib/repo/paths'

const ROOT = resolveRepoRoot()
const REL = 'scripts/foundry/bounded-edit/pass014-target.tsx'
const RUNS = 5

function targetSource(): string {
  return [
    'export type Mission = {',
    '  id: string',
    '  plan: Array<{ id: string; title: string; status: string }>',
    '  engineeringReview?: \'PASS\' | \'FAIL\' | \'PENDING\'',
    '  engineeringReviewDetail?: string | null',
    '}',
    '',
    'export function Header() {',
    '  return <h1 data-testid="mission-header">Mission Controller Header UNIQUE_HEADER_ALPHA</h1>',
    '}',
    '',
    ...Array.from({ length: 80 }, (_, i) => `const PAD_${i} = ${i};`),
    '',
    'export function StatusCard() {',
    '  return <p>Status UNIQUE_STATUS_DISTRACTOR</p>',
    '}',
    '',
    'export function ReviewPanel(selected: { engineeringReview?: \'PASS\' | \'FAIL\' | \'PENDING\'; engineeringReviewDetail?: string | null }) {',
    '  return (',
    '    <div className="rounded border border-white/10 p-2" data-testid="foundry-engineering-review" aria-label="Engineering review status">',
    '      <p className="text-[9px] uppercase tracking-widest text-slate-500">ENGINEERING REVIEW</p>',
    '      <p className="text-sm font-bold text-emerald-200">{selected.engineeringReview === \'PASS\' ? \'PASS: Foundry checked all required gates and tests.\' : selected.engineeringReview === \'FAIL\' ? \'FAIL\' : \'PENDING\'} {selected.engineeringReviewDetail}</p>',
    '    </div>',
    '  )',
    '}',
    '',
  ].join('\n')
}

function writeFixture() {
  mkdirSync(path.join(ROOT, 'scripts/foundry/bounded-edit'), { recursive: true })
  writeFileSync(path.join(ROOT, REL), targetSource())
}

function isCorrectTarget(matchText: string | undefined, replacement: string | undefined, after: string): boolean {
  const match = matchText ?? ''
  const targetish = /engineeringReview|ENGINEERING REVIEW|foundry-engineering-review/.test(match)
  const headerish = /UNIQUE_HEADER_ALPHA|export type Mission|plan: Array/.test(match) && !targetish
  const empty = !String(replacement ?? '').trim()
  return targetish
    && !headerish
    && !empty
    && /selected\.engineeringReview/.test(after)
    && /selected\.engineeringReviewDetail/.test(after)
    && /UNIQUE_HEADER_ALPHA/.test(after)
    && /export type Mission/.test(after)
    && /plan: Array/.test(after)
    && !/PASS: Foundry checked all required gates and tests\./.test(after)
}

async function runOne(index: number) {
  writeFixture()
  const request = `Edit ONLY ${REL}. Remove the redundant hardcoded Engineering Review PASS explanation from the lower ReviewPanel UI and use selected.engineeringReviewDetail as the explanation. Keep selected.engineeringReview and PASS/FAIL/PENDING status. Do not edit the Mission type, Header, or PAD constants. Search for that exact path, focused-read it, then file.replace_unique using the HIGH-relevance returned anchorId. Do not use an empty replacementText. This is a test application fixture, not a production install.`
  const mission = await startMission(request, `PASS 014 target fixture ${index + 1}`)
  mission.candidateFiles = [REL]
  mission.importantPaths = [REL]
  mission.kind = 'fixture'
  const engineering = ensureEngineeringState(mission)
  engineering.allowedChangeSet = [REL]
  engineering.ownership = {
    query: request,
    owners: [REL],
    dependents: [],
    tests: ['lib/native-builder/foundryAnchorTarget.pass014.fixture.proof.ts'],
    routes: [],
    apis: [],
    packageBoundaries: ['scripts/foundry/bounded-edit'],
  }
  establishMissionWriteSet(mission, {
    paths: [REL],
    readScope: [REL],
    reason: 'PASS 014 target-selection fixture is the only writable owner.',
    ownerEvidence: REL,
    sourceStep: 'FIXTURE',
  })
  await saveMission(mission)
  const run = await runModelMission(mission.missionId)
  const after = existsSync(path.join(ROOT, REL)) ? readFileSync(path.join(ROOT, REL), 'utf8') : ''
  const replaces = run.toolCalls.filter(call => call.tool === BOUNDED_EDIT_TOOL)
  const mutation = run.engineering?.lastAppliedMutation
  const first = replaces[0]
  const emptyAttempt = replaces.some(call => /EMPTY_REPLACEMENT/.test(`${call.error ?? ''} ${call.excerpt ?? ''}`))
    || (mutation != null && !String(mutation.replacementText ?? '').trim())
  const headerMutated = !/UNIQUE_HEADER_ALPHA/.test(after) || !/export type Mission/.test(after) || !/plan: Array/.test(after)
  const correct = isCorrectTarget(mutation?.matchText, mutation?.replacementText, after) && !headerMutated
  run.testArtifact = true
  run.visibility = 'system'
  run.resumeEligible = false
  run.archived = true
  await archiveConfirmedSystemTestMission(run).catch(() => undefined)
  await releaseMissionResources(run.missionId).catch(() => undefined)
  writeFixture()
  return {
    run: index + 1,
    missionId: run.missionId,
    status: run.status,
    CORRECT_TARGET_REGION: correct,
    firstOk: Boolean(first?.ok),
    emptyAttempt,
    headerMutated,
    matchPreview: (mutation?.matchText ?? first?.excerpt ?? '').slice(0, 180),
    provider: `${run.modelState?.activeProvider}:${run.modelState?.activeModel}`,
  }
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
  const rows = []
  for (let i = 0; i < RUNS; i += 1) {
    rows.push(await runOne(i))
  }
  const correct = rows.filter(item => item.CORRECT_TARGET_REGION).length
  persistFoundryRuntimeConfig({
    primaryModel: FOUNDRY_DEFAULT_PRIMARY_MODEL,
    fallbackModel: FOUNDRY_DEFAULT_FALLBACK_MODEL,
    providerPolicy: 'AUTO',
  })
  console.log(JSON.stringify({
    TARGET_SELECTION_FIXTURE_5_OF_5: correct === RUNS ? 'PASS' : 'FAIL',
    correctTargetRate: `${correct}/${RUNS}`,
    rows,
  }, null, 2))
  if (correct !== RUNS) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAnchorTargetPass014FixtureProof }
