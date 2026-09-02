import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'
import type { NativeRepairRecord } from '@/lib/native-builder/types'
import { containsHiddenCot, containsSecret, sha256 } from './engine'
import { captureContinuousEvidence } from '@/lib/continuous-evidence/capture'

const TERMINAL = new Set(['resolved', 'verification_failed', 'rolled_back', 'blocked', 'cancelled'])

/** Durable projection of the existing Native Builder lifecycle. It never executes a repair and
 * never changes its state; it only preserves observable evidence already produced by runtime.ts. */
export async function captureNativeBuilderEvidence(record: NativeRepairRecord, workspaceId: string | undefined): Promise<void> {
  if (!TERMINAL.has(record.state)) return
  const root = resolveBaseRepoRoot(); const dir = path.join(root, '.war-room', 'real-evidence', 'native-builder')
  await mkdir(dir, { recursive: true })
  const auditFile = path.join(root, '.war-room', 'audit', 'code-operator.jsonl')
  let auditEventId = ''
  try { auditEventId = (JSON.parse((await readFile(auditFile, 'utf8')).trim().split('\n').at(-1) ?? '{}') as { hash?: string }).hash ?? '' } catch { /* fail closed below */ }
  const validators = record.validationResults.map(result => ({ validatorType: result.operation.id, passed: result.ok && result.exitCode === 0, exitCode: result.exitCode, ranAt: result.ranAt, stdoutHash: sha256(result.stdout), stderrHash: sha256(result.stderr), durationMs: result.durationMs }))
  const observable = JSON.stringify({ validators, diffEvidence: record.diffEvidence })
  const projection = {
    missionId: `native-repair:${record.id}`, repairId: record.id, issueId: record.issueId,
    workspaceId: workspaceId ?? null, startedAt: record.createdAt, completedAt: record.updatedAt,
    terminalStatus: record.state === 'resolved' && record.verification?.status === 'resolved' ? 'completed_verified'
      : record.state === 'verification_failed' ? 'failed_verification' : record.state === 'cancelled' ? 'cancelled' : 'failed_execution',
    validators, diffEvidence: record.diffEvidence ?? null, auditEventIds: auditEventId ? [auditEventId] : [],
    secretScanPassed: !containsSecret(observable), hiddenCotScanPassed: !containsHiddenCot(observable),
    contentHash: sha256({ repairId: record.id, state: record.state, validators, diffEvidence: record.diffEvidence, auditEventId }),
  }
  await writeFile(path.join(dir, `${record.id}.json`), JSON.stringify(projection, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  const passed = projection.terminalStatus === 'completed_verified' && validators.length > 0 && validators.every(validator => validator.passed)
  await captureContinuousEvidence({
    source: 'code_operator', subjectRef: `native-repair:${record.id}`, outcome: passed ? 'pass' : 'fail',
    observedAt: record.updatedAt, validUntil: null,
    provenanceRefs: [...projection.auditEventIds.map(id => `audit:${id}`), `native-repair:${record.id}`, ...(record.diffEvidence ? [`diff:${sha256(record.diffEvidence)}`] : [])],
    sourceLineageIds: [`issue:${record.issueId}`, `repair:${record.id}`], capabilityTags: ['code_operator.objective_repair'],
    curriculumTags: passed ? ['verified_success'] : ['observed_failure'], validatorTypes: validators.map(item => item.validatorType),
    verifierId: validators.length ? 'native-builder-validation-runner' : null, evaluatorId: 'continuous-evidence-admission-v1',
    objectiveEvaluated: validators.length > 0, objectiveSatisfied: passed, objectiveVerified: passed, containsSecret: !projection.secretScanPassed, containsHiddenCot: !projection.hiddenCotScanPassed,
    metadata: { terminalStatus: projection.terminalStatus, workspaceId: workspaceId ?? null },
  })
}
