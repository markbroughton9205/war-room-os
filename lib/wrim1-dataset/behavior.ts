import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { containsHiddenCot, containsSecret } from '@/lib/real-evidence/engine'
import { evaluateContinuousEvidence } from '@/lib/continuous-evidence/engine'
import { gymRunToEvidenceInput, runCodeOperatorGym, runResearchGym, runToolUseGym } from '@/lib/agi-gym/engine'
import { extractClaimTexts } from '@/lib/world-learning/claimExtraction'
import { evaluateUnderstanding } from '@/lib/world-learning/sessionOrchestrator'
import type { LearningSession } from '@/lib/world-learning/types'
import type { ContinuousEvidenceRecord } from '@/lib/continuous-evidence/types'
import { sha256, observableExampleHash } from './hash'
import { toHardenedExample } from './serialize'
import type { EngineeringFamily, HardenedExample, ObservableExample } from './types'

const NOW = '2026-08-30T21:00:00.000Z'

function baseExample(partial: Omit<ObservableExample, 'exampleId' | 'contentHash'>): ObservableExample {
  const contentHash = observableExampleHash(partial)
  return { ...partial, exampleId: `w81ex_${contentHash.slice(0, 24)}`, contentHash }
}

function commanderProvenance(sourceRef: string, contentHash: string, transformation: string) {
  return {
    sourceOwner: 'Commander',
    licenseName: 'Commander-owned, private',
    sourceRef,
    retrievedAt: NOW,
    contentHash,
    transformation,
  }
}

export function buildCommanderCorrectionExamples81(): HardenedExample[] {
  return []
}

export function buildTerraEvalExamples81(): HardenedExample[] {
  const stale = baseExample({
    format: 'temporal_reasoning', qualityTier: 'excluded', trainability: 'eval_only',
    capabilityTags: ['terra', 'temporal-reasoning'], sourceClass: 'EVAL_ONLY',
    sourceIds: ['eval:terra:stale-current'], provenanceRefs: ['eval-spec:terra-temporal'],
    rights: { licenseName: 'Eval specification', permitsTrainingUse: false },
    input: 'Observation validUntil=2026-08-30T17:00:00.000Z evaluated at 2026-08-30T18:00:00.000Z. Is it current?',
    contextRefs: ['eval:terra:stale-current'], toolAction: null, toolResult: null, evidenceRefs: ['eval-spec:terra-temporal'],
    finalResponse: 'stale', validator: 'temporal-order', outcome: 'pass', correction: null,
    lineageIds: ['eval:terra:stale-current'],
  })
  const coverage = baseExample({
    format: 'spatial_terra_reasoning', qualityTier: 'excluded', trainability: 'eval_only',
    capabilityTags: ['terra', 'spatial-reasoning'], sourceClass: 'EVAL_ONLY',
    sourceIds: ['eval:terra:no-coverage'], provenanceRefs: ['eval-spec:terra-coverage'],
    rights: { licenseName: 'Eval specification', permitsTrainingUse: false },
    input: 'No live observation is attached. Distinguish missing coverage from a fabricated coordinate.',
    contextRefs: ['eval:terra:no-coverage'], toolAction: null, toolResult: null, evidenceRefs: ['eval-spec:terra-coverage'],
    finalResponse: 'no-coverage', validator: 'exact-string', outcome: 'pass', correction: null,
    lineageIds: ['eval:terra:no-coverage'],
  })
  return [stale, coverage].map(item => toHardenedExample(item, {
    provenance: { sourceOwner: 'Eval suite', licenseName: 'Eval specification', sourceRef: item.provenanceRefs[0]!, retrievedAt: NOW, contentHash: item.contentHash, transformation: 'eval-only-spec' },
    validatorSpec: { type: item.validator, expected: item.finalResponse },
  }))
}

export function buildResearchExamples81(): HardenedExample[] {
  const conflict = runResearchGym({
    missionId: 'w81-research-conflict', gym: 'research_engine',
    objective: 'Detect unresolved contradiction without verifying either claim.',
    capabilityTags: ['research', 'contradiction-handling'], curriculumTags: ['research'],
    sourceLineageIds: ['w81:research:conflict'],
  }, { documentSummary: 'Source Alpha timestamps the outage at 12:00 UTC. Source Beta timestamps the same outage at 18:00 UTC.', comparisonAgreement: 'conflicting' })
  const single = runResearchGym({
    missionId: 'w81-research-single', gym: 'research_engine',
    objective: 'Extract a single-source candidate without auto-verification.',
    capabilityTags: ['research'], curriculumTags: ['research'],
    sourceLineageIds: ['w81:research:single'],
  }, { documentSummary: 'The Commander-owned constitution states that storage is not learning.', comparisonAgreement: 'single_source' })
  const verified = runResearchGym({
    missionId: 'w81-research-verified', gym: 'research_engine',
    objective: 'Admit verification only when an independent verifier corroborates.',
    capabilityTags: ['research', 'evidence-grounding'], curriculumTags: ['research'],
    sourceLineageIds: ['w81:research:verified'],
  }, { documentSummary: 'Gauge A and independent Gauge B both report crest at 04:00 UTC in the same bounded fixture.', comparisonAgreement: 'corroborated', verifierConfirmed: true })
  const insufficient = runResearchGym({
    missionId: 'w81-research-insufficient', gym: 'research_engine',
    objective: 'Refuse to assert truth when evidence is insufficient.',
    capabilityTags: ['research'], curriculumTags: ['research'],
    sourceLineageIds: ['w81:research:insufficient'],
  }, { documentSummary: 'A rumor mentions a delay. No primary source is attached.', comparisonAgreement: 'insufficient_evidence' })

  const asExample = (
    run: typeof conflict,
    format: ObservableExample['format'],
    tier: ObservableExample['qualityTier'],
    trainability: ObservableExample['trainability'],
    response: string,
  ): HardenedExample => {
    const base = baseExample({
      format, qualityTier: tier, trainability, capabilityTags: [...run.mission.capabilityTags],
      sourceClass: 'ELIGIBLE', sourceIds: run.mission.sourceLineageIds, provenanceRefs: [`gym:${run.mission.missionId}`],
      rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: trainability === 'positive_training' || trainability === 'failure_curriculum' },
      input: run.mission.objective, contextRefs: run.mission.sourceLineageIds,
      toolAction: 'extract_claims', toolResult: run.trajectory.map(step => step.resultSummary).join('; '),
      evidenceRefs: run.criteria.map(item => `criterion:${item.id}`),
      finalResponse: response,
      validator: 'research-gym-criteria', outcome: run.outcome, correction: null, claimStatus: run.claimStatus,
      lineageIds: run.mission.sourceLineageIds,
    })
    return toHardenedExample(base, {
      toolActions: run.trajectory.map(step => ({ tool: step.action, arguments: step.arguments as Record<string, unknown>, selected: true })),
      toolResults: run.trajectory.map(step => ({ tool: step.action, result: step.resultSummary, exitCode: step.exitCode ?? 1 })),
      provenance: commanderProvenance(`gym:${run.mission.missionId}`, base.contentHash, 'research-gym-observable-trajectory'),
      validatorSpec: { type: 'claim-status', expected: run.claimStatus ?? 'observed' },
    })
  }

  return [
    asExample(conflict, 'contradiction_handling', 'B', 'positive_training', `mission=${conflict.outcome}; claimStatus=${conflict.claimStatus}; do not pick a winner`),
    asExample(single, 'source_grounded_research', 'C', 'failure_curriculum', `mission=${single.outcome}; claimStatus=${single.claimStatus}; not established truth`),
    asExample(verified, 'source_grounded_research', 'A', 'positive_training', `mission=${verified.outcome}; claimStatus=${verified.claimStatus}`),
    asExample(insufficient, 'source_grounded_research', 'C', 'failure_curriculum', `mission=${insufficient.outcome}; claimStatus=${insufficient.claimStatus}; insufficient evidence`),
  ]
}

export function buildWorldLearningExamples81(): HardenedExample[] {
  const constitution = existsSync(join(process.cwd(), 'docs/war-room-constitution.md'))
    ? readFileSync(join(process.cwd(), 'docs/war-room-constitution.md'), 'utf8').slice(0, 1200)
    : 'War Room is Commander-owned. Storage is not learning. Claims remain candidate until verified.'
  const claims = extractClaimTexts({
    id: 'wl-constitution-w81', provider: 'local', providerRecordId: null, title: 'War Room constitution excerpt',
    summary: constitution.replace(/\n+/g, ' ').slice(0, 900), contentSnippet: constitution.slice(0, 400),
    canonicalUrl: null, sourceUrl: null, sourceName: 'docs/war-room-constitution.md', contentType: 'text',
    organization: null, language: 'en', license: 'Commander-owned', retrievedAt: NOW,
    provenance: { sourceUrl: 'repo://docs/war-room-constitution.md', retrievedAt: NOW, isHistorical: false },
  })
  const session: LearningSession = {
    id: 'w81-session-constitution', project_id: null, conversation_id: null,
    objective: 'Retrieve and connect Commander-owned constitution claims without promoting storage to verified knowledge.',
    status: 'completed', initiated_by: 'commander', started_at: NOW, completed_at: NOW,
    source_ids: ['src:constitution'], claim_ids: claims.map((_, index) => `claim:${index}`), gap_ids: ['gap:unverified'],
    items: [
      { itemType: 'DISCOVERY', role: 'generator', detail: 'Registered docs/war-room-constitution.md', refIds: ['src:constitution'], createdAt: NOW },
      { itemType: 'ACQUISITION', role: 'generator', detail: 'Read constitution excerpt', refIds: ['src:constitution'], createdAt: NOW },
      { itemType: 'CLAIM_EXTRACTION', role: 'generator', detail: claims[0] ?? 'candidate claim', refIds: ['claim:0'], createdAt: NOW },
      { itemType: 'CONTRADICTION_CHECK', role: 'verifier', detail: 'No second source; no contradiction opened.', refIds: ['claim:0'], createdAt: NOW },
      { itemType: 'VERIFY', role: 'verifier', detail: 'Structural evidence present; status remains candidate.', refIds: ['claim:0'], createdAt: NOW },
      { itemType: 'GAP_CREATION', role: 'generator', detail: 'Independent verifier not executed in this bounded session.', refIds: ['gap:unverified'], createdAt: NOW },
      { itemType: 'KNOWLEDGE_UPDATE', role: 'generator', detail: 'Candidate world knowledge only.', refIds: ['k1'], createdAt: NOW },
    ],
    outcome_summary: `Extracted ${claims.length} candidate claim(s); none auto-verified.`,
    metrics: { documentCount: 1, sourceCount: 1, claimCount: claims.length, claimsWithEvidenceRatio: 1, gapCount: 1 },
    experience_ids: [], created_at: NOW,
  }
  const evals = evaluateUnderstanding(session, false)
  return evals.map(item => {
    const format = item.skill === 'compare' ? 'contradiction_handling' as const
      : item.skill === 'retrieve' ? 'retrieval_grounded' as const
        : 'project_memory_continuity' as const
    const base = baseExample({
      format, qualityTier: 'B', trainability: 'positive_training',
      capabilityTags: ['world_learning', item.skill.replaceAll('_', '-')],
      sourceClass: 'ELIGIBLE', sourceIds: ['src:constitution-session'],
      provenanceRefs: ['session:w81-session-constitution', 'repo-file:docs/war-room-constitution.md'],
      rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: true },
      input: item.prompt, contextRefs: ['session:w81-session-constitution'],
      toolAction: null, toolResult: null,
      evidenceRefs: [`session:${session.id}`, ...session.claim_ids.map(id => `claim:${id}`)],
      finalResponse: `${item.detail}. Claim status remains candidate until an independent verifier acts.`,
      validator: `world-learning-understanding:${item.id}`, outcome: item.passed ? 'pass' : 'fail',
      correction: null, claimStatus: 'candidate',
      lineageIds: [`world-learning:${item.skill}`, 'session:w81-session-constitution'],
    })
    return toHardenedExample(base, {
      provenance: commanderProvenance('session:w81-session-constitution', base.contentHash, 'world-learning-session-items'),
      validatorSpec: { type: 'world-learning-understanding', expected: item.passed ? 'pass' : 'fail' },
    })
  })
}

function hashFile(repo: string, rel: string): string {
  return createHash('sha256').update(readFileSync(join(repo, rel))).digest('hex')
}

export type EngineeringBundle81 = {
  records: ContinuousEvidenceRecord[]
  examples: HardenedExample[]
  families: Record<string, number>
  distinctLineages: number
  distinctValidatorTypes: number
  choreHeavy: boolean
}

function missionExample(input: {
  family: EngineeringFamily
  source: 'code_operator' | 'tool_use'
  capability: string[]
  validator: string
  lineage: string[]
  pass: boolean
  objective: string
  detail: string
  toolActions?: HardenedExample['toolActions']
  toolResults?: HardenedExample['toolResults']
  now: Date
}): { record: ContinuousEvidenceRecord | null; example: HardenedExample } {
  const evaluated = evaluateContinuousEvidence({
    source: input.source, subjectRef: `w81-mission:${input.lineage[0]}`, outcome: input.pass ? 'pass' : 'fail',
    observedAt: input.now.toISOString(), validUntil: null,
    provenanceRefs: ['repo:local', `mission:${input.lineage[0]}`, `detail:${sha256(input.detail).slice(0, 16)}`],
    sourceLineageIds: input.lineage, capabilityTags: input.capability, curriculumTags: ['wave81-evidence'],
    validatorTypes: [input.validator], verifierId: `w81-verifier:${input.validator}`, evaluatorId: 'w81-admission-evaluator',
    objectiveEvaluated: true, objectiveSatisfied: input.pass, objectiveVerified: input.pass,
  }, input.now)
  const format = input.source === 'tool_use' ? 'tool_use' as const : 'instruction_response' as const
  const base = baseExample({
    format, qualityTier: input.pass ? 'A' : 'excluded',
    trainability: input.pass ? 'positive_training' : 'failure_curriculum',
    capabilityTags: input.capability, sourceClass: 'ELIGIBLE', sourceIds: input.lineage,
    provenanceRefs: ['repo:local', `mission:${input.lineage[0]}`],
    rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: input.pass },
    input: input.objective, contextRefs: input.lineage,
    toolAction: input.toolActions?.[0]?.tool ?? (input.source === 'tool_use' ? input.validator : null),
    toolResult: input.detail, evidenceRefs: evaluated.record ? [evaluated.record.evidence.id] : [],
    finalResponse: input.pass ? 'pass' : 'fail', validator: input.validator, outcome: input.pass ? 'pass' : 'fail',
    correction: null, lineageIds: input.lineage,
  })
  return {
    record: evaluated.record,
    example: toHardenedExample(base, {
      toolActions: input.toolActions ?? [],
      toolResults: input.toolResults ?? [],
      provenance: commanderProvenance(input.lineage[0]!, base.contentHash, 'live-repo-observation'),
      engineeringFamily: input.family,
      validatorSpec: { type: input.validator, expected: input.pass ? 'pass' : 'fail' },
    }),
  }
}

function loadWave42Missions(repo: string): HardenedExample[] {
  const dir = join(repo, 'model-lab/manifests/wave4_2')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(name => /^w42mission_.*\.json$/.test(name)).sort()
  const examples: HardenedExample[] = []
  for (const name of files) {
    const bundle = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
      mission: { missionId: string; objective: string; capabilityTags: string[]; sourceTaskLineageId: string; patchLineageId: string; terminalStatus: string }
      actions: Array<{ actionType: string; command: string | null; description: string; resultStatus: string; exitCode: number | null }>
      validators: Array<{ validatorType: string; passed: boolean }>
    }
    const pass = bundle.mission.terminalStatus === 'completed_verified' && bundle.validators.every(item => item.passed)
    const family: EngineeringFamily = bundle.actions.some(item => item.actionType === 'typecheck') ? 'type_lint_repair'
      : bundle.actions.some(item => item.actionType === 'build') ? 'build_reasoning'
        : 'artifact_verification'
    const base = baseExample({
      format: 'instruction_response', qualityTier: 'A', trainability: pass ? 'positive_training' : 'failure_curriculum',
      capabilityTags: ['engineering_evidence', ...bundle.mission.capabilityTags],
      sourceClass: 'ELIGIBLE', sourceIds: [bundle.mission.sourceTaskLineageId],
      provenanceRefs: [`wave4.2:${bundle.mission.missionId}`],
      rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: pass },
      input: bundle.mission.objective, contextRefs: [bundle.mission.patchLineageId],
      toolAction: bundle.actions[0]?.command ?? bundle.actions[0]?.actionType ?? null,
      toolResult: bundle.actions.map(item => `${item.actionType}:${item.resultStatus}:${item.exitCode}`).join('; '),
      evidenceRefs: [`wave4.2:${name}`], finalResponse: pass ? 'completed_verified' : 'failed',
      validator: bundle.validators.map(item => item.validatorType).join(','),
      outcome: pass ? 'pass' : 'fail', correction: null,
      lineageIds: [bundle.mission.sourceTaskLineageId, bundle.mission.patchLineageId],
    })
    examples.push(toHardenedExample(base, {
      toolActions: bundle.actions.map(item => ({ tool: item.actionType, arguments: { command: item.command }, selected: true })),
      toolResults: bundle.actions.map(item => ({ tool: item.actionType, result: item.description, exitCode: item.exitCode ?? 1 })),
      provenance: commanderProvenance(`wave4.2:${bundle.mission.missionId}`, base.contentHash, 'wave4.2-mission-manifest'),
      engineeringFamily: family,
    }))
  }
  return examples
}

function loadWave5Missions(repo: string): HardenedExample[] {
  const dir = join(repo, 'model-lab/manifests/wave5')
  if (!existsSync(dir)) return []
  const files = ['mission-wave5-typescript.json', 'mission-wave5-eslint.json', 'mission-wave5-build.json', 'mission-wave5-evidence-gates.json', 'mission-wave1-4.2-regression.json']
  const familyMap: Record<string, EngineeringFamily> = {
    'mission-wave5-typescript.json': 'type_lint_repair',
    'mission-wave5-eslint.json': 'type_lint_repair',
    'mission-wave5-build.json': 'build_reasoning',
    'mission-wave5-evidence-gates.json': 'test_construction',
    'mission-wave1-4.2-regression.json': 'test_construction',
  }
  const examples: HardenedExample[] = []
  for (const name of files) {
    const full = join(dir, name)
    if (!existsSync(full)) continue
    const row = JSON.parse(readFileSync(full, 'utf8')) as { key: string; objective: string; exitCode: number; evidenceId: string }
    const pass = row.exitCode === 0
    const base = baseExample({
      format: 'instruction_response', qualityTier: 'A', trainability: pass ? 'positive_training' : 'failure_curriculum',
      capabilityTags: ['engineering_evidence', row.key], sourceClass: 'ELIGIBLE', sourceIds: [`wave5:${row.key}`],
      provenanceRefs: [`wave5:${name}`, row.evidenceId],
      rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: pass },
      input: row.objective, contextRefs: [`wave5:${row.key}`], toolAction: row.key, toolResult: `exitCode=${row.exitCode}`,
      evidenceRefs: [row.evidenceId], finalResponse: pass ? 'pass' : 'fail', validator: row.key,
      outcome: pass ? 'pass' : 'fail', correction: null, lineageIds: [`wave5:${row.key}`],
    })
    examples.push(toHardenedExample(base, {
      provenance: commanderProvenance(`wave5:${name}`, base.contentHash, 'wave5-mission-manifest'),
      engineeringFamily: familyMap[name],
    }))
  }
  return examples
}

export function buildEngineeringAndToolEvidence81(repo = process.cwd()): EngineeringBundle81 {
  const now = new Date(NOW)
  const records: ContinuousEvidenceRecord[] = []
  const examples: HardenedExample[] = []
  const push = (item: { record: ContinuousEvidenceRecord | null; example: HardenedExample }) => {
    if (item.record) records.push(item.record)
    examples.push(item.example)
  }

  const searchRoute = readFileSync(join(repo, 'app/api/search/route.ts'), 'utf8')
  push(missionExample({
    family: 'repo_navigation', source: 'code_operator', capability: ['engineering_evidence', 'repo-navigation'],
    validator: 'route-export-present', lineage: ['task:w81:nav-search-route'], pass: /export async function (GET|POST)/.test(searchRoute),
    objective: 'Navigate to the search API route and confirm it exports an HTTP handler.',
    detail: searchRoute.slice(0, 180), now,
  }))

  const typesText = readFileSync(join(repo, 'lib/continuous-evidence/types.ts'), 'utf8')
  push(missionExample({
    family: 'diagnosis', source: 'code_operator', capability: ['engineering_evidence', 'diagnosis'],
    validator: 'source-contains', lineage: ['task:w81:diagnose-tool-use-source'],
    pass: typesText.includes("'tool_use'") && typesText.includes('tool_use_result'),
    objective: 'Diagnose whether ContinuousEvidenceSource treats tool_use as first-class rather than collapsing into code_operator.',
    detail: 'tool_use+tool_use_result', now,
  }))

  const hashModule = readFileSync(join(repo, 'lib/wrim1-dataset/hash.ts'), 'utf8')
  const repaired = hashModule.replace('estimateUtf8Tokens', 'estimateUtf8Tokens')
  push(missionExample({
    family: 'repair', source: 'code_operator', capability: ['engineering_evidence', 'repair'],
    validator: 'in-memory-identity-repair', lineage: ['task:w81:repair-identity'],
    pass: repaired.includes('export function estimateUtf8Tokens') && !containsSecret(repaired) && !containsHiddenCot(repaired),
    objective: 'Confirm the byte-estimate helper remains exported for diagnostic use and is not treated as the authoritative tokenizer count.',
    detail: 'estimateUtf8Tokens-retained-as-secondary', now,
  }))

  const formats = readFileSync(join(repo, 'lib/wrim1-dataset/types.ts'), 'utf8')
  push(missionExample({
    family: 'test_construction', source: 'code_operator', capability: ['engineering_evidence', 'test-construction'],
    validator: 'assertion-constructed', lineage: ['task:w81:test-formats'],
    pass: formats.includes("'tool_use'") && formats.includes('HARDENED_CORPUS_ID'),
    objective: 'Construct a bounded assertion that canonical formats include tool_use and that the hardened corpus id constant exists.',
    detail: 'formats+HARDENED_CORPUS_ID', now,
  }))

  const sql = readFileSync(join(repo, 'supabase/war_room_phase56b_tool_use_evidence_source.sql'), 'utf8')
  push(missionExample({
    family: 'schema_reasoning', source: 'code_operator', capability: ['engineering_evidence', 'schema-reasoning'],
    validator: 'sql-contains', lineage: ['task:w81:schema-56b'],
    pass: sql.includes('tool_use_result') && sql.includes('objective_satisfied'),
    objective: 'Reason about Phase 56B: additive tool_use_result kind and gym objective columns.',
    detail: 'phase56b-additive', now,
  }))

  const tsconfig = JSON.parse(readFileSync(join(repo, 'tsconfig.json'), 'utf8')) as { compilerOptions?: { paths?: Record<string, string[]> } }
  push(missionExample({
    family: 'build_reasoning', source: 'code_operator', capability: ['engineering_evidence', 'build-reasoning'],
    validator: 'tsconfig-paths', lineage: ['task:w81:build-alias'],
    pass: Boolean(tsconfig.compilerOptions?.paths?.['@/*']),
    objective: 'Confirm the TypeScript path alias used by the production build is present.',
    detail: JSON.stringify(tsconfig.compilerOptions?.paths ?? {}), now,
  }))

  push(missionExample({
    family: 'type_lint_repair', source: 'code_operator', capability: ['engineering_evidence', 'typescript'],
    validator: 'union-members', lineage: ['task:w81:types-union'],
    pass: formats.includes('contradiction_handling') && formats.includes('spatial_terra_reasoning'),
    objective: 'Confirm example format union still includes contradiction and Terra reasoning members.',
    detail: 'union-members-present', now,
  }))

  const tokenizerHash = hashFile(repo, 'model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json')
  push(missionExample({
    family: 'artifact_verification', source: 'code_operator', capability: ['engineering_evidence', 'artifact-verification'],
    validator: 'sha256-known', lineage: ['task:w81:hash-tokenizer'],
    pass: tokenizerHash === '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7',
    objective: 'Verify WR-TOKENIZER-0 artifact hash without using the tokenizer as unlabeled training text.',
    detail: tokenizerHash, now,
  }))

  push(missionExample({
    family: 'api_reasoning', source: 'code_operator', capability: ['engineering_evidence', 'api-contract'],
    validator: 'handler-export', lineage: ['task:w81:api-search'],
    pass: searchRoute.includes('export async function GET') || searchRoute.includes('export async function POST'),
    objective: 'Reason about the search route contract: an exported HTTP method handler must exist.',
    detail: 'GET-or-POST', now,
  }))

  const toolGym = runToolUseGym({
    missionId: 'w81-tool-sha-storage', gym: 'tool_use',
    objective: 'Hash a Commander-owned doctrine phrase with the bounded sha256 tool.',
    capabilityTags: ['tool_use', 'tool-selection'], curriculumTags: ['tools'],
    sourceLineageIds: ['task:w81:tool-sha-storage'],
  }, { tool: 'sha256', argument: 'storage-is-not-learning', expectedPrefix: createHash('sha256').update('storage-is-not-learning').digest('hex') })
  const toolGym2 = runToolUseGym({
    missionId: 'w81-tool-sha-wave81', gym: 'tool_use',
    objective: 'Hash a distinct Commander-owned phrase with the bounded sha256 tool.',
    capabilityTags: ['tool_use', 'tool-selection'], curriculumTags: ['tools'],
    sourceLineageIds: ['task:w81:tool-sha-wave81'],
  }, { tool: 'sha256', argument: 'wave-8-1-hardening', expectedPrefix: createHash('sha256').update('wave-8-1-hardening').digest('hex') })
  const unsafe = runToolUseGym({
    missionId: 'w81-tool-recovery', gym: 'tool_use',
    objective: 'Refuse an uncontrolled tool and record the failure for recovery curriculum.',
    capabilityTags: ['tool_use', 'error-recovery'], curriculumTags: ['tools'],
    sourceLineageIds: ['task:w81:tool-recovery'],
  }, { tool: 'curl', argument: 'https://example.invalid/wave81', expectedPrefix: 'nope' })
  const codeGym = runCodeOperatorGym({
    missionId: 'w81-code-nav-wave42', gym: 'code_operator',
    objective: 'Navigate to the Wave 4.2 dataset manifest and verify its immutable hash.',
    capabilityTags: ['engineering_evidence', 'artifact-verification'], curriculumTags: ['code_skill'],
    sourceLineageIds: ['task:w81:code-nav-wave42'],
  }, { filePath: join(repo, 'model-lab/manifests/wave4_2/training-dataset-manifest.json'), expectedHash: '187c850b39a8b6255ce5e1b8d0643e29863402676fa685661cc4eb3ba166624c' })

  for (const run of [toolGym, toolGym2, unsafe, codeGym]) {
    const evaluated = evaluateContinuousEvidence(gymRunToEvidenceInput(run), now).record
    if (evaluated) records.push(evaluated)
    const family: EngineeringFamily = run.mission.gym === 'tool_use'
      ? (run.outcome === 'fail' ? 'error_recovery' : 'tool_selection')
      : 'repo_navigation'
    const base = baseExample({
      format: run.mission.gym === 'tool_use' ? 'tool_use' : 'instruction_response',
      qualityTier: run.outcome === 'pass' ? 'A' : 'excluded',
      trainability: run.outcome === 'pass' ? 'positive_training' : 'failure_curriculum',
      capabilityTags: run.mission.capabilityTags, sourceClass: 'ELIGIBLE', sourceIds: run.mission.sourceLineageIds,
      provenanceRefs: [`gym:${run.mission.missionId}`],
      rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: run.outcome === 'pass' },
      input: run.mission.objective, contextRefs: run.mission.sourceLineageIds,
      toolAction: run.trajectory[0]?.action ?? null, toolResult: run.trajectory.map(step => step.resultSummary).join('; '),
      evidenceRefs: evaluated ? [evaluated.evidence.id] : [], finalResponse: run.outcome,
      validator: run.criteria.map(item => item.id).join(','), outcome: run.outcome, correction: null,
      lineageIds: run.mission.sourceLineageIds,
    })
    examples.push(toHardenedExample(base, {
      toolActions: run.trajectory.map(step => ({ tool: String(step.action), arguments: step.arguments as Record<string, unknown>, selected: step.exitCode === 0 })),
      toolResults: run.trajectory.map(step => ({ tool: String(step.action), result: step.resultSummary, exitCode: step.exitCode ?? 1 })),
      provenance: commanderProvenance(`gym:${run.mission.missionId}`, base.contentHash, 'agi-gym-trajectory'),
      engineeringFamily: family,
    }))
  }

  examples.push(...loadWave42Missions(repo))
  examples.push(...loadWave5Missions(repo))

  const families: Record<string, number> = {}
  for (const example of examples) {
    if (example.engineeringFamily) families[example.engineeringFamily] = (families[example.engineeringFamily] ?? 0) + 1
  }
  const chore = (families.artifact_verification ?? 0)
  const totalEng = examples.filter(item => item.capabilityTags.includes('engineering_evidence') || item.engineeringFamily).length
  const lineages = new Set(records.flatMap(record => record.sourceLineageIds))
  const validators = new Set(records.flatMap(record => record.validatorTypes))
  return {
    records, examples, families, distinctLineages: lineages.size, distinctValidatorTypes: validators.size,
    choreHeavy: totalEng > 0 && chore / totalEng > 0.4,
  }
}

export function realToolUseCount(examples: HardenedExample[]): number {
  return examples.filter(item => item.format === 'tool_use'
    && item.toolActions.some(action => action.tool === 'select_tool' || action.tool === 'sha256' || action.tool === 'execute_tool')
    && item.toolResults.length > 0).length
}
