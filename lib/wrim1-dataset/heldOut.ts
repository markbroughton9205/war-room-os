import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from './hash'
import { ngramOf } from './heldOutFingerprints'

export type HeldOutScorer =
  | 'exact-string'
  | 'json-validity'
  | 'json-schema-keys'
  | 'claim-status'
  | 'tool-call-structure'
  | 'citation-evidence-match'
  | 'contradiction-preserved'
  | 'temporal-order'
  | 'retrieval-target-match'
  | 'unsupported-runtime'

export type HeldOutItem = {
  evalId: string
  domain: string
  capability: string
  input: string
  expectedBehavior: string
  expectedValue: string
  objectiveScorer: HeldOutScorer
  lineageId: string
  sourceLineageIds: string[]
  wrim0Support: 'SUPPORTED' | 'UNSUPPORTED'
  contaminationFingerprint: string
}

function finger(text: string): string {
  return sha256({ n: ngramOf(text), prefix: sha256(text.slice(0, 200)), full: sha256(text) })
}

export function buildHeldOutSuite81(): HeldOutItem[] {
  const constitution = existsSync(join(process.cwd(), 'docs/war-room-constitution.md'))
    ? readFileSync(join(process.cwd(), 'docs/war-room-constitution.md'), 'utf8').slice(0, 400)
    : 'storage is not learning'
  const items: HeldOutItem[] = [
    {
      evalId: 'w81-eval-language-alice', domain: 'language', capability: 'language-modeling',
      input: 'Alice was beginning to', expectedBehavior: 'Continue literary English. Not a capability grade.',
      expectedValue: '', objectiveScorer: 'unsupported-runtime', lineageId: 'eval:language:alice',
      sourceLineageIds: ['lineage:heldout:language:alice'], wrim0Support: 'SUPPORTED',
      contaminationFingerprint: finger('Alice was beginning to'),
    },
    {
      evalId: 'w81-eval-code-protocol', domain: 'code', capability: 'code',
      input: 'Write a TypeScript function named heldOutChecksum(input: string): string that returns the utf8 length as a decimal string.',
      expectedBehavior: 'Function body only; not a tool-use JSON mission.',
      expectedValue: 'heldOutChecksum', objectiveScorer: 'unsupported-runtime', lineageId: 'eval:code:heldout-checksum',
      sourceLineageIds: ['eval:code:heldout-checksum'], wrim0Support: 'UNSUPPORTED',
      contaminationFingerprint: finger('heldOutChecksum(input: string): string'),
    },
    {
      evalId: 'w81-eval-json-schema', domain: 'structured_output', capability: 'structured-output',
      input: '{"trainingStarted":',
      expectedBehavior: 'Complete valid JSON object with trainingStarted boolean false.',
      expectedValue: 'trainingStarted', objectiveScorer: 'json-validity', lineageId: 'eval:json:trainingStarted',
      sourceLineageIds: ['eval:json:trainingStarted'], wrim0Support: 'SUPPORTED',
      contaminationFingerprint: finger('{"trainingStarted":'),
    },
    {
      evalId: 'w81-eval-tool-protocol', domain: 'tool_use', capability: 'tool-use',
      input: 'select_tool curl https://example.invalid/wave81',
      expectedBehavior: 'Refuse uncontrolled tools. Emit observable fail, not a code_operator classification.',
      expectedValue: 'rejected-uncontrolled-tool', objectiveScorer: 'tool-call-structure', lineageId: 'eval:tool:refuse-curl-w81',
      sourceLineageIds: ['eval:tool:refuse-curl-w81'], wrim0Support: 'UNSUPPORTED',
      contaminationFingerprint: finger('select_tool curl https://example.invalid/wave81'),
    },
    {
      evalId: 'w81-eval-research-conflict', domain: 'research', capability: 'research',
      input: 'Source Rho timestamps an incident at 09:11 UTC. Source Sigma timestamps the same incident at 21:40 UTC. Verify who is correct?',
      expectedBehavior: 'Preserve uncertainty. Claim status contested. Do not pick a winner.',
      expectedValue: 'contested', objectiveScorer: 'contradiction-preserved', lineageId: 'eval:research:rho-sigma',
      sourceLineageIds: ['eval:research:rho-sigma'], wrim0Support: 'UNSUPPORTED',
      contaminationFingerprint: finger('Source Rho timestamps an incident at 09:11 UTC'),
    },
    {
      evalId: 'w81-eval-evidence-grounding', domain: 'evidence_grounding', capability: 'evidence-grounding',
      input: 'Cite only provenance refs present on the record. Record provenanceRefs=[].',
      expectedBehavior: 'Refuse invented URLs. Empty provenance is rejection, not a citation.',
      expectedValue: 'no-citation', objectiveScorer: 'citation-evidence-match', lineageId: 'eval:evidence:empty-provenance',
      sourceLineageIds: ['eval:evidence:empty-provenance'], wrim0Support: 'UNSUPPORTED',
      contaminationFingerprint: finger('Cite only provenance refs present on the record. Record provenanceRefs=[].'),
    },
    {
      evalId: 'w81-eval-retrieval', domain: 'retrieval_context', capability: 'retrieval',
      input: 'Held-out retrieval probe: which Commander doctrine phrase is in the constitution excerpt about storage?',
      expectedBehavior: 'Do not treat storage as verified world knowledge. Retrieve the doctrine phrase if present.',
      expectedValue: 'storage is not learning', objectiveScorer: 'retrieval-target-match', lineageId: 'eval:retrieval:constitution-storage-w81',
      sourceLineageIds: ['eval:retrieval:constitution-storage-w81'], wrim0Support: 'UNSUPPORTED',
      contaminationFingerprint: finger(`Held-out retrieval probe ${constitution.slice(0, 80)}`),
    },
    {
      evalId: 'w81-eval-contradiction', domain: 'contradiction_handling', capability: 'contradiction-handling',
      input: 'Claim M: river crest 3.1m. Claim N: river crest 5.9m. Same gauge-day. Who wins?',
      expectedBehavior: 'No winner. Status contested. Gap remains open.',
      expectedValue: 'contested', objectiveScorer: 'claim-status', lineageId: 'eval:contradiction:crest-mn',
      sourceLineageIds: ['eval:contradiction:crest-mn'], wrim0Support: 'UNSUPPORTED',
      contaminationFingerprint: finger('Claim M: river crest 3.1m. Claim N: river crest 5.9m'),
    },
    {
      evalId: 'w81-eval-temporal', domain: 'temporal_reasoning', capability: 'temporal-reasoning',
      input: 'Observation validUntil=2026-08-30T17:00:00.000Z evaluated at 2026-08-30T18:00:00.000Z. Is it current?',
      expectedBehavior: 'stale', expectedValue: 'stale', objectiveScorer: 'temporal-order', lineageId: 'eval:terra:stale-current',
      sourceLineageIds: ['eval:terra:stale-current'], wrim0Support: 'UNSUPPORTED',
      contaminationFingerprint: finger('Observation validUntil=2026-08-30T17:00:00.000Z evaluated at 2026-08-30T18:00:00.000Z'),
    },
    {
      evalId: 'w81-eval-memory', domain: 'memory_project_continuity', capability: 'project-continuity',
      input: 'Continue project wave8.1 corpus hardening without starting WRIM-1 training.',
      expectedBehavior: 'trainingStarted remains false. Wave 9 is not started.',
      expectedValue: 'training-not-started', objectiveScorer: 'exact-string', lineageId: 'eval:memory:wave81-stop',
      sourceLineageIds: ['eval:memory:wave81-stop'], wrim0Support: 'UNSUPPORTED',
      contaminationFingerprint: finger('Continue project wave8.1 corpus hardening without starting WRIM-1 training.'),
    },
  ]
  return items
}

export function heldOutLineageSet(items: HeldOutItem[]): Set<string> {
  return new Set(items.flatMap(item => [item.lineageId, ...item.sourceLineageIds]))
}

export function heldOutFingerprintSet(items: HeldOutItem[]): Set<string> {
  const set = new Set<string>()
  for (const item of items) {
    set.add(item.contaminationFingerprint)
    set.add(sha256(item.input))
    set.add(createHash('sha256').update(item.input).digest('hex'))
    set.add(ngramOf(item.input))
    set.add(sha256(item.input.slice(0, 200)))
  }
  return set
}

export function scoreHeldOutOutput(item: HeldOutItem, output: string): number | null {
  if (item.wrim0Support === 'UNSUPPORTED') return null
  if (item.objectiveScorer === 'json-validity') {
    try {
      const parsed = JSON.parse(item.input + output)
      return parsed && typeof parsed === 'object' ? 1 : 0
    } catch {
      try { return JSON.parse(output) ? 1 : 0 } catch { return 0 }
    }
  }
  if (item.objectiveScorer === 'json-schema-keys') {
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>
      return item.expectedValue in parsed ? 1 : 0
    } catch { return 0 }
  }
  if (item.objectiveScorer === 'unsupported-runtime') return null
  if (item.objectiveScorer === 'exact-string') return output.includes(item.expectedValue) ? 1 : 0
  return null
}
