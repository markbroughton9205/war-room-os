/**
 * PASS 011 — generic protected-binding preservation and BOUNDED_RETRY action lock.
 * Does not embed the production panel, patch, or selected.engineeringReview special case.
 */
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMissionInput } from './foundryMissionController'
import {
  BOUNDED_EDIT_TOOL,
  classifyBoundedEditFailure,
  compactFileRead,
  executeReplaceUnique,
  requiredReplacementBindings,
  validateReplacementText,
} from './foundryBoundedEdit'
import { extractProtectedBindings, missingProtectedBindings } from './foundryProtectedBindings'
import { authorizeFoundryBrowserLocalSession } from './foundryBrowserService'
import { discoverWarRoomWindow, isCursorOrBrowserWindow, scoreWarRoomWindow } from './foundryComputerUse'
import {
  actionNotAllowedInBoundedRetry,
  boundedRetryLockFromMission,
  normalizeBoundedRetryToolName,
} from './foundryBoundedRetry'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import { buildEngineeringGateTable, genericToolExamplesLeakFixtureAnswers, evaluateBlockedDecision } from './foundryEngineeringGateTable'
import { beginEditMatchRecovery, invalidateAnchorsForPath, markFocusedReadComplete } from './foundryEditAnchors'
import { localToolsForMission } from './foundryLocalModelRuntime'
import { parseAndValidateModelDecision } from './foundryModelDecision'
import { listFixtureSpecificCoercionMarkers } from './foundryEngineeringContract'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const ROOT = resolveRepoRoot()
const FIX_DIR = path.join(ROOT, 'scripts/foundry/bounded-edit')
const CHIP_REL = 'scripts/foundry/bounded-edit/pass011-chip.tsx'
const DUAL_REL = 'scripts/foundry/bounded-edit/pass011-dual.tsx'
const MULTI_REL = 'scripts/foundry/bounded-edit/pass011-multi.tsx'
const LARGE_REL = 'scripts/foundry/bounded-edit/pass011-large.mjs'
const SAMPLE_REL = 'scripts/foundry/bounded-edit/pass011-sample.mjs'
const CONTROLLER = path.join(ROOT, 'lib/native-builder/foundryMissionController.ts')
const LOCAL = path.join(ROOT, 'lib/native-builder/foundryLocalModelRuntime.ts')
const GATES = path.join(ROOT, 'lib/native-builder/foundryEngineeringGateTable.ts')
const BOUNDED = path.join(ROOT, 'lib/native-builder/foundryBoundedEdit.ts')
const CONTRACT = path.join(ROOT, 'lib/native-builder/foundryEngineeringContract.ts')
const RETRY = path.join(ROOT, 'lib/native-builder/foundryBoundedRetry.ts')
const PROTECT = path.join(ROOT, 'lib/native-builder/foundryProtectedBindings.ts')

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function chipSource(): string {
  return [
    'export function ReviewChip(selected: { engineeringReview?: \'PASS\' | \'PENDING\' | \'FAIL\' }) {',
    '  return (',
    '    <div data-testid="foundry-engineering-review">',
    '      <p>ENGINEERING REVIEW</p>',
    '      <p>{selected.engineeringReview === \'PASS\' ? \'PASS\' : selected.engineeringReview === \'FAIL\' ? \'FAIL\' : \'PENDING\'}</p>',
    '    </div>',
    '  )',
    '}',
    '',
  ].join('\n')
}

function multiSource(): string {
  return [
    'export function ActionRow(props: { value: string }) {',
    '  return (',
    '    <button onClick={handleSubmit} value={props.value}>',
    '      {formatDate(mission.createdAt)} {selected.status}',
    '    </button>',
    '  )',
    '}',
    '',
  ].join('\n')
}

function dualSource(): string {
  return [
    'export function ReviewChip(selected: { engineeringReview?: \'PASS\' | \'PENDING\' | \'FAIL\'; engineeringReviewDetail?: string | null }) {',
    '  return (',
    '    <div data-testid="foundry-engineering-review">',
    '      <p>ENGINEERING REVIEW</p>',
    '      <p>{selected.engineeringReview === \'PASS\' ? \'PASS\' : selected.engineeringReview === \'FAIL\' ? \'FAIL\' : \'PENDING\'}</p>',
    '    </div>',
    '  )',
    '}',
    '',
  ].join('\n')
}

function largeContent(): string {
  return `${Array.from({ length: 220 }, (_, i) => `const PAD_${i} = ${i};`).join('\n')}\nexport const MARKER = "LARGE_UNIQUE_ALPHA";\n`
}

function ownedMission(rel: string, request = 'Add neighboring status detail to the review chip.'): FoundryMissionRecord {
  const mission = startMissionInput(request)
  mission.kind = 'fixture'
  mission.engineering = {
    ownership: {
      query: 'review chip',
      owners: [rel],
      dependents: [rel],
      tests: ['lib/native-builder/foundryAutonomousEngineeringDepth.pass011.validation.ts'],
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
  return mission
}

export async function runFoundryAutonomousEngineeringDepthPass011Validation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  mkdirSync(FIX_DIR, { recursive: true })
  writeFileSync(path.join(ROOT, CHIP_REL), chipSource(), 'utf8')
  writeFileSync(path.join(ROOT, DUAL_REL), dualSource(), 'utf8')
  writeFileSync(path.join(ROOT, MULTI_REL), multiSource(), 'utf8')
  writeFileSync(path.join(ROOT, LARGE_REL), largeContent(), 'utf8')
  writeFileSync(path.join(ROOT, SAMPLE_REL), 'export const MARKER = "UNIQUE_HUNK_ALPHA";\n', 'utf8')
  try {
    const controller = readFileSync(CONTROLLER, 'utf8')
    const local = readFileSync(LOCAL, 'utf8')
    const gates = readFileSync(GATES, 'utf8')
    const bounded = readFileSync(BOUNDED, 'utf8')
    const contract = readFileSync(CONTRACT, 'utf8')
    const retry = readFileSync(RETRY, 'utf8')
    const protect = readFileSync(PROTECT, 'utf8')
    const mutationPolicy = [local, bounded, retry, protect, contract].join('\n')

    const single = extractProtectedBindings('{selected.engineeringReview === \'PASS\' ? \'PASS\' : \'PENDING\'}')
    results.push(check(
      'anchor_with_one_protected_binding',
      single.includes('selected.engineeringReview') && !single.includes('selected.engineeringReviewDetail'),
      single.join(','),
    ))

    const many = extractProtectedBindings(multiSource())
    results.push(check(
      'multiple_protected_bindings_extracted',
      many.includes('selected.status')
        && many.includes('props.value')
        && many.includes('onClick')
        && many.includes('handleSubmit')
        && many.includes('formatDate')
        && many.includes('mission.createdAt'),
      many.join(','),
    ))

    const mission = ownedMission(CHIP_REL)
    const read = await compactFileRead({ path: CHIP_REL, aroundMatch: 'selected.engineeringReview', focused: true }, mission)
    const view = read.result as {
      anchorId?: string
      sha256?: string
      ANCHOR_TEXT?: string
      PROTECTED_BINDINGS?: string[]
      MISSION_ID?: string
      ANCHOR_UNIQUE?: boolean
      FILE_SHA256?: string
      compact?: string
    } | undefined
    const compact = String(view?.compact ?? '')
    results.push(check(
      'focused_read_returns_protected_bindings_contract',
      Boolean(view?.anchorId)
        && typeof view?.ANCHOR_TEXT === 'string'
        && (view?.PROTECTED_BINDINGS ?? []).includes('selected.engineeringReview')
        && view?.MISSION_ID === mission.missionId
        && view?.ANCHOR_UNIQUE === true
        && compact.includes('PROTECTED_BINDINGS')
        && compact.includes('Preserve all PROTECTED_BINDINGS')
        && compact.includes('EDITABLE_REGION')
        && compact.includes('MISSION_ID'),
      compact.slice(0, 500),
    ))

    const preserve = '<p>{selected.engineeringReview === \'PASS\' ? \'PASS\' : selected.engineeringReview === \'FAIL\' ? \'FAIL\' : \'PENDING\'}</p>\n      <p>Checked lint and typecheck.</p>'
    const keep = validateReplacementText({
      request: mission.userRequest,
      matchText: view?.ANCHOR_TEXT ?? '',
      replacementText: preserve,
      anchorId: view?.anchorId,
    })
    results.push(check('replacement_preserving_binding_pass', keep == null, keep ?? 'ok'))

    const drop = await executeReplaceUnique({
      path: CHIP_REL,
      anchorId: view?.anchorId,
      replacementText: '<p>Foundry checked lint and typecheck before passing.</p>',
      reason: 'drop status binding',
    }, { repairId: mission.missionId, mission })
    results.push(check(
      'replacement_dropping_binding_invalid',
      !drop.ok
        && classifyBoundedEditFailure(drop.error) === 'INVALID_REPLACEMENT'
        && /MISSING_PROTECTED_BINDINGS/.test(drop.error ?? '')
        && /selected\.engineeringReview/.test(drop.error ?? '')
        && /EXPECTED_NEXT_ACTION = BOUNDED_RETRY/.test(drop.error ?? ''),
      drop.error ?? 'applied',
    ))
    results.push(check(
      'invalid_replacement_lists_missing_bindings',
      /MISSING_PROTECTED_BINDINGS = \[selected\.engineeringReview\]/.test(drop.error ?? ''),
      drop.error ?? 'none',
    ))

    beginEditMatchRecovery(mission, { code: 'INVALID_REPLACEMENT', path: CHIP_REL, lastAnchorId: view?.anchorId })
    const afterInvalid = buildEngineeringGateTable(mission)
    const retryTools = localToolsForMission(mission)
    results.push(check(
      'controller_enters_bounded_retry',
      mission.engineering?.editMatchRecovery?.nextRequiredAction === 'BOUNDED_RETRY'
        && afterInvalid.recommendedToolClass === BOUNDED_EDIT_TOOL,
      JSON.stringify({ next: mission.engineering?.editMatchRecovery?.nextRequiredAction, rec: afterInvalid.recommendedToolClass }),
    ))
    results.push(check(
      'bounded_retry_allows_replace_unique',
      retryTools.some(item => item.name === BOUNDED_EDIT_TOOL) && afterInvalid.availableTools.includes(BOUNDED_EDIT_TOOL),
      JSON.stringify({ tools: retryTools.map(item => item.name), available: afterInvalid.availableTools }),
    ))
    results.push(check(
      'bounded_retry_refuses_file_read',
      !retryTools.some(item => item.name === 'file.read')
        && !afterInvalid.availableTools.includes('file.read')
        && /ACTION_NOT_ALLOWED_IN_STATE/.test(actionNotAllowedInBoundedRetry(mission, 'file.read') ?? ''),
      JSON.stringify({ tools: retryTools.map(item => item.name), refuse: actionNotAllowedInBoundedRetry(mission, 'file.read') }),
    ))
    results.push(check(
      'bounded_retry_refuses_workspace_search',
      !retryTools.some(item => item.name === 'workspace.search')
        && /ACTION_NOT_ALLOWED_IN_STATE/.test(actionNotAllowedInBoundedRetry(mission, 'workspace.search') ?? '')
        && /REQUIRED_TOOL = file.replace_unique/.test(actionNotAllowedInBoundedRetry(mission, 'workspace.search') ?? ''),
      actionNotAllowedInBoundedRetry(mission, 'workspace.search') ?? 'allowed',
    ))

    const staleMission = ownedMission(CHIP_REL)
    beginEditMatchRecovery(staleMission, { code: 'INVALID_REPLACEMENT', path: CHIP_REL, lastAnchorId: 'anc_keep' })
    markFocusedReadComplete(staleMission, CHIP_REL, 'anc_keep')
    const stale = beginEditMatchRecovery(staleMission, { code: 'STALE_EDIT_ANCHOR', path: CHIP_REL, lastAnchorId: 'anc_keep' })
    const staleTable = buildEngineeringGateTable(staleMission)
    results.push(check(
      'justified_stale_anchor_returns_focused_read',
      stale.nextRequiredAction === 'FOCUSED_READ'
        && stale.focusedReadDone === false
        && staleTable.recommendedToolClass === 'file.read',
      JSON.stringify({ next: stale.nextRequiredAction, rec: staleTable.recommendedToolClass }),
    ))

    const keepMission = ownedMission(CHIP_REL)
    const keepRead = await compactFileRead({ path: CHIP_REL, aroundMatch: 'selected.engineeringReview', focused: true }, keepMission)
    const keepView = keepRead.result as { anchorId?: string; sha256?: string } | undefined
    const applied = await executeReplaceUnique({
      path: CHIP_REL,
      anchorId: keepView?.anchorId,
      replacementText: preserve,
      reason: 'additive preserving edit',
    }, { repairId: keepMission.missionId, mission: keepMission })
    const afterApply = readFileSync(path.join(ROOT, CHIP_REL), 'utf8')
    results.push(check(
      'anchor_only_replace_without_matchtext',
      applied.ok === true
        && applied.result?.STATUS === 'APPLIED'
        && applied.result?.MATCH_COUNT === 1
        && Boolean(applied.result?.OLD_SHA256)
        && Boolean(applied.result?.NEW_SHA256)
        && applied.result?.PROTECTED_BINDINGS_PRESERVED === 'YES'
        && afterApply.includes('selected.engineeringReview'),
      JSON.stringify({ ok: applied.ok, error: applied.error, result: applied.result }),
    ))
    results.push(check(
      'anchor_only_replace_without_model_sha',
      applied.ok === true && keepView?.sha256 === applied.result?.OLD_SHA256,
      JSON.stringify({ old: applied.result?.OLD_SHA256, read: keepView?.sha256 }),
    ))
    results.push(check(
      'anchor_sha_bound_internally',
      Boolean(keepView?.sha256) && keepView?.sha256 === sha(chipSource()),
      keepView?.sha256 ?? 'missing',
    ))

    const replay = await executeReplaceUnique({
      path: CHIP_REL,
      anchorId: keepView?.anchorId,
      replacementText: preserve,
      reason: 'stale after mutation',
    }, { repairId: keepMission.missionId, mission: keepMission })
    results.push(check(
      'anchor_invalid_after_mutation',
      !replay.ok && /STALE_EDIT_ANCHOR|ANCHOR_NOT_FOUND/.test(replay.error ?? ''),
      replay.error ?? 'applied',
    ))

    const other = ownedMission(CHIP_REL, 'unrelated request')
    const stolen = await executeReplaceUnique({
      path: CHIP_REL,
      expectedSha256: sha(afterApply),
      anchorId: keepView?.anchorId,
      replacementText: preserve,
      reason: 'wrong mission',
    }, { repairId: other.missionId, mission: other })
    results.push(check(
      'wrong_mission_anchor_refused',
      !stolen.ok && /ANCHOR_INVALID_MISSION|ANCHOR_NOT_FOUND/.test(stolen.error ?? ''),
      stolen.error ?? 'applied',
    ))
    results.push(check(
      'anchor_invalid_across_mission',
      !stolen.ok,
      stolen.error ?? 'applied',
    ))

    const lock = boundedRetryLockFromMission(mission)
    const coerced = normalizeBoundedRetryToolName({
      state: 'BOUNDED_RETRY',
      requestedName: 'file.read',
      args: {
        path: CHIP_REL,
        anchorId: lock?.currentAnchorId ?? view?.anchorId,
        replacementText: preserve,
        reason: 'retry',
      },
      currentAnchorId: lock?.currentAnchorId ?? view?.anchorId,
      onlyOneLegalTool: true,
    })
    results.push(check(
      'tool_name_normalization_in_bounded_retry',
      coerced.normalized && coerced.name === BOUNDED_EDIT_TOOL,
      JSON.stringify(coerced),
    ))
    const parsed = parseAndValidateModelDecision(
      JSON.stringify({
        decision: 'TOOL',
        reasoningSummary: 'retry replace',
        tool: {
          name: 'file.read',
          args: {
            path: CHIP_REL,
            anchorId: lock?.currentAnchorId ?? view?.anchorId,
            replacementText: preserve,
            reason: 'retry',
          },
        },
      }),
      mission.permissions,
      new Set([BOUNDED_EDIT_TOOL]),
      { currentState: 'BOUNDED_RETRY', requiredTool: BOUNDED_EDIT_TOOL, currentAnchorId: lock?.currentAnchorId ?? view?.anchorId ?? '' },
    )
    results.push(check(
      'parser_normalizes_only_in_strict_bounded_state',
      parsed.ok === true && parsed.ok && parsed.decision.tool?.name === BOUNDED_EDIT_TOOL && parsed.decision.toolNameNormalized === true,
      JSON.stringify(parsed),
    ))
    const malformed = normalizeBoundedRetryToolName({
      state: 'BOUNDED_RETRY',
      requestedName: 'file.read',
      args: { path: CHIP_REL, query: 'ENGINEERING REVIEW' },
      currentAnchorId: view?.anchorId,
      onlyOneLegalTool: true,
    })
    const outside = normalizeBoundedRetryToolName({
      state: 'EDIT',
      requestedName: 'file.read',
      args: {
        path: CHIP_REL,
        anchorId: view?.anchorId,
        replacementText: preserve,
        reason: 'no',
      },
      currentAnchorId: view?.anchorId,
      onlyOneLegalTool: true,
    })
    results.push(check(
      'arbitrary_malformed_tool_call_not_normalized',
      !malformed.normalized && malformed.name === 'file.read' && !outside.normalized,
      JSON.stringify({ malformed, outside }),
    ))

    const jsxKeep = missingProtectedBindings(
      '<p>{selected.engineeringReview === \'PASS\' ? \'PASS\' : \'PENDING\'}</p>',
      '<p>{selected.engineeringReview === \'PASS\' ? \'PASS\' : \'PENDING\'}</p><p>Checked lint.</p>',
    )
    results.push(check('minimal_additive_replacement_preserves_jsx_binding', jsxKeep.length === 0, jsxKeep.join(',')))
    results.push(check(
      'event_handler_binding_preserved',
      extractProtectedBindings('<button onClick={handleSubmit}>Go</button>').includes('handleSubmit')
        && extractProtectedBindings('<button onClick={handleSubmit}>Go</button>').includes('onClick')
        && missingProtectedBindings('<button onClick={handleSubmit}>Go</button>', '<button>Go</button>').includes('handleSubmit'),
      extractProtectedBindings('<button onClick={handleSubmit}>Go</button>').join(','),
    ))
    results.push(check(
      'prop_member_binding_preserved',
      extractProtectedBindings('<input value={props.value} />').includes('props.value')
        && missingProtectedBindings('<input value={props.value} />', '<input value="" />').includes('props.value'),
      extractProtectedBindings('<input value={props.value} />').join(','),
    ))
    results.push(check(
      'function_call_binding_preserved',
      extractProtectedBindings('{formatDate(mission.createdAt)}').includes('formatDate')
        && extractProtectedBindings('{formatDate(mission.createdAt)}').includes('mission.createdAt'),
      extractProtectedBindings('{formatDate(mission.createdAt)}').join(','),
    ))

    const largeMission = ownedMission(LARGE_REL)
    const largeRead = await compactFileRead({ path: LARGE_REL, aroundMatch: 'LARGE_UNIQUE_ALPHA', focused: true }, largeMission)
    const largeView = largeRead.result as { sha256?: string; anchorId?: string; range?: { startLine: number; endLine: number } } | undefined
    const largeEdit = await executeReplaceUnique({
      path: LARGE_REL,
      anchorId: largeView?.anchorId,
      replacementText: 'LARGE_UNIQUE_BETA',
      reason: 'small edit in large file',
    }, { repairId: largeMission.missionId, mission: largeMission })
    results.push(check(
      'large_file_bounded_edit_still_passes',
      largeEdit.ok === true && readFileSync(path.join(ROOT, LARGE_REL), 'utf8').includes('LARGE_UNIQUE_BETA'),
      largeEdit.error ?? JSON.stringify(largeEdit.result),
    ))

    results.push(check(
      'direct_model_filesystem_mutation_zero',
      !/writeFileSync|writeFile\(|fs\.promises\.writeFile/.test(local),
      'local runtime has no filesystem writes',
    ))

    const terra = await executeReplaceUnique({
      path: 'lib/terra/activeLocation.ts',
      expectedSha256: 'abc',
      matchText: 'export',
      replacementText: 'export',
      reason: 'terra block',
    }, { repairId: mission.missionId, mission })
    results.push(check(
      'terra_blocked',
      !terra.ok && classifyBoundedEditFailure(terra.error) === 'TERRA_LOCKED',
      terra.error ?? '',
    ))

    results.push(check(
      'no_fixture_specific_target_embedded',
      !/FoundryMissionControllerPanel\.tsx/.test(mutationPolicy)
        && listFixtureSpecificCoercionMarkers(controller).filter(item => item !== 'seedFixtureDiagnosis').length === 0
        && genericToolExamplesLeakFixtureAnswers().length === 0,
      'mutation policy files stay general',
    ))
    results.push(check(
      'no_panel_filename_in_policy',
      !/FoundryMissionControllerPanel\.tsx/.test(mutationPolicy)
        && !/FoundryMissionControllerPanel\.tsx/.test(genericToolExamplesLeakFixtureAnswers().join('\n')),
      'no panel path in mutation policy',
    ))
    results.push(check(
      'no_engineering_review_replacement_text_embedded',
      !/Foundry checked the following/.test(mutationPolicy)
        && !/what Foundry checked before/.test(local)
        && !/what Foundry checked before/.test(bounded)
        && !/engineeringReviewDetail\s*=/.test(controller),
      'no desired replacement injected',
    ))
    results.push(check(
      'no_selected_engineeringReview_special_case_in_controller',
      !/selected\.engineeringReview/.test(controller)
        && !/selected\.engineeringReviewDetail/.test(local)
        && !/selected\.engineeringReviewDetail/.test(bounded)
        && requiredReplacementBindings('Make the Engineering Review detail explain what Foundry checked before it says PASS.', '{selected.status}')
          .includes('selected.status')
        && !requiredReplacementBindings('Make the Engineering Review detail explain what Foundry checked before it says PASS.', '{selected.status}')
          .includes('selected.engineeringReview'),
      'bindings derived from source, not the commander request',
    ))

    results.push(check(
      'pass010_contracts_remain',
      FOUNDRY_MODEL_TOOL_CATALOG.some(item => item.name === BOUNDED_EDIT_TOOL)
        && /registerEditAnchor|resolveEditAnchor|anchorId/.test(bounded)
        && /FOCUSED_READ/.test(gates)
        && /SOURCE_READ_LOOP/.test([controller, local, bounded].join('\n')),
      'anchors, focused recovery, and read-loop remain',
    ))

    results.push(check(
      'same_anchor_retained_after_invalid_replacement',
      mission.engineering?.editMatchRecovery?.lastAnchorId === view?.anchorId
        && mission.engineering?.editMatchRecovery?.nextRequiredAction === 'BOUNDED_RETRY',
      JSON.stringify({
        last: mission.engineering?.editMatchRecovery?.lastAnchorId,
        original: view?.anchorId,
        next: mission.engineering?.editMatchRecovery?.nextRequiredAction,
      }),
    ))
    results.push(check(
      'mutation_tool_remains_exposed',
      retryTools.some(item => item.name === BOUNDED_EDIT_TOOL)
        && afterInvalid.availableTools.includes(BOUNDED_EDIT_TOOL)
        && afterInvalid.recommendedToolClass === BOUNDED_EDIT_TOOL,
      JSON.stringify({ tools: retryTools.map(item => item.name), rec: afterInvalid.recommendedToolClass }),
    ))

    const detailRequest = 'Make the Engineering Review detail explain what Foundry checked before it says PASS.'
    const dualMission = ownedMission(DUAL_REL, detailRequest)
    const dualRead = await compactFileRead({ path: DUAL_REL, aroundMatch: "{selected.engineeringReview === 'PASS' ? 'PASS' : selected.engineeringReview === 'FAIL' ? 'FAIL' : 'PENDING'}", focused: true }, dualMission)
    const dualView = dualRead.result as { anchorId?: string; compact?: string; PROTECTED_BINDINGS?: string[] } | undefined
    const dropDetail = await executeReplaceUnique({
      path: DUAL_REL,
      anchorId: dualView?.anchorId,
      replacementText: '<p>{selected.engineeringReview === \'PASS\' ? \'PASS\' : selected.engineeringReview === \'FAIL\' ? \'FAIL\' : \'PENDING\'}</p>',
      reason: 'keep status drop detail',
    }, { repairId: dualMission.missionId, mission: dualMission })
    results.push(check(
      'invalid_replacement_missing_detail_binding',
      !dropDetail.ok
        && classifyBoundedEditFailure(dropDetail.error) === 'INVALID_REPLACEMENT'
        && /selected\.engineeringReviewDetail/.test(dropDetail.error ?? ''),
      dropDetail.error ?? 'applied',
    ))
    const keepBoth = '<p>{selected.engineeringReview === \'PASS\' ? \'PASS\' : selected.engineeringReview === \'FAIL\' ? \'FAIL\' : \'PENDING\'}</p>\n      {selected.engineeringReviewDetail ? <p className="text-[10px] text-slate-400">{selected.engineeringReviewDetail}</p> : null}'
    const dualKeep = ownedMission(DUAL_REL, detailRequest)
    const dualKeepRead = await compactFileRead({ path: DUAL_REL, aroundMatch: "{selected.engineeringReview === 'PASS' ? 'PASS' : selected.engineeringReview === 'FAIL' ? 'FAIL' : 'PENDING'}", focused: true }, dualKeep)
    const dualKeepView = dualKeepRead.result as { anchorId?: string } | undefined
    const appliedDetail = await executeReplaceUnique({
      path: DUAL_REL,
      anchorId: dualKeepView?.anchorId,
      replacementText: keepBoth,
      reason: 'render existing detail field',
    }, { repairId: dualKeep.missionId, mission: dualKeep })
    const dualAfter = readFileSync(path.join(ROOT, DUAL_REL), 'utf8')
    results.push(check(
      'engineeringReviewDetail_rendering',
      appliedDetail.ok === true
        && /selected\.engineeringReview\b/.test(dualAfter)
        && /selected\.engineeringReviewDetail/.test(dualAfter),
      appliedDetail.error ?? dualAfter.slice(dualAfter.indexOf('ENGINEERING REVIEW'), dualAfter.indexOf('ENGINEERING REVIEW') + 400),
    ))

    const blockMission = ownedMission(CHIP_REL)
    beginEditMatchRecovery(blockMission, { code: 'INVALID_REPLACEMENT', path: CHIP_REL, lastAnchorId: 'anc_keep' })
    beginEditMatchRecovery(blockMission, { code: 'INVALID_REPLACEMENT', path: CHIP_REL, lastAnchorId: 'anc_keep' })
    const third = beginEditMatchRecovery(blockMission, { code: 'INVALID_REPLACEMENT', path: CHIP_REL, lastAnchorId: 'anc_keep' })
    const afterThird = evaluateBlockedDecision(blockMission, { reasoningSummary: 'gave up' })
    results.push(check(
      'block_after_three_invalid_replacements',
      third.nextRequiredAction === 'BLOCK'
        && (third.invalidReplacementAttempts ?? 0) >= 3
        && afterThird.allowed === true
        && afterThird.code === 'BLOCKED_ALLOWED',
      JSON.stringify({ next: third.nextRequiredAction, attempts: third.invalidReplacementAttempts, blocked: afterThird }),
    ))

    const localOk = authorizeFoundryBrowserLocalSession({ origin: 'http://127.0.0.1:3848' }, { repairId: mission.missionId })
    const noBroker = authorizeFoundryBrowserLocalSession({ origin: 'http://127.0.0.1:3848' }, {})
    const lanDenied = authorizeFoundryBrowserLocalSession({ origin: 'http://192.168.1.20:3848' }, { repairId: mission.missionId })
    results.push(check(
      'browser_local_session_authorization',
      localOk.ok === true && 'origin' in localOk && localOk.origin === 'http://127.0.0.1:3848',
      JSON.stringify(localOk),
    ))
    results.push(check(
      'browser_local_session_denied_outside_broker',
      noBroker.ok === false && /Tool Broker mission authorization/.test(noBroker.error),
      JSON.stringify(noBroker),
    ))
    results.push(check(
      'browser_local_session_denied_lan',
      lanDenied.ok === false && /loopback-only|LAN/.test(lanDenied.error),
      JSON.stringify(lanDenied),
    ))
    results.push(check(
      'browser_local_session_cookie_not_url_and_path',
      /url:\s*origin/.test(readFileSync(path.join(ROOT, 'lib/native-builder/foundryBrowserService.ts'), 'utf8'))
        && /buildLocalSessionCookie/.test(readFileSync(path.join(ROOT, 'lib/native-builder/foundryBrowserService.ts'), 'utf8'))
        && !/url:\s*origin[\s\S]{0,80}path:\s*'\/'/.test(readFileSync(path.join(ROOT, 'lib/native-builder/foundryBrowserService.ts'), 'utf8'))
        && !/domain:\s*host/.test(readFileSync(path.join(ROOT, 'lib/native-builder/foundryBrowserService.ts'), 'utf8')),
      'Playwright loopback cookies use url only — never url+path and never IP domain',
    ))

    const windows = [
      { id: '0x1', title: 'Cursor — war-room-os', host: 'cursor' },
      { id: '0x2', title: 'Google Chrome', host: 'google-chrome' },
      { id: '0x3', title: 'War Room — Higher Vision Inc', host: 'war-room-os' },
    ]
    const discovered = discoverWarRoomWindow(windows)
    results.push(check(
      'war_room_window_discovery',
      discovered?.title === 'War Room — Higher Vision Inc' && scoreWarRoomWindow(windows[2]!) >= 100,
      JSON.stringify(discovered),
    ))
    results.push(check(
      'no_false_match_to_cursor',
      isCursorOrBrowserWindow(windows[0]!.title, windows[0]!.host)
        && scoreWarRoomWindow(windows[0]!) === 0
        && discoverWarRoomWindow(windows.slice(0, 2)) == null,
      JSON.stringify({ cursorScore: scoreWarRoomWindow(windows[0]!), none: discoverWarRoomWindow(windows.slice(0, 2)) }),
    ))

    invalidateAnchorsForPath(keepMission, CHIP_REL)
  } finally {
    rmSync(path.join(ROOT, CHIP_REL), { force: true })
    rmSync(path.join(ROOT, DUAL_REL), { force: true })
    rmSync(path.join(ROOT, MULTI_REL), { force: true })
    rmSync(path.join(ROOT, LARGE_REL), { force: true })
    rmSync(path.join(ROOT, SAMPLE_REL), { force: true })
  }
  return results
}

async function run() {
  const results = await runFoundryAutonomousEngineeringDepthPass011Validation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry autonomous engineering depth PASS 011: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass011 }
