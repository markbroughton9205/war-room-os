import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import { evaluateContinuousEvidence } from './engine'
import type { ContinuousEvidenceInput, ContinuousEvidenceRecord } from './types'

const ADMITTED_DIR = ['.war-room', 'continuous-evidence', 'admitted'] as const
const NATIVE_BUILDER_DIR = ['.war-room', 'real-evidence', 'native-builder'] as const

async function readJsonFiles(directory: string): Promise<unknown[]> {
  try {
    const names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort()
    return Promise.all(names.map(async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'))))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Load already-admitted canonical envelopes. This is the same store Native Builder writes; it is
 * not a third evidence system. Missing directories are an empty backlog, not a fabrication point. */
export async function loadCanonicalAdmittedRecords(): Promise<ContinuousEvidenceRecord[]> {
  const root = resolveBaseRepoRoot()
  const admitted = await readJsonFiles(path.join(root, ...ADMITTED_DIR))
  const records: ContinuousEvidenceRecord[] = []
  for (const row of admitted) {
    if (row && typeof row === 'object' && 'record' in row && (row as { record?: ContinuousEvidenceRecord }).record) {
      records.push((row as { record: ContinuousEvidenceRecord }).record)
    }
  }
  return records
}

/** Native Builder projections that were written before captureContinuousEvidence existed can be
 * evaluated into the same admission function. Empty directory → no records. */
export async function admitNativeBuilderProjections(now = new Date()): Promise<{ records: ContinuousEvidenceRecord[]; skipped: number }> {
  const root = resolveBaseRepoRoot()
  const projections = await readJsonFiles(path.join(root, ...NATIVE_BUILDER_DIR))
  const records: ContinuousEvidenceRecord[] = []
  let skipped = 0
  for (const row of projections) {
    if (!row || typeof row !== 'object') { skipped += 1; continue }
    const projection = row as {
      missionId?: string; repairId?: string; issueId?: string; completedAt?: string; startedAt?: string
      terminalStatus?: string; auditEventIds?: string[]; validators?: Array<{ validatorType: string; passed: boolean }>
      secretScanPassed?: boolean; hiddenCotScanPassed?: boolean; diffEvidence?: { diffHash?: string } | null
    }
    const input: ContinuousEvidenceInput = {
      source: 'code_operator',
      subjectRef: projection.missionId ?? `native-repair:${projection.repairId ?? 'unknown'}`,
      outcome: projection.terminalStatus === 'completed_verified' ? 'pass' : 'fail',
      observedAt: projection.completedAt ?? projection.startedAt ?? now.toISOString(),
      validUntil: null,
      provenanceRefs: [...(projection.auditEventIds ?? []).map(id => `audit:${id}`), projection.repairId ? `native-repair:${projection.repairId}` : ''].filter(Boolean),
      sourceLineageIds: [projection.issueId ? `issue:${projection.issueId}` : '', projection.repairId ? `repair:${projection.repairId}` : ''].filter(Boolean),
      capabilityTags: ['code_operator.objective_repair'],
      curriculumTags: projection.terminalStatus === 'completed_verified' ? ['verified_success'] : ['observed_failure'],
      validatorTypes: (projection.validators ?? []).map(item => item.validatorType),
      verifierId: (projection.validators ?? []).length ? 'native-builder-validation-runner' : null,
      evaluatorId: 'continuous-evidence-admission-v1',
      objectiveEvaluated: (projection.validators ?? []).length > 0,
      objectiveSatisfied: projection.terminalStatus === 'completed_verified' && (projection.validators ?? []).every(item => item.passed),
      objectiveVerified: projection.terminalStatus === 'completed_verified' && (projection.validators ?? []).every(item => item.passed),
      containsSecret: projection.secretScanPassed === false,
      containsHiddenCot: projection.hiddenCotScanPassed === false,
    }
    const evaluated = evaluateContinuousEvidence(input, now)
    if (evaluated.record) records.push(evaluated.record)
    else skipped += 1
  }
  return { records, skipped }
}
