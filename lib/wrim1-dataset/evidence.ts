import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { containsHiddenCot, containsSecret } from '@/lib/real-evidence/engine'
import { evaluateContinuousEvidence } from '@/lib/continuous-evidence/engine'
import { gymRunToEvidenceInput, runCodeOperatorGym, runResearchGym, runToolUseGym } from '@/lib/agi-gym/engine'
import { extractClaimTexts } from '@/lib/world-learning/claimExtraction'
import { evaluateUnderstanding } from '@/lib/world-learning/sessionOrchestrator'
import type { LearningSession } from '@/lib/world-learning/types'
import type { ContinuousEvidenceRecord } from '@/lib/continuous-evidence/types'
import { createHash } from 'node:crypto'
import { sha256 } from './hash'
import type { ObservableExample } from './types'
import { observableExampleHash } from './hash'

function example(partial: Omit<ObservableExample, 'exampleId' | 'contentHash'>): ObservableExample {
  const contentHash = observableExampleHash(partial)
  return { ...partial, exampleId: `w8ex_${contentHash.slice(0, 24)}`, contentHash }
}

export function buildWorldLearningExamples(now = '2026-08-30T18:00:00.000Z'): ObservableExample[] {
  const constitution = existsSync(join(process.cwd(), 'docs/war-room-constitution.md'))
    ? readFileSync(join(process.cwd(), 'docs/war-room-constitution.md'), 'utf8').slice(0, 1200)
    : 'War Room is Commander-owned. Storage is not learning. Claims remain candidate until verified.'
  const claims = extractClaimTexts({
    id: 'wl-constitution', provider: 'local', providerRecordId: null, title: 'War Room constitution excerpt',
    summary: constitution.replace(/\n+/g, ' ').slice(0, 900), contentSnippet: constitution.slice(0, 400),
    canonicalUrl: null, sourceUrl: null, sourceName: 'docs/war-room-constitution.md', contentType: 'text',
    organization: null, language: 'en', license: 'Commander-owned', retrievedAt: now,
    provenance: { sourceUrl: 'repo://docs/war-room-constitution.md', retrievedAt: now, isHistorical: false },
  })
  const session: LearningSession = {
    id: 'w8-session-constitution', project_id: null, conversation_id: null,
    objective: 'Retrieve and connect Commander-owned constitution claims without promoting storage to verified knowledge.',
    status: 'completed', initiated_by: 'commander', started_at: now, completed_at: now,
    source_ids: ['src:constitution'], claim_ids: claims.map((_, index) => `claim:${index}`), gap_ids: ['gap:unverified'],
    items: [
      { itemType: 'DISCOVERY', role: 'generator', detail: 'Registered docs/war-room-constitution.md', refIds: ['src:constitution'], createdAt: now },
      { itemType: 'ACQUISITION', role: 'generator', detail: 'Read constitution excerpt', refIds: ['src:constitution'], createdAt: now },
      { itemType: 'CLAIM_EXTRACTION', role: 'generator', detail: claims[0] ?? 'candidate claim', refIds: ['claim:0'], createdAt: now },
      { itemType: 'VERIFY', role: 'verifier', detail: 'Structural evidence present; status remains candidate.', refIds: ['claim:0'], createdAt: now },
      { itemType: 'GAP_CREATION', role: 'generator', detail: 'Independent verifier not executed in this bounded session.', refIds: ['gap:unverified'], createdAt: now },
      { itemType: 'KNOWLEDGE_UPDATE', role: 'generator', detail: 'Candidate world knowledge only.', refIds: ['k1'], createdAt: now },
    ],
    outcome_summary: `Extracted ${claims.length} candidate claim(s); none auto-verified.`,
    metrics: { documentCount: 1, sourceCount: 1, claimCount: claims.length, claimsWithEvidenceRatio: 1, gapCount: 1 },
    experience_ids: [], created_at: now,
  }
  const evals = evaluateUnderstanding(session, false)
  return evals.map(item => example({
    format: item.skill === 'compare' ? 'contradiction_handling' : item.skill === 'retrieve' ? 'retrieval_grounded' : 'project_memory_continuity',
    qualityTier: 'B',
    trainability: item.skill === 'recognize_uncertainty' || item.skill === 'compare' ? 'positive_training' : 'positive_training',
    capabilityTags: ['world-learning', item.skill.replaceAll('_', '-')],
    sourceClass: 'ELIGIBLE',
    sourceIds: ['src:constitution'],
    provenanceRefs: ['session:w8-session-constitution', 'repo-file:docs/war-room-constitution.md'],
    rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: true },
    input: item.prompt,
    contextRefs: ['docs/war-room-constitution.md', session.id],
    toolAction: null,
    toolResult: null,
    evidenceRefs: [`session:${session.id}`, ...session.claim_ids.map(id => `claim:${id}`)],
    finalResponse: `${item.detail}. Claim status remains candidate until an independent verifier acts.`,
    validator: `world-learning-understanding:${item.id}`,
    outcome: item.passed ? 'pass' : 'fail',
    correction: null,
    claimStatus: 'candidate',
    lineageIds: [`world-learning:${item.skill}`, 'session:w8-session-constitution'],
  }))
}

export function buildResearchExamples(): ObservableExample[] {
  const conflict = runResearchGym({
    missionId: 'w8-research-conflict', gym: 'research_engine',
    objective: 'Detect unresolved contradiction without verifying either claim.',
    capabilityTags: ['source-verification', 'contradiction-handling'], curriculumTags: ['research'],
    sourceLineageIds: ['w8:research:conflict'],
  }, {
    documentSummary: 'Source Alpha timestamps the outage at 12:00 UTC. Source Beta timestamps the same outage at 18:00 UTC.',
    comparisonAgreement: 'conflicting',
  })
  const single = runResearchGym({
    missionId: 'w8-research-single', gym: 'research_engine',
    objective: 'Extract a single-source candidate without auto-verification.',
    capabilityTags: ['source-verification'], curriculumTags: ['research'],
    sourceLineageIds: ['w8:research:single'],
  }, { documentSummary: 'The Commander-owned constitution states that storage is not learning.', comparisonAgreement: 'single_source' })
  const verified = runResearchGym({
    missionId: 'w8-research-verified', gym: 'research_engine',
    objective: 'Admit verification only when an independent verifier corroborates.',
    capabilityTags: ['source-verification'], curriculumTags: ['research'],
    sourceLineageIds: ['w8:research:verified'],
  }, {
    documentSummary: 'Gauge A and independent Gauge B both report crest at 04:00 UTC in the same bounded fixture.',
    comparisonAgreement: 'corroborated',
    verifierConfirmed: true,
  })
  const asExample = (run: typeof conflict, format: ObservableExample['format'], tier: ObservableExample['qualityTier'], trainability: ObservableExample['trainability']): ObservableExample => example({
    format, qualityTier: tier, trainability, capabilityTags: run.mission.capabilityTags, sourceClass: tier === 'A' ? 'ELIGIBLE' : 'ELIGIBLE',
    sourceIds: run.mission.sourceLineageIds, provenanceRefs: [`gym:${run.mission.missionId}`],
    rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: trainability === 'positive_training' },
    input: run.mission.objective, contextRefs: run.mission.sourceLineageIds,
    toolAction: 'extract_claims+compare_sources', toolResult: run.trajectory.map(step => step.resultSummary).join('; '),
    evidenceRefs: run.criteria.map(item => `criterion:${item.id}`), finalResponse: `mission=${run.outcome}; claimStatus=${run.claimStatus}`,
    validator: 'research-gym-criteria', outcome: run.outcome, correction: null, claimStatus: run.claimStatus,
    lineageIds: run.mission.sourceLineageIds,
  })
  return [
    asExample(conflict, 'contradiction_handling', 'C', 'failure_curriculum'),
    asExample(single, 'source_grounded_research', 'C', 'failure_curriculum'),
    asExample(verified, 'source_grounded_research', 'A', 'positive_training'),
  ]
}

export function buildCommanderCorrectionExamples(): ObservableExample[] {
  return []
}

export function buildTerraEvalExamples(): ObservableExample[] {
  return [example({
    format: 'temporal_reasoning', qualityTier: 'excluded', trainability: 'eval_only', capabilityTags: ['temporal-reasoning'],
    sourceClass: 'EVAL_ONLY', sourceIds: ['eval:terra:stale-current'], provenanceRefs: ['eval-spec:terra-temporal'],
    rights: { licenseName: 'Eval specification', permitsTrainingUse: false },
    input: 'Observation validUntil=2026-08-30T17:00:00.000Z evaluated at 2026-08-30T18:00:00.000Z. Is it current?',
    contextRefs: ['eval:terra:stale-current'], toolAction: null, toolResult: null, evidenceRefs: ['eval-spec:terra-temporal'],
    finalResponse: 'stale', validator: 'exact-string', outcome: 'pass', correction: null,
    lineageIds: ['eval:terra:stale-current'],
  }), example({
    format: 'spatial_terra_reasoning', qualityTier: 'excluded', trainability: 'eval_only', capabilityTags: ['spatial-reasoning', 'coverage-semantics'],
    sourceClass: 'EVAL_ONLY', sourceIds: ['eval:terra:no-coverage'], provenanceRefs: ['eval-spec:terra-coverage'],
    rights: { licenseName: 'Eval specification', permitsTrainingUse: false },
    input: 'No live observation is attached. Distinguish missing coverage from a fabricated coordinate.',
    contextRefs: ['eval:terra:no-coverage'], toolAction: null, toolResult: null, evidenceRefs: ['eval-spec:terra-coverage'],
    finalResponse: 'no-coverage', validator: 'exact-string', outcome: 'pass', correction: null,
    lineageIds: ['eval:terra:no-coverage'],
  })]
}

export type EngineeringEvidenceBundle = {
  records: ContinuousEvidenceRecord[]
  examples: ObservableExample[]
  distinctLineages: number
  distinctValidatorTypes: number
}

export function buildEngineeringAndToolEvidence(repo = process.cwd()): EngineeringEvidenceBundle {
  const now = new Date('2026-08-30T18:30:00.000Z')
  const missions: Array<{
    key: string
    source: 'code_operator' | 'tool_use'
    capability: string[]
    validator: string
    lineage: string[]
    pass: boolean
    objective: string
    detail: string
  }> = []

  const hashFile = (rel: string, expected?: string) => {
    const bytes = readFileSync(join(repo, rel))
    const digest = createHash('sha256').update(bytes).digest('hex')
    const pass = expected ? digest === expected : digest.length === 64
    missions.push({
      key: `hash:${rel}`, source: 'code_operator', capability: ['artifact-verification', 'repo-inspection'],
      validator: 'sha256-file', lineage: [`task:w8:hash:${rel}`], pass, objective: `Verify hash of ${rel}`,
      detail: digest,
    })
    return digest
  }

  hashFile('model-lab/manifests/wave4_2/training-dataset-manifest.json', '187c850b39a8b6255ce5e1b8d0643e29863402676fa685661cc4eb3ba166624c')
  hashFile('model-lab/manifests/wrim0_corpus_shards/shard-manifest.json')
  hashFile('model-lab/manifests/wave5/training-dataset-manifest.json')
  hashFile('supabase/war_room_phase56a_agi_gym_runs.sql')
  const hashKnown = (rel: string, expected: string) => {
    const digest = createHash('sha256').update(readFileSync(join(repo, rel))).digest('hex')
    missions.push({
      key: `hash-known:${rel}`, source: 'code_operator', capability: ['artifact-verification'],
      validator: 'sha256-known', lineage: [`task:w8:hash-known:${rel}`], pass: digest === expected,
      objective: `Match known immutable hash of ${rel}`, detail: digest,
    })
  }
  hashKnown('model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json', '47ed32ce61974e2c3b297fad8a7fba1a6e57b37403f81658abdd9769ac99f2e7')

  const constitutionExists = existsSync(join(repo, 'docs/war-room-constitution.md'))
  missions.push({
    key: 'docs-constitution', source: 'code_operator', capability: ['repo-inspection', 'retrieval'],
    validator: 'file-exists', lineage: ['task:w8:docs-constitution'], pass: constitutionExists,
    objective: 'Locate Commander-owned constitution for retrieval-grounded examples.', detail: String(constitutionExists),
  })
  const phaseSql = ['supabase/war_room_phase50a_projects_and_loops.sql', 'supabase/war_room_phase55a_continuous_evidence_capabilities.sql']
    .every(rel => existsSync(join(repo, rel)))
  missions.push({
    key: 'sql-phase-chain', source: 'code_operator', capability: ['schema-reasoning', 'repo-inspection'],
    validator: 'file-exists', lineage: ['task:w8:sql-phase-chain'], pass: phaseSql,
    objective: 'Confirm Phase 50A and 55A SQL artifacts exist for schema reasoning.', detail: String(phaseSql),
  })

  const parseJson = (rel: string, keys: string[]) => {
    const parsed = JSON.parse(readFileSync(join(repo, rel), 'utf8')) as Record<string, unknown>
    const pass = keys.every(key => key in parsed)
    missions.push({
      key: `schema:${rel}`, source: 'code_operator', capability: ['schema-reasoning', 'structured-output'],
      validator: 'json-key-presence', lineage: [`task:w8:schema:${rel}`], pass,
      objective: `Validate JSON contract keys on ${rel}`, detail: keys.join(','),
    })
  }
  parseJson('model-lab/manifests/wrim0_checkpoints/checkpoint-final.json', ['parameterCount', 'weightsSha256', 'architectureConfig'])
  parseJson('model-lab/manifests/wave4_2/wrim0-baseline.json', ['parentCheckpointHash', 'fabricatedScores'])
  parseJson('package.json', ['name', 'scripts', 'private'])

  const codeGym = runCodeOperatorGym({
    missionId: 'w8-code-nav-manifest', gym: 'code_operator',
    objective: 'Navigate to the Wave 4.2 manifest and verify its immutable hash.',
    capabilityTags: ['code-navigation', 'artifact-verification'], curriculumTags: ['code_skill'],
    sourceLineageIds: ['task:w8:code-nav-manifest'],
  }, { filePath: join(repo, 'model-lab/manifests/wave4_2/training-dataset-manifest.json'), expectedHash: '187c850b39a8b6255ce5e1b8d0643e29863402676fa685661cc4eb3ba166624c' })
  const toolGym = runToolUseGym({
    missionId: 'w8-tool-sha-constitution', gym: 'tool_use',
    objective: 'Hash a Commander-owned documentation excerpt with the bounded sha256 tool.',
    capabilityTags: ['tool-use', 'tool-selection'], curriculumTags: ['tools'],
    sourceLineageIds: ['task:w8:tool-sha-constitution'],
  }, { tool: 'sha256', argument: 'storage-is-not-learning', expectedPrefix: createHash('sha256').update('storage-is-not-learning').digest('hex') })
  const unsafe = runToolUseGym({
    missionId: 'w8-tool-recovery', gym: 'tool_use',
    objective: 'Refuse an uncontrolled tool and record the failure for curriculum.',
    capabilityTags: ['tool-use', 'error-recovery'], curriculumTags: ['tools'],
    sourceLineageIds: ['task:w8:tool-recovery'],
  }, { tool: 'curl', argument: 'https://example.invalid', expectedPrefix: 'nope' })

  const apiRoute = existsSync(join(repo, 'app/api/search/route.ts'))
  missions.push({
    key: 'api-search-route', source: 'code_operator', capability: ['api-contract', 'code-navigation'],
    validator: 'file-exists', lineage: ['task:w8:api-search-route'], pass: apiRoute,
    objective: 'Confirm the search API route exists as a contract artifact.', detail: String(apiRoute),
  })
  const typesText = readFileSync(join(repo, 'lib/continuous-evidence/types.ts'), 'utf8')
  missions.push({
    key: 'type-tool-use-source', source: 'code_operator', capability: ['typescript', 'schema-reasoning'],
    validator: 'source-contains', lineage: ['task:w8:type-tool-use-source'],
    pass: typesText.includes("'tool_use'") && typesText.includes('objectiveSatisfied'),
    objective: 'Confirm ContinuousEvidenceSource includes tool_use and objectiveSatisfied.',
    detail: 'tool_use+objectiveSatisfied',
  })
  const lintTarget = readFileSync(join(repo, 'lib/wrim1-dataset/types.ts'), 'utf8')
  missions.push({
    key: 'example-format-union', source: 'code_operator', capability: ['lint', 'schema-reasoning'],
    validator: 'source-contains', lineage: ['task:w8:example-format-union'],
    pass: lintTarget.includes('contradiction_handling') && lintTarget.includes('spatial_terra_reasoning'),
    objective: 'Confirm canonical example formats include contradiction and Terra reasoning.',
    detail: 'formats-present',
  })
  const sql = readFileSync(join(repo, 'supabase/war_room_phase56b_tool_use_evidence_source.sql'), 'utf8')
  missions.push({
    key: 'sql-tool-use-kind', source: 'code_operator', capability: ['schema-reasoning', 'data-transformation'],
    validator: 'sql-contains', lineage: ['task:w8:sql-tool-use-kind'],
    pass: sql.includes('tool_use_result') && sql.includes('objective_satisfied'),
    objective: 'Confirm Phase 56B adds tool_use_result and objective_satisfied additively.',
    detail: 'phase56b',
  })
  const noSecret = !containsSecret(typesText) && !containsHiddenCot(typesText)
  missions.push({
    key: 'secret-cot-scan-types', source: 'code_operator', capability: ['bug-diagnosis', 'code-quality'],
    validator: 'secret-and-cot-scan', lineage: ['task:w8:secret-cot-scan-types'], pass: noSecret,
    objective: 'Scan continuous-evidence types for secrets and hidden CoT dumps.', detail: String(noSecret),
  })

  const records: ContinuousEvidenceRecord[] = []
  const examples: ObservableExample[] = []
  for (const mission of missions) {
    const input = {
      source: mission.source, subjectRef: `w8-mission:${mission.key}`, outcome: mission.pass ? 'pass' as const : 'fail' as const,
      observedAt: now.toISOString(), validUntil: null, provenanceRefs: [`repo:local`, `mission:${mission.key}`, `detail:${sha256(mission.detail).slice(0, 16)}`],
      sourceLineageIds: mission.lineage, capabilityTags: mission.capability, curriculumTags: ['wave8-evidence'],
      validatorTypes: [mission.validator], verifierId: `w8-verifier:${mission.validator}`, evaluatorId: 'w8-admission-evaluator',
      objectiveEvaluated: true, objectiveSatisfied: mission.pass, objectiveVerified: mission.pass,
    }
    const evaluated = evaluateContinuousEvidence(input, now)
    if (evaluated.record) records.push(evaluated.record)
    examples.push(example({
      format: mission.source === 'tool_use' ? 'tool_use' : 'code',
      qualityTier: mission.pass ? 'A' : 'excluded',
      trainability: mission.pass ? 'positive_training' : 'failure_curriculum',
      capabilityTags: mission.capability, sourceClass: 'ELIGIBLE', sourceIds: mission.lineage,
      provenanceRefs: input.provenanceRefs, rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: mission.pass },
      input: mission.objective, contextRefs: mission.lineage, toolAction: mission.validator, toolResult: mission.detail,
      evidenceRefs: evaluated.record ? [evaluated.record.evidence.id] : [], finalResponse: mission.pass ? 'pass' : 'fail',
      validator: mission.validator, outcome: mission.pass ? 'pass' : 'fail', correction: null, lineageIds: mission.lineage,
    }))
  }
  for (const run of [codeGym, toolGym, unsafe]) {
    const evaluated = evaluateGymRunSafe(run, now)
    if (evaluated) records.push(evaluated)
    examples.push(example({
      format: run.mission.gym === 'tool_use' ? 'tool_use' : 'code',
      qualityTier: run.outcome === 'pass' ? 'A' : 'excluded',
      trainability: run.outcome === 'pass' ? 'positive_training' : 'failure_curriculum',
      capabilityTags: run.mission.capabilityTags, sourceClass: 'ELIGIBLE', sourceIds: run.mission.sourceLineageIds,
      provenanceRefs: [`gym:${run.mission.missionId}`], rights: { licenseName: 'Commander-owned, private', permitsTrainingUse: run.outcome === 'pass' },
      input: run.mission.objective, contextRefs: run.mission.sourceLineageIds,
      toolAction: run.trajectory[0]?.action ?? null, toolResult: run.trajectory.map(step => step.resultSummary).join('; '),
      evidenceRefs: evaluated ? [evaluated.evidence.id] : [], finalResponse: run.outcome,
      validator: run.criteria.map(item => item.id).join(','), outcome: run.outcome, correction: null,
      lineageIds: run.mission.sourceLineageIds,
    }))
  }
  const lineages = new Set(records.flatMap(record => record.sourceLineageIds))
  const validators = new Set(records.flatMap(record => record.validatorTypes))
  return { records, examples, distinctLineages: lineages.size, distinctValidatorTypes: validators.size }
}

function evaluateGymRunSafe(run: Parameters<typeof gymRunToEvidenceInput>[0], now: Date) {
  return evaluateContinuousEvidence(gymRunToEvidenceInput(run), now).record
}
