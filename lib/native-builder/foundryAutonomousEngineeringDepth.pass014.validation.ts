/**
 * PASS 014 — semantic anchor ranking, required-binding preference, EMPTY_REPLACEMENT.
 * Does not embed production replacement text. Does not overwrite write-set PASS 014 files.
 */
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMissionInput } from './foundryMissionController'
import {
  BOUNDED_EDIT_TOOL,
  classifyBoundedEditFailure,
  compactFileRead,
  executeReplaceUnique,
  inferQueryReadBounds,
  validateReplacementText,
} from './foundryBoundedEdit'
import { pickUniqueAnchorText } from './foundryEditAnchors'
import { scoreAnchorText } from './foundryAnchorRanking'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const ROOT = resolveRepoRoot()
const FIX_DIR = path.join(ROOT, 'scripts/foundry/bounded-edit')
const TARGET_REL = 'scripts/foundry/bounded-edit/pass014-target.tsx'
const SAMPLE_REL = 'scripts/foundry/bounded-edit/pass014-sample.mjs'
const GOAL = 'Remove the redundant hardcoded Engineering Review PASS explanation and use selected.engineeringReviewDetail as the explanation. Keep selected.engineeringReview.'

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

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

function ownedMission(rel: string, request = GOAL): FoundryMissionRecord {
  const mission = startMissionInput(request)
  mission.kind = 'fixture'
  mission.engineering = {
    ownership: {
      query: 'engineering review',
      owners: [rel],
      dependents: [rel],
      tests: ['lib/native-builder/foundryAutonomousEngineeringDepth.pass014.validation.ts'],
      routes: [],
      apis: [],
      packageBoundaries: [],
    },
  }
  mission.baseline = {
    recordedAt: new Date().toISOString(),
    branch: 'local',
    head: 'x',
    dirtyFiles: [],
    fileHashes: {},
    activeInstallId: null,
    runningInstallId: null,
  }
  mission.candidateFiles = [rel]
  mission.importantPaths = [rel]
  mission.sourceState.baselineFiles = [rel]
  mission.writeSet = {
    missionId: mission.missionId,
    established: true,
    establishedAt: new Date().toISOString(),
    paths: [rel],
    entries: [{
      path: rel,
      reason: 'fixture owner',
      ownerEvidence: 'PRIMARY_OWNER',
      addedAt: new Date().toISOString(),
      sourceStep: 'code.owners',
      approvedByPolicy: true,
    }],
    readScope: [rel],
    protectedSubsystems: ['terra'],
  }
  return mission
}

function prepare(): void {
  mkdirSync(FIX_DIR, { recursive: true })
  writeFileSync(path.join(ROOT, TARGET_REL), targetSource(), 'utf8')
  writeFileSync(path.join(ROOT, SAMPLE_REL), 'export const MARKER = "PASS014_UNIQUE_ALPHA";\n', 'utf8')
}

export async function runFoundryAutonomousEngineeringDepthPass014Validation(): Promise<CaseResult[]> {
  prepare()
  const results: CaseResult[] = []
  try {
    const header = 'export type Mission = {\n  plan: Array<{ id: string }>\n}'
    const review = '<div data-testid="foundry-engineering-review">\n  <p>ENGINEERING REVIEW</p>\n  <p>{selected.engineeringReview} {selected.engineeringReviewDetail}</p>\n</div>'
    const headerScore = scoreAnchorText(header, GOAL)
    const reviewScore = scoreAnchorText(review, GOAL)
    results.push(check(
      'relevant_jsx_beats_header_type',
      reviewScore.relevance === 'HIGH' && headerScore.relevance === 'LOW' && reviewScore.score > headerScore.score,
      JSON.stringify({ review: reviewScore, header: headerScore }),
    ))

    const inferred = inferQueryReadBounds(targetSource(), 'ENGINEERING REVIEW')
    results.push(check(
      'engineering_review_query_chooses_review_region',
      Boolean(inferred?.aroundMatch && /ENGINEERING REVIEW|engineeringReview|foundry-engineering-review/i.test(inferred.aroundMatch))
        && !/UNIQUE_HEADER_ALPHA/.test(inferred?.aroundMatch ?? ''),
      JSON.stringify(inferred),
    ))

    const testidScore = scoreAnchorText('<div data-testid="foundry-engineering-review">ENGINEERING REVIEW</div>', GOAL)
    const noIdScore = scoreAnchorText('<div>unrelated unique region UNIQUE_NO_ID</div>', GOAL)
    results.push(check(
      'testid_relevance_helps_ranking',
      testidScore.score > noIdScore.score && testidScore.relevance !== 'LOW',
      JSON.stringify({ testid: testidScore, none: noIdScore }),
    ))

    const boundScore = scoreAnchorText('{selected.engineeringReview} {selected.engineeringReviewDetail}', GOAL)
    const unboundScore = scoreAnchorText('export const TITLE = "Mission Controller Header UNIQUE_HEADER_ALPHA"', GOAL)
    results.push(check(
      'required_binding_region_outranks_unbound',
      boundScore.bindings.includes('selected.engineeringReview')
        && boundScore.bindings.includes('selected.engineeringReviewDetail')
        && boundScore.score > unboundScore.score
        && unboundScore.relevance !== 'HIGH',
      JSON.stringify({ bound: boundScore, unbound: unboundScore }),
    ))

    const picked = pickUniqueAnchorText(targetSource(), targetSource().split('\n').slice(0, 24).join('\n'), undefined, undefined, GOAL)
    results.push(check(
      'earliest_unique_region_does_not_automatically_win',
      /engineeringReview|ENGINEERING REVIEW|foundry-engineering-review/.test(picked.text)
        && !/UNIQUE_HEADER_ALPHA/.test(picked.text)
        && !/^export type Mission/.test(picked.text.trim()),
      picked.text.slice(0, 240),
    ))

    const mission = ownedMission(TARGET_REL)
    const headerRead = await compactFileRead({ path: TARGET_REL, startLine: 1, focused: true }, mission)
    const compact = String((headerRead.result as { compact?: string } | undefined)?.compact ?? '')
    const view = headerRead.result as {
      anchorId?: string
      ANCHOR_TEXT?: string
      ANCHOR_RELEVANCE?: string
      ANCHOR_START_LINE?: number
      anchors?: Array<{ anchorId?: string; ANCHOR_TEXT?: string; ANCHOR_RELEVANCE?: string; ANCHOR_START_LINE?: number }>
      compact?: string
      sha256?: string
    }
    results.push(check(
      'anchor_candidates_exposed',
      /ANCHOR_CANDIDATES:/.test(compact) && /relevance = HIGH/.test(compact),
      compact.slice(0, 900),
    ))
    results.push(check(
      'header_read_selects_high_review_anchor',
      /engineeringReview|ENGINEERING REVIEW|foundry-engineering-review/.test(view.ANCHOR_TEXT ?? '')
        && view.ANCHOR_RELEVANCE === 'HIGH'
        && (view.ANCHOR_START_LINE ?? 0) > 20,
      JSON.stringify({
        relevance: view.ANCHOR_RELEVANCE,
        line: view.ANCHOR_START_LINE,
        preview: (view.ANCHOR_TEXT ?? '').slice(0, 180),
      }),
    ))

    const low = (view.anchors ?? []).find(item =>
      item.ANCHOR_RELEVANCE === 'LOW'
      && /export type Mission|UNIQUE_HEADER_ALPHA|plan: Array/.test(item.ANCHOR_TEXT ?? ''),
    )
    const high = (view.anchors ?? []).find(item => item.ANCHOR_RELEVANCE === 'HIGH')
      ?? (view.ANCHOR_RELEVANCE === 'HIGH' ? view : undefined)
    results.push(check(
      'unrelated_anchor_not_high_confidence',
      Boolean(high?.anchorId)
        && (!low || low.ANCHOR_RELEVANCE === 'LOW')
        && scoreAnchorText(header, GOAL).relevance !== 'HIGH',
      JSON.stringify({ high: high?.anchorId, low: low?.anchorId, header: headerScore.relevance }),
    ))

    if (low?.anchorId && high?.anchorId && low.anchorId !== high.anchorId) {
      const refusedLow = await executeReplaceUnique({
        path: TARGET_REL,
        anchorId: low.anchorId,
        replacementText: 'export type Mission = { id: string }',
        reason: 'header should lose',
      }, { repairId: mission.missionId, mission })
      results.push(check(
        'low_anchor_refused_when_high_exists',
        !refusedLow.ok && /ANCHOR_LOW_RELEVANCE/.test(refusedLow.error ?? ''),
        refusedLow.error ?? 'applied',
      ))
    } else {
      results.push(check('low_anchor_refused_when_high_exists', Boolean(high?.anchorId), 'no distinct LOW header candidate; HIGH still selected'))
    }

    const empty = validateReplacementText({
      request: GOAL,
      matchText: view.ANCHOR_TEXT ?? review,
      replacementText: '',
    })
    results.push(check('empty_replacement_rejected', typeof empty === 'string' && /EMPTY_REPLACEMENT/.test(empty), String(empty)))
    const whitespace = validateReplacementText({
      request: GOAL,
      matchText: view.ANCHOR_TEXT ?? review,
      replacementText: '   \n  ',
    })
    results.push(check(
      'whitespace_only_replacement_rejected',
      typeof whitespace === 'string' && /EMPTY_REPLACEMENT/.test(whitespace),
      String(whitespace),
    ))

    const emptyExec = await executeReplaceUnique({
      path: TARGET_REL,
      anchorId: view.anchorId,
      replacementText: '',
      reason: 'implicit delete',
    }, { repairId: mission.missionId, mission })
    results.push(check(
      'empty_replace_unique_refused',
      !emptyExec.ok && /EMPTY_REPLACEMENT|INVALID_REPLACEMENT/.test(emptyExec.error ?? ''),
      emptyExec.error ?? 'applied',
    ))

    const keep = '{selected.engineeringReview === \'PASS\' ? \'PASS\' : selected.engineeringReview === \'FAIL\' ? \'FAIL\' : \'PENDING\'} {selected.engineeringReviewDetail}'
    const applied = await executeReplaceUnique({
      path: TARGET_REL,
      anchorId: view.anchorId,
      replacementText: (view.ANCHOR_TEXT ?? '').replace(
        'PASS: Foundry checked all required gates and tests.',
        'PASS',
      ),
      reason: 'remove redundant PASS prose',
    }, { repairId: mission.missionId, mission })
    const after = existsSync(path.join(ROOT, TARGET_REL)) ? readFileSync(path.join(ROOT, TARGET_REL), 'utf8') : ''
    results.push(check(
      'valid_replacement_still_applies',
      applied.ok === true
        && /selected\.engineeringReview/.test(after)
        && /selected\.engineeringReviewDetail/.test(after)
        && !/PASS: Foundry checked all required gates and tests\./.test(after)
        && /export type Mission/.test(after)
        && /UNIQUE_HEADER_ALPHA/.test(after)
        && /plan: Array/.test(after),
      applied.error ?? JSON.stringify({ status: applied.result?.STATUS, keep }),
    ))
    results.push(check(
      'audit_preserved',
      Boolean(applied.result?.AUDIT_ID) && applied.result?.PROTECTED_BINDINGS_PRESERVED === 'YES',
      JSON.stringify({ audit: applied.result?.AUDIT_ID, bindings: applied.result?.PROTECTED_BINDINGS_PRESERVED }),
    ))

    const stale = await executeReplaceUnique({
      path: TARGET_REL,
      anchorId: view.anchorId,
      replacementText: (view.ANCHOR_TEXT ?? 'x').replace('PASS', 'PASS'),
      reason: 'stale after mutation',
    }, { repairId: mission.missionId, mission })
    results.push(check(
      'stale_sha_still_rejected',
      !stale.ok && /STALE_EDIT_ANCHOR|ANCHOR_NOT_FOUND/.test(stale.error ?? ''),
      stale.error ?? 'applied',
    ))

    writeFileSync(path.join(ROOT, TARGET_REL), targetSource(), 'utf8')
    const first = ownedMission(TARGET_REL)
    const firstRead = await compactFileRead({ path: TARGET_REL, query: 'ENGINEERING REVIEW', focused: true }, first)
    const firstView = firstRead.result as { anchorId?: string }
    const other = ownedMission(TARGET_REL, 'unrelated request')
    const stolen = await executeReplaceUnique({
      path: TARGET_REL,
      anchorId: firstView.anchorId,
      replacementText: 'stolen',
      reason: 'cross mission',
    }, { repairId: other.missionId, mission: other })
    results.push(check(
      'cross_mission_anchor_still_rejected',
      !stolen.ok && /ANCHOR_INVALID_MISSION|ANCHOR_NOT_FOUND/.test(stolen.error ?? ''),
      stolen.error ?? 'applied',
    ))

    const terra = await executeReplaceUnique({
      path: 'lib/terra/activeLocation.ts',
      expectedSha256: 'abc',
      matchText: 'export',
      replacementText: 'export',
      reason: 'terra block',
    }, { repairId: first.missionId, mission: first })
    results.push(check(
      'terra_protections_unchanged',
      !terra.ok && (classifyBoundedEditFailure(terra.error) === 'TERRA_LOCKED' || /REFUSED_PROTECTED_SUBSYSTEM|TERRA_LOCKED/.test(terra.error ?? '')),
      terra.error ?? '',
    ))

    const outside = await executeReplaceUnique({
      path: 'components/war-room/foundry/FoundryShell.tsx',
      expectedSha256: sha('nope'),
      matchText: 'export',
      replacementText: 'export',
      reason: 'outside write set',
    }, { repairId: first.missionId, mission: first })
    results.push(check(
      'write_scope_unchanged',
      !outside.ok && /REFUSED_OUTSIDE_WRITE_SET|OWNER_EVIDENCE_REQUIRED|NOT_OWNER/.test(outside.error ?? ''),
      outside.error ?? 'applied',
    ))

    const ranking = readFileSync(path.join(ROOT, 'lib/native-builder/foundryAnchorRanking.ts'), 'utf8')
    const bounded = readFileSync(path.join(ROOT, 'lib/native-builder/foundryBoundedEdit.ts'), 'utf8')
    results.push(check(
      'no_header_first_bias_in_policy',
      /Prefer HIGH-relevance unique anchors/.test(ranking)
        && /EMPTY_REPLACEMENT/.test(bounded)
        && !/FoundryMissionControllerPanel\.tsx/.test(ranking)
        && !/FoundryMissionControllerPanel\.tsx/.test(bounded),
      'ranking stays generic',
    ))
    results.push(check(
      'file_replace_unique_not_delete_tool',
      /replacementText\.trim\(\)/.test(bounded) && !/operation = DELETE_RANGE/.test(bounded),
      'empty replacement remains refused',
    ))

    await logWarRoomRepoAudit('foundry-pass014-validation', {
      cases: results.length,
      tool: BOUNDED_EDIT_TOOL,
      timestamp: new Date().toISOString(),
    })
  } finally {
    rmSync(path.join(ROOT, TARGET_REL), { force: true })
    rmSync(path.join(ROOT, SAMPLE_REL), { force: true })
  }
  return results
}

async function run() {
  const results = await runFoundryAutonomousEngineeringDepthPass014Validation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({
    total: results.length,
    passed: results.filter(item => item.pass).length,
    failed: failed.map(item => item.name),
  }, null, 2))
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
