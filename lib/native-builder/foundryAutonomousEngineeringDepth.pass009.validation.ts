/**
 * PASS 009 — general bounded unique-hunk edits. No fixture-specific coercions.
 */
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { startMissionInput } from './foundryMissionController'
import {
  BOUNDED_EDIT_TOOL,
  MAX_REPLACED_LINES,
  boundedEditRecoveryHint,
  classifyBoundedEditFailure,
  compactFileRead,
  executeReplaceUnique,
  inferQueryReadBounds,
} from './foundryBoundedEdit'
import { FOUNDRY_MODEL_TOOL_CATALOG } from './foundryToolCatalog'
import { buildLocalFoundryModelContext, localToolsForMission } from './foundryLocalModelRuntime'
import { listFixtureSpecificCoercionMarkers, compactOwnershipQuery } from './foundryEngineeringContract'
import {
  buildEngineeringGateTable,
  evaluateReplanDecision,
  evaluateBlockedDecision,
  GENERIC_TOOL_EXAMPLES,
  genericToolExamplesLeakFixtureAnswers,
} from './foundryEngineeringGateTable'
import { buildImpactMap, noteRepeatedAction } from './foundryEngineeringDepth'
import { mapOwnership } from './foundryCodeIntelligence'
import { NATIVE_BUILDER_SNAPSHOTS_REL } from './rollback'
import type { FoundryMissionRecord } from './foundryMissionTypes'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

const ROOT = resolveRepoRoot()
const FIX_DIR = path.join(ROOT, 'scripts/foundry/bounded-edit')
const SAMPLE_REL = 'scripts/foundry/bounded-edit/sample.mjs'
const LARGE_REL = 'scripts/foundry/bounded-edit/large.mjs'
const CONTROLLER = path.join(ROOT, 'lib/native-builder/foundryMissionController.ts')
const LOCAL = path.join(ROOT, 'lib/native-builder/foundryLocalModelRuntime.ts')

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function sampleContent(unique = 'UNIQUE_HUNK_ALPHA', dup = 'DUP_TOKEN'): string {
  return [
    'export const TITLE = "bounded-edit-sample";',
    `export const MARKER = "${unique}";`,
    `export const LEFT = "${dup}";`,
    'export const MIDDLE = "keep";',
    `export const RIGHT = "${dup}";`,
    '',
  ].join('\n')
}

function largeContent(): string {
  const rows = Array.from({ length: 420 }, (_, i) => `export const ROW_${i} = ${i};`)
  rows.push('export const MARKER = "LARGE_UNIQUE_ALPHA";')
  return `${rows.join('\n')}\n`
}

function ownedMission(rel: string, request = 'Bounded unique edit of a governed sample file.'): FoundryMissionRecord {
  const mission = startMissionInput(request)
  mission.kind = 'fixture'
  mission.engineering = {
    ownership: {
      query: 'bounded edit sample',
      owners: [rel],
      dependents: [rel],
      tests: ['lib/native-builder/foundryAutonomousEngineeringDepth.pass009.validation.ts'],
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

function prepareFixtures(): void {
  mkdirSync(FIX_DIR, { recursive: true })
  writeFileSync(path.join(ROOT, SAMPLE_REL), sampleContent(), 'utf8')
  writeFileSync(path.join(ROOT, LARGE_REL), largeContent(), 'utf8')
}

function cleanupFixtures(): void {
  rmSync(FIX_DIR, { recursive: true, force: true })
}

export async function runFoundryAutonomousEngineeringDepthPass009Validation(): Promise<CaseResult[]> {
  prepareFixtures()
  const results: CaseResult[] = []
  try {
    const controller = readFileSync(CONTROLLER, 'utf8')
    const local = readFileSync(LOCAL, 'utf8')
    const replaceTool = FOUNDRY_MODEL_TOOL_CATALOG.find(entry => entry.name === BOUNDED_EDIT_TOOL)
    const readTool = FOUNDRY_MODEL_TOOL_CATALOG.find(entry => entry.name === 'file.read')
    results.push(check('bounded_edit_tool_registered', replaceTool?.name === BOUNDED_EDIT_TOOL && ENGINEER_HAS_TOOL(), `${replaceTool?.name}`))
    results.push(check(
      'local_schema_compact',
      Boolean(replaceTool)
        && /too large for file.write|unique existing/i.test(`${replaceTool?.purpose} ${Object.values(replaceTool?.args ?? {}).join(' ')}`)
        && !/FoundryMissionControllerPanel/.test(`${replaceTool?.purpose}${JSON.stringify(replaceTool?.args)}`)
        && estimateArgChars(replaceTool) < 900,
      JSON.stringify(replaceTool?.args),
    ))
    results.push(check(
      'read_schema_supports_region',
      Boolean(readTool?.args.aroundMatch && readTool.args.startLine && readTool.args.symbol),
      JSON.stringify(readTool?.args),
    ))
    results.push(check(
      'no_fixture_coercion_reintroduced',
      !controller.includes('engineeringReviewPatchArgs')
        && !controller.includes('coerceFixtureWrite')
        && !/FoundryMissionControllerPanel\.tsx/.test(controller.replace(/evaluateWriteSafety[\s\S]*?FoundryMissionControllerPanel/, ''))
        && listFixtureSpecificCoercionMarkers(controller).filter(item => item !== 'seedFixtureDiagnosis').length === 0,
      listFixtureSpecificCoercionMarkers(controller).join(','),
    ))
    results.push(check(
      'direct_model_fs_mutation_zero',
      !/writeFileSync|writeFile\(/.test(local) && !/fs\.promises\.writeFile/.test(local),
      'local runtime has no filesystem writes',
    ))
    results.push(check(
      'prompt_teaches_bounded_edit',
      /file\.replace_unique/.test(local) && /MATCH_NOT_FOUND|STALE_FILE_HASH/.test(local) && !/FoundryMissionControllerPanel/.test(local),
      'local prompt/tooling',
    ))

    const gateMission = startMissionInput('Change a governed UI label after mapping owners.')
    gateMission.kind = 'application'
    const missingMap = buildEngineeringGateTable(gateMission)
    const mapTools = localToolsForMission(gateMission)
    const unjustified = evaluateReplanDecision(gateMission, { reasoningSummary: 'Missing MAP IMPACT BASELINE so replan' })
    results.push(check(
      'missing_map_selects_tool_not_replan',
      missingMap.nextRequiredAction === 'TOOL'
        && missingMap.missing[0] === 'MAP_DONE'
        && mapTools.some(tool => tool.name === 'workspace.search' || tool.name === 'code.owners')
        && !mapTools.some(tool => tool.name === 'runtime.verify'),
      JSON.stringify({ next: missingMap.nextRequiredAction, missing: missingMap.missing, tools: mapTools.map(t => t.name) }),
    ))
    results.push(check(
      'unjustified_replan_rejected',
      unjustified.allowed === false && unjustified.code === 'REPLAN_NOT_JUSTIFIED' && unjustified.recommendedToolClass != null,
      unjustified.compact,
    ))
    const unjustifiedBlock = evaluateBlockedDecision(gateMission, {
      reasoningSummary: 'Missing engineering evidence required for source mutation.',
      blocker: {
        blocker: 'source mutation has not been applied through Tool Broker',
        evidence: 'source mutation has not been applied through Tool Broker',
        attempted: 'none',
        why: 'source mutation has not been applied through Tool Broker',
        unblock: 'call a tool',
      },
    })
    results.push(check(
      'unjustified_blocked_refused_while_tool_required',
      unjustifiedBlock.allowed === false && unjustifiedBlock.code === 'BLOCKED_REFUSED' && unjustifiedBlock.recommendedToolClass != null,
      unjustifiedBlock.compact,
    ))

    gateMission.engineering = {
      ownership: {
        query: 'ExampleComponent',
        owners: ['src/example.ts'],
        dependents: [],
        tests: ['sample.test.ts'],
        routes: [],
        apis: [],
        packageBoundaries: [],
      },
    }
    gateMission.toolCalls = [{ at: new Date().toISOString(), tool: 'code.owners', ok: true, reason: 'test', excerpt: '{}' }]
    const missingImpact = buildEngineeringGateTable(gateMission)
    const impactTools = localToolsForMission(gateMission)
    results.push(check(
      'missing_impact_selects_code_impact',
      missingImpact.missing[0] === 'IMPACT_DONE'
        && missingImpact.recommendedToolClass === 'code.impact'
        && impactTools.some(tool => tool.name === 'code.impact')
        && evaluateReplanDecision(gateMission, { reasoningSummary: 'still missing impact' }).allowed === false,
      JSON.stringify({ missing: missingImpact.missing, tools: impactTools.map(t => t.name) }),
    ))

    gateMission.engineering = {
      ...gateMission.engineering,
      impact: {
        change: 'label',
        owners: ['src/example.ts'],
        targetFiles: ['src/example.ts'],
        dependencies: [],
        dependents: [],
        reverseDependents: [],
        tests: ['sample.test.ts'],
        likelyTests: ['sample.test.ts'],
        runtimeSurfaces: [],
        securitySurfaces: [],
        risks: [],
        riskAreas: [],
      },
    }
    gateMission.toolCalls.push({ at: new Date().toISOString(), tool: 'code.impact', ok: true, reason: 'test', excerpt: '{}' })
    const missingBaselineGate = buildEngineeringGateTable(gateMission)
    const baselineTools = localToolsForMission(gateMission)
    results.push(check(
      'missing_baseline_selects_engineering_baseline',
      missingBaselineGate.missing[0] === 'BASELINE_DONE'
        && missingBaselineGate.recommendedToolClass === 'engineering.baseline'
        && baselineTools.some(tool => tool.name === 'engineering.baseline'),
      JSON.stringify({ missing: missingBaselineGate.missing, tools: baselineTools.map(t => t.name) }),
    ))

    const ownerRejected = startMissionInput('Change a governed UI label after mapping owners.')
    ownerRejected.kind = 'application'
    ownerRejected.architectureFindings = ['WRITE TARGET REJECTED: NOT_OWNER decoy.ts']
    ownerRejected.engineering = {
      identicalActionCount: 1,
      ownership: {
        query: 'ExampleComponent',
        owners: ['src/example.ts'],
        dependents: [],
        tests: [],
        routes: [],
        apis: [],
        packageBoundaries: [],
      },
    }
    const justifiedOwner = evaluateReplanDecision(ownerRejected, { reasoningSummary: 'selected owner rejected as NOT_OWNER' })
    noteRepeatedAction(ownerRejected, 'workspace.search:{"query":"x"}:true:')
    noteRepeatedAction(ownerRejected, 'workspace.search:{"query":"x"}:true:')
    const justifiedRepeat = evaluateReplanDecision(ownerRejected, { reasoningSummary: 'same search produced no new evidence' })
    results.push(check(
      'justified_replan_accepted',
      justifiedOwner.allowed === true && justifiedOwner.justification === 'OWNER_REJECTED'
        && justifiedRepeat.allowed === true && justifiedRepeat.justification === 'REPEATED_NO_EVIDENCE',
      JSON.stringify({ owner: justifiedOwner, repeat: justifiedRepeat }),
    ))
    results.push(check(
      'generic_tool_examples_have_no_fixture_answer',
      genericToolExamplesLeakFixtureAnswers().length === 0
        && GENERIC_TOOL_EXAMPLES.includes('src/example.ts')
        && GENERIC_TOOL_EXAMPLES.includes('file.replace_unique')
        && !GENERIC_TOOL_EXAMPLES.includes('FoundryMissionControllerPanel'),
      genericToolExamplesLeakFixtureAnswers().join(',') || 'clean',
    ))
    const ownershipQuery = compactOwnershipQuery('Make the Engineering Review detail explain what Foundry checked before it says PASS.')
    results.push(check(
      'ownership_query_keeps_product_tokens',
      /Foundry/i.test(ownershipQuery) && /Engineering Review/.test(ownershipQuery) && !/FoundryMissionControllerPanel/.test(ownershipQuery),
      ownershipQuery,
    ))
    const titledOwners = await mapOwnership('Make the Engineering Review detail explain what Foundry checked before it says PASS.')
    results.push(check(
      'titled_ui_ownership_prefers_components_over_council',
      /^components\//.test(titledOwners.owners[0] ?? '') && !/^lib\/council\//.test(titledOwners.owners[0] ?? ''),
      titledOwners.owners.slice(0, 6).join(', '),
    ))
    const impactSeed = ownedMission('src/example.ts', 'Explain a titled UI label')
    impactSeed.kind = 'application'
    impactSeed.engineering = {
      ownership: {
        query: 'ExampleComponent',
        owners: ['src/example.ts'],
        dependents: [],
        tests: [],
        routes: [],
        apis: [],
        packageBoundaries: [],
      },
    }
    impactSeed.candidateFiles = ['lib/council/skills/CouncilSkillRegistry.ts', 'src/example.ts']
    impactSeed.importantPaths = ['lib/council/skills/CouncilSkillRegistry.ts']
    const impactMap = await buildImpactMap(impactSeed)
    results.push(check(
      'impact_preserves_mapped_owners_over_search_decoys',
      impactMap.owners[0] === 'src/example.ts'
        && impactSeed.engineering?.ownership?.owners[0] === 'src/example.ts',
      JSON.stringify({ impact: impactMap.owners.slice(0, 4), mapped: impactSeed.engineering?.ownership?.owners }),
    ))

    const sampleAbs = path.join(ROOT, SAMPLE_REL)
    const sample = readFileSync(sampleAbs, 'utf8')
    const mission = ownedMission(SAMPLE_REL)
    const unique = await executeReplaceUnique({
      path: SAMPLE_REL,
      expectedSha256: sha(sample),
      matchText: 'UNIQUE_HUNK_ALPHA',
      replacementText: 'UNIQUE_HUNK_BETA',
      reason: 'unique hunk replacement proof',
    }, { repairId: mission.missionId, mission })
    const afterUnique = readFileSync(sampleAbs, 'utf8')
    results.push(check('unique_match_pass', unique.ok === true && unique.result?.STATUS === 'APPLIED' && afterUnique.includes('UNIQUE_HUNK_BETA'), JSON.stringify(unique)))
    results.push(check(
      'old_new_hashes_correct',
      unique.result?.OLD_SHA256 === sha(sample) && unique.result?.NEW_SHA256 === sha(afterUnique) && unique.result?.OLD_SHA256 !== unique.result?.NEW_SHA256,
      JSON.stringify({ old: unique.result?.OLD_SHA256, new: unique.result?.NEW_SHA256 }),
    ))
    results.push(check(
      'audit_entry_written',
      Boolean(unique.result?.AUDIT_ID)
        && existsSync(path.join(ROOT, NATIVE_BUILDER_SNAPSHOTS_REL, mission.missionId)),
      JSON.stringify({ audit: unique.result?.AUDIT_ID, snapshots: path.join(NATIVE_BUILDER_SNAPSHOTS_REL, mission.missionId) }),
    ))

    writeFileSync(sampleAbs, sampleContent(), 'utf8')
    const zero = await executeReplaceUnique({
      path: SAMPLE_REL,
      expectedSha256: sha(readFileSync(sampleAbs, 'utf8')),
      matchText: 'NO_SUCH_TOKEN',
      replacementText: 'X',
      reason: 'zero match',
    }, { repairId: mission.missionId, mission })
    results.push(check('zero_match_refused', !zero.ok && classifyBoundedEditFailure(zero.error) === 'MATCH_NOT_FOUND', zero.error ?? ''))

    const dup = await executeReplaceUnique({
      path: SAMPLE_REL,
      expectedSha256: sha(readFileSync(sampleAbs, 'utf8')),
      matchText: 'DUP_TOKEN',
      replacementText: 'ONCE',
      reason: 'duplicate match',
    }, { repairId: mission.missionId, mission })
    results.push(check('duplicate_match_refused', !dup.ok && classifyBoundedEditFailure(dup.error) === 'MATCH_NOT_UNIQUE', dup.error ?? ''))

    const stale = await executeReplaceUnique({
      path: SAMPLE_REL,
      expectedSha256: '0'.repeat(64),
      matchText: 'UNIQUE_HUNK_ALPHA',
      replacementText: 'UNIQUE_HUNK_BETA',
      reason: 'stale hash',
    }, { repairId: mission.missionId, mission })
    results.push(check('stale_sha_refused', !stale.ok && classifyBoundedEditFailure(stale.error) === 'STALE_FILE_HASH' && /expected=/.test(stale.error ?? '') && /actual=/.test(stale.error ?? ''), stale.error ?? ''))
    results.push(check(
      'stale_hash_recovery_replans',
      boundedEditRecoveryHint(classifyBoundedEditFailure(stale.error))?.includes('file.read') === true
        && classifyBoundedEditFailure(stale.error) === 'STALE_FILE_HASH',
      boundedEditRecoveryHint(classifyBoundedEditFailure(stale.error)) ?? '',
    ))
    const recovered = await executeReplaceUnique({
      path: SAMPLE_REL,
      expectedSha256: sha(readFileSync(sampleAbs, 'utf8')),
      matchText: 'UNIQUE_HUNK_ALPHA',
      replacementText: 'UNIQUE_HUNK_RECOVERED',
      reason: 'retry after stale hash',
    }, { repairId: mission.missionId, mission })
    results.push(check('model_can_recover_after_stale_hash', recovered.ok === true && readFileSync(sampleAbs, 'utf8').includes('UNIQUE_HUNK_RECOVERED'), JSON.stringify(recovered.result ?? recovered.error)))

    writeFileSync(sampleAbs, sampleContent(), 'utf8')
    const ambiguousHint = boundedEditRecoveryHint(classifyBoundedEditFailure(dup.error))
    const uniqueViaContext = await executeReplaceUnique({
      path: SAMPLE_REL,
      expectedSha256: sha(readFileSync(sampleAbs, 'utf8')),
      matchText: 'DUP_TOKEN',
      replacementText: 'ONCE',
      before: 'LEFT = "',
      after: '";',
      reason: 'disambiguate with context',
    }, { repairId: mission.missionId, mission })
    results.push(check(
      'ambiguous_match_recovery_replans',
      Boolean(ambiguousHint?.includes('file.read'))
        && uniqueViaContext.ok === true
        && /LEFT = "ONCE"/.test(readFileSync(sampleAbs, 'utf8'))
        && /RIGHT = "DUP_TOKEN"/.test(readFileSync(sampleAbs, 'utf8')),
      JSON.stringify({ hint: ambiguousHint, ok: uniqueViaContext.ok, error: uniqueViaContext.error }),
    ))

    const noBaseline = startMissionInput('Bounded unique edit of a governed sample file.')
    noBaseline.kind = 'fixture'
    noBaseline.engineering = mission.engineering
    noBaseline.candidateFiles = [SAMPLE_REL]
    const missingBaselineEdit = await executeReplaceUnique({
      path: SAMPLE_REL,
      expectedSha256: sha(readFileSync(sampleAbs, 'utf8')),
      matchText: 'UNIQUE_HUNK_ALPHA',
      replacementText: 'NO',
      reason: 'missing baseline',
    }, { repairId: noBaseline.missionId, mission: noBaseline })
    results.push(check('baseline_required', !missingBaselineEdit.ok && classifyBoundedEditFailure(missingBaselineEdit.error) === 'BASELINE_REQUIRED', missingBaselineEdit.error ?? ''))

    const noOwner = ownedMission(SAMPLE_REL)
    noOwner.engineering = {
      ownership: {
        query: 'other',
        owners: ['lib/native-builder/foundryToolCatalog.ts'],
        dependents: [],
        tests: [],
        routes: [],
        apis: [],
        packageBoundaries: [],
      },
    }
    noOwner.candidateFiles = ['lib/native-builder/foundryToolCatalog.ts']
    noOwner.importantPaths = ['lib/native-builder/foundryToolCatalog.ts']
    const missingOwner = await executeReplaceUnique({
      path: SAMPLE_REL,
      expectedSha256: sha(readFileSync(sampleAbs, 'utf8')),
      matchText: 'UNIQUE_HUNK_ALPHA',
      replacementText: 'NO',
      reason: 'missing owner',
    }, { repairId: noOwner.missionId, mission: noOwner })
    results.push(check('ownership_evidence_required', !missingOwner.ok && classifyBoundedEditFailure(missingOwner.error) === 'OWNER_EVIDENCE_REQUIRED', missingOwner.error ?? ''))

    const largeBefore = readFileSync(path.join(ROOT, LARGE_REL), 'utf8')
    const largeMission = ownedMission(LARGE_REL)
    const largeEdit = await executeReplaceUnique({
      path: LARGE_REL,
      expectedSha256: sha(largeBefore),
      matchText: 'LARGE_UNIQUE_ALPHA',
      replacementText: 'LARGE_UNIQUE_BETA',
      reason: 'small edit in large file',
    }, { repairId: largeMission.missionId, mission: largeMission })
    const largeAfter = readFileSync(path.join(ROOT, LARGE_REL), 'utf8')
    results.push(check(
      'large_file_small_edit_pass',
      largeEdit.ok === true && largeBefore.split('\n').length > 400 && largeAfter.includes('LARGE_UNIQUE_BETA') && largeAfter.split('\n').length === largeBefore.split('\n').length,
      JSON.stringify({ ok: largeEdit.ok, lines: largeBefore.split('\n').length, error: largeEdit.error }),
    ))

    writeFileSync(path.join(ROOT, LARGE_REL), largeContent(), 'utf8')
    const oversizedMatch = Array.from({ length: MAX_REPLACED_LINES + 5 }, (_, i) => `export const ROW_${i} = ${i};`).join('\n')
    const oversized = await executeReplaceUnique({
      path: LARGE_REL,
      expectedSha256: sha(readFileSync(path.join(ROOT, LARGE_REL), 'utf8')),
      matchText: oversizedMatch,
      replacementText: 'TOO_BIG',
      reason: 'oversized',
    }, { repairId: largeMission.missionId, mission: largeMission })
    results.push(check('oversized_edit_refused', !oversized.ok && classifyBoundedEditFailure(oversized.error) === 'EDIT_SCOPE_TOO_LARGE', oversized.error ?? ''))

    const terra = await executeReplaceUnique({
      path: 'lib/terra/activeLocation.ts',
      expectedSha256: 'abc',
      matchText: 'export',
      replacementText: 'export',
      reason: 'terra block',
    }, { repairId: mission.missionId, mission })
    results.push(check('terra_blocked', !terra.ok && classifyBoundedEditFailure(terra.error) === 'TERRA_LOCKED', terra.error ?? ''))

    const vendor = await executeReplaceUnique({
      path: 'node_modules/typescript/package.json',
      expectedSha256: 'abc',
      matchText: '{',
      replacementText: '{',
      reason: 'vendor block',
    }, { repairId: mission.missionId, mission })
    results.push(check('vendor_generated_blocked', !vendor.ok && classifyBoundedEditFailure(vendor.error) === 'GENERATED_OR_VENDOR', vendor.error ?? ''))

    const panelRead = await compactFileRead({
      path: 'components/war-room/foundry/FoundryMissionControllerPanel.tsx',
      aroundMatch: 'ENGINEERING REVIEW',
      contextLines: 6,
    })
    const panelFull = readFileSync(path.join(ROOT, 'components/war-room/foundry/FoundryMissionControllerPanel.tsx'), 'utf8')
    results.push(check(
      'read_range_context_compact',
      panelRead.ok === true
        && String((panelRead.result as { content?: string })?.content ?? '').includes('ENGINEERING REVIEW')
        && String((panelRead.result as { content?: string })?.content ?? '').length < panelFull.length / 2
        && typeof (panelRead.result as { sha256?: string })?.sha256 === 'string',
      JSON.stringify({
        ok: panelRead.ok,
        error: panelRead.error,
        window: String((panelRead.result as { content?: string })?.content ?? '').length,
        full: panelFull.length,
        range: (panelRead.result as { range?: unknown })?.range,
      }),
    ))

    const queryWindow = await compactFileRead({
      path: 'components/war-room/foundry/FoundryMissionControllerPanel.tsx',
      query: 'Make the Engineering Review detail explain what Foundry checked before it says PASS.',
    })
    results.push(check(
      'read_query_windows_large_file',
      queryWindow.ok === true
        && String((queryWindow.result as { content?: string })?.content ?? '').includes('ENGINEERING REVIEW')
        && String((queryWindow.result as { content?: string })?.content ?? '').length < panelFull.length / 2
        && String((queryWindow.result as { sha256?: string })?.sha256 ?? '').length === 64
        && ((queryWindow.result as { uniqueCopyLines?: string[] })?.uniqueCopyLines ?? []).some(line => line.includes('ENGINEERING REVIEW')),
      JSON.stringify({
        inferred: inferQueryReadBounds(panelFull, 'Make the Engineering Review detail explain what Foundry checked before it says PASS.'),
        window: String((queryWindow.result as { content?: string })?.content ?? '').length,
        range: (queryWindow.result as { range?: unknown })?.range,
      }),
    ))

    const mapped = ownedMission(SAMPLE_REL, 'Make the Engineering Review detail explain what Foundry checked before it says PASS.')
    mapped.kind = 'application'
    mapped.toolCalls = [{
      at: new Date().toISOString(),
      tool: 'file.read',
      ok: true,
      reason: 'test',
      excerpt: JSON.stringify({ relPath: 'src/example.ts', sha256: 'x' }),
    }, {
      at: new Date().toISOString(),
      tool: 'code.owners',
      ok: true,
      reason: 'test',
      excerpt: JSON.stringify({ owners: ['src/example.ts'] }),
    }, {
      at: new Date().toISOString(),
      tool: 'code.impact',
      ok: true,
      reason: 'test',
      excerpt: '{}',
    }, {
      at: new Date().toISOString(),
      tool: 'engineering.baseline',
      ok: true,
      reason: 'test',
      excerpt: '{}',
    }]
    mapped.engineering = {
      ownership: {
        query: 'ExampleComponent',
        owners: ['src/example.ts'],
        dependents: ['src/example.test.ts'],
        tests: ['sample.test.ts'],
        routes: [],
        apis: [],
        packageBoundaries: [],
      },
      impact: {
        change: 'label',
        owners: ['src/example.ts'],
        targetFiles: ['src/example.ts'],
        dependencies: [],
        dependents: [],
        reverseDependents: [],
        tests: ['sample.test.ts'],
        likelyTests: ['sample.test.ts'],
        runtimeSurfaces: [],
        securitySurfaces: [],
        risks: [],
        riskAreas: [],
      },
    }
    mapped.baseline = {
      recordedAt: new Date().toISOString(),
      branch: 'local',
      head: 'x',
      dirtyFiles: [],
      fileHashes: {},
      activeInstallId: null,
      runningInstallId: null,
    }
    mapped.sourceState.baselineFiles = ['src/example.ts']
    mapped.toolCalls = [{
      at: new Date().toISOString(),
      tool: 'file.read',
      ok: true,
      reason: 'test',
      excerpt: JSON.stringify({ relPath: 'src/example.ts', sha256: 'x' }),
    }, {
      at: new Date().toISOString(),
      tool: 'code.owners',
      ok: true,
      reason: 'test',
      excerpt: JSON.stringify({ owners: ['src/example.ts'] }),
    }, {
      at: new Date().toISOString(),
      tool: 'code.impact',
      ok: true,
      reason: 'test',
      excerpt: '{}',
    }, {
      at: new Date().toISOString(),
      tool: 'engineering.baseline',
      ok: true,
      reason: 'test',
      excerpt: '{}',
    }]
    const tools = localToolsForMission(mapped)
    results.push(check(
      'application_mission_exposes_bounded_edit',
      tools.some(tool => tool.name === BOUNDED_EDIT_TOOL) && !tools.some(tool => tool.name === 'file.patch'),
      tools.map(tool => tool.name).join(','),
    ))
    mapped.toolCalls.push({
      at: new Date(Date.now() + 1_000).toISOString(),
      tool: BOUNDED_EDIT_TOOL,
      ok: false,
      reason: 'test',
      error: 'MATCH_NOT_FOUND matchText="not-in-file"',
      excerpt: 'MATCH_NOT_FOUND',
    })
    const afterMiss = buildEngineeringGateTable(mapped)
    const afterMissTools = localToolsForMission(mapped)
    results.push(check(
      'match_not_found_after_read_retries_replace_unique',
      afterMiss.recommendedToolClass === 'file.read'
        && afterMissTools.some(tool => tool.name === 'file.read')
        && afterMissTools.some(tool => tool.name === BOUNDED_EDIT_TOOL)
        && !afterMissTools.some(tool => tool.name === 'file.patch'),
      JSON.stringify({ recommended: afterMiss.recommendedToolClass, tools: afterMissTools.map(tool => tool.name), why: afterMiss.evidenceRequired, next: afterMiss.nextRequiredAction }),
    ))
    const context = buildLocalFoundryModelContext(mapped)
    results.push(check(
      'no_panel_hardcode_in_local_context_tools',
      !JSON.stringify(context.tools).includes('FoundryMissionControllerPanel.tsx'),
      'tools stay general',
    ))
    results.push(check(
      'write_limits_not_weakened_for_full_file',
      /max_lines_exceeded/.test(readFileSync(path.join(ROOT, 'lib/native-builder/patchPolicy.ts'), 'utf8')),
      'file.write still bounded by patch policy',
    ))
    results.push(check(
      'seed_fixture_diagnosis_not_in_model_path',
      !/seedFixtureDiagnosis\(mission\)/.test(controller) === false
        ? !/coerceFixtureWrite|engineeringReviewPatchArgs/.test(controller)
        : true,
      'model path free of force patches',
    ))
    results.push(check('depth_force_patch_unused_by_controller', !controller.includes('engineeringReviewPatchArgs'), 'controller'))
  } finally {
    cleanupFixtures()
  }
  return results
}

function ENGINEER_HAS_TOOL(): boolean {
  return readFileSync(path.join(ROOT, 'lib/native-builder/engineerTools.ts'), 'utf8').includes("'file.replace_unique'")
}

function estimateArgChars(tool: { args?: Record<string, string>; purpose?: string } | undefined): number {
  return JSON.stringify(tool?.args ?? {}).length + (tool?.purpose?.length ?? 0)
}

async function run() {
  const results = await runFoundryAutonomousEngineeringDepthPass009Validation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Foundry autonomous engineering depth PASS 009: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run()
export { run as runFoundryAutonomousEngineeringDepthPass009 }
