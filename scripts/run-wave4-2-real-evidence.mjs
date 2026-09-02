import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { buildRealDatasetManifest, containsHiddenCot, containsSecret, materializeEngineeringMission, sha256 } from '../lib/real-evidence/engine.ts'
import { logWarRoomRepoAudit } from '../lib/war-room/repoAudit.ts'
import { estimateM1TrainingPlan } from '../lib/training-checkpoint/engine.ts'

const repo = process.cwd()
if (repo !== '/Users/markbroughton/Developer/war-room-os') throw new Error(`authoritative repo required, got ${repo}`)
const artifactsDir = join(repo, '.war-room', 'real-evidence', 'artifacts')
const manifestDir = join(repo, 'model-lab', 'manifests', 'wave4_2')
await mkdir(artifactsDir, { recursive: true }); await mkdir(manifestDir, { recursive: true })
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repo, encoding: 'utf8' }).trim()
const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
const auditPath = join(repo, '.war-room', 'audit', 'code-operator.jsonl')
const readAuditTail = async () => JSON.parse((await readFile(auditPath, 'utf8')).trim().split('\n').at(-1))

const tasks = [
  { key: 'real-evidence-eslint', objective: 'Verify the new real-evidence admission engine satisfies the repository ESLint rules.', capability: ['lint', 'tool-use-correctness'], curriculum: ['durable-evidence', 'code-quality'], command: ['pnpm', ['exec', 'eslint', 'lib/real-evidence/engine.ts', 'lib/real-evidence/types.ts']], validator: 'LINT_PASS' },
  { key: 'real-evidence-types', objective: 'Verify the Wave 4.2 evidence contracts and integrations typecheck across the real repository.', capability: ['typescript', 'schema-reasoning'], curriculum: ['durable-evidence', 'type-safety'], command: ['pnpm', ['exec', 'tsc', '--noEmit']], validator: 'TSC_PASS' },
  { key: 'real-evidence-diff', objective: 'Verify the Wave 4.2 working-tree patch contains no whitespace errors.', capability: ['repo-inspection', 'validator-construction'], curriculum: ['durable-evidence', 'patch-integrity'], command: ['git', ['diff', '--check']], validator: 'DIFF_CHECK_PASS' },
]

const materialized = []
for (const task of tasks) {
  const startedAt = new Date().toISOString(); const missionId = `w42mission_${sha256(`${task.key}:${baseCommit}`).slice(0, 24)}`
  await logWarRoomRepoAudit('wave4.2: real engineering mission started', { missionId, objective: task.objective, sourceTaskLineageId: task.key, baseCommit, branch })
  const startAudit = await readAuditTail()
  const start = Date.now(); const result = spawnSync(task.command[0], task.command[1], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const completedAt = new Date().toISOString(); const stdout = result.stdout ?? ''; const stderr = result.stderr ?? ''; const exitCode = result.status ?? 1
  const saveArtifact = async (kind, content) => { const hash = sha256(content); const path = join(artifactsDir, `${hash}.txt`); await writeFile(path, content, { encoding: 'utf8', mode: 0o600 }); return { artifactId: `w42art_${sha256(`${missionId}:${kind}:${hash}`).slice(0, 24)}`, missionId, kind, path: `.war-room/real-evidence/artifacts/${basename(path)}`, mediaType: 'text/plain', sizeBytes: Buffer.byteLength(content), contentHash: hash, createdAt: completedAt, secretScanPassed: !containsSecret(content), hiddenCotScanPassed: !containsHiddenCot(content) } }
  const stdoutArtifact = await saveArtifact('stdout', stdout); const stderrArtifact = await saveArtifact('stderr', stderr)
  const actionId = `w42action_${sha256({ missionId, command: task.command, startedAt }).slice(0, 24)}`
  const action = { actionId, missionId, actionType: task.key.endsWith('eslint') ? 'lint' : task.key.endsWith('types') ? 'typecheck' : 'git_diff_inspection', executor: 'codex-wave4.2-closeout', startedAt, completedAt, description: task.objective, command: [task.command[0], ...task.command[1]].join(' '), exitCode, stdoutArtifactRef: stdoutArtifact.artifactId, stderrArtifactRef: stderrArtifact.artifactId, inputArtifactRefs: [], outputArtifactRefs: [stdoutArtifact.artifactId, stderrArtifact.artifactId], contentHash: sha256({ task: task.key, exitCode, stdout: stdoutArtifact.contentHash, stderr: stderrArtifact.contentHash }), resultStatus: exitCode === 0 ? 'passed' : 'failed', validatorType: task.validator, metadata: { durationMs: Date.now() - start } }
  const validator = { validatorId: `w42validator_${sha256(action).slice(0, 24)}`, missionId, actionId, validatorType: exitCode === 0 ? task.validator : task.validator.replace('_PASS', '_FAIL'), passed: exitCode === 0, exitCode, artifactRefs: action.outputArtifactRefs, contentHash: sha256({ action: action.contentHash, exitCode }), observedAt: completedAt }
  await logWarRoomRepoAudit('wave4.2: real engineering mission terminal outcome', { missionId, terminalStatus: exitCode === 0 ? 'completed_verified' : 'failed_verification', validatorId: validator.validatorId, artifactHashes: [stdoutArtifact.contentHash, stderrArtifact.contentHash] })
  const terminalAudit = await readAuditTail()
  const mission = { missionId, projectId: null, conversationId: null, promptArtifactId: null, initiatedBy: 'commander', executor: 'codex-wave4.2-closeout', repoPath: repo, worktreePath: repo, branch, baseCommit, startedAt, completedAt, terminalStatus: exitCode === 0 ? 'completed_verified' : 'failed_verification', objective: task.objective, capabilityTags: task.capability, curriculumTags: task.curriculum, sourceTaskLineageId: `task:${task.key}`, patchLineageId: `patch:${task.key}:${baseCommit}`, actionIds: [actionId], validatorIds: [validator.validatorId], artifactIds: [stdoutArtifact.artifactId, stderrArtifact.artifactId], auditEventIds: [startAudit.hash, terminalAudit.hash], auditSegment: `linear:${startAudit.hash}:${terminalAudit.hash}`, metadata: { real: true, synthetic: false } }
  const bundle = { mission, actions: [action], validators: [validator], artifacts: [stdoutArtifact, stderrArtifact] }
  await writeFile(join(manifestDir, `${missionId}.json`), JSON.stringify(bundle, null, 2) + '\n')
  const admitted = materializeEngineeringMission({ ...bundle, auditValid: terminalAudit.previousHash === startAudit.hash })
  if (admitted) materialized.push(admitted)
}

const checkpoint = JSON.parse(await readFile(join(repo, 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.json'), 'utf8'))
const tokenizer = JSON.parse(await readFile(join(repo, 'model-lab/manifests/wrim0_tokenizer_v16384/training-manifest.json'), 'utf8'))
const tokenizerHash = sha256(await readFile(join(repo, 'model-lab/manifests/wrim0_tokenizer_v16384/tokenizer.json'), 'utf8'))
const dataset = buildRealDatasetManifest(materialized, { parentCheckpointHash: checkpoint.weightsSha256, tokenizerHash })
if (!dataset.leakageCheck.passed || !dataset.trainIds.length || !dataset.validationIds.length || !dataset.testIds.length) throw new Error('real dataset split/admission failed')
const heldOut = { manifestId: `w42heldout_${sha256({ validation: dataset.validationIds, test: dataset.testIds }).slice(0, 24)}`, datasetId: dataset.datasetId, validationIds: dataset.validationIds, testIds: dataset.testIds, excludedTrainingIds: dataset.trainIds, capabilities: materialized.filter(r => [...dataset.validationIds, ...dataset.testIds].includes(r.evidence.id)).map(r => ({ evidenceId: r.evidence.id, capabilityTags: r.mission.capabilityTags })), contentHash: sha256({ validation: dataset.validationIds, test: dataset.testIds }), trainingOverlap: [] }
const baseline = { parentCheckpoint: dataset.parentCheckpoint, parentCheckpointHash: dataset.parentCheckpointHash, observedAt: new Date().toISOString(), results: heldOut.capabilities.map(item => ({ evidenceId: item.evidenceId, status: 'unsupported_by_current_wrim0_tool_runtime', score: null, objective: true })), fabricatedScores: false }
const tokenCount = materialized.reduce((sum, row) => sum + row.datasetRecord.content.split(/\s+/).length, 0)
const memBytes = Number(execFileSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' }).trim())
const freeDiskKb = Number(execFileSync('df', ['-k', repo], { encoding: 'utf8' }).trim().split('\n').at(-1).trim().split(/\s+/)[3])
const estimate = estimateM1TrainingPlan({ chip: 'Apple M1', unifiedMemoryBytes: memBytes, availableMemoryBytes: Math.floor(memBytes * 0.55), freeDiskBytes: freeDiskKb * 1024, parameterCount: checkpoint.parameterCount, datasetTokens: tokenCount, epochs: 3, sequenceLength: 512, effectiveBatchSize: 8 })
const closeout = { policyVersion: 'wave4.2-real-v1', generatedAt: new Date().toISOString(), realMissionCount: tasks.length, eligibleRecordCount: materialized.length, rejectedRecordCount: tasks.length - materialized.length, rejectionReasons: [], dataset, heldOut, baseline, tokenizer: { id: dataset.tokenizerId, hash: tokenizerHash, vocabSize: tokenizer.vocabSizeProduced }, resourceEstimate: { ...estimate, batch: 8, sequenceLength: 512, swapPressure: estimate.locallyFeasible ? 'not_expected_under_estimate' : 'possible', safetyHeadroomBytes: Math.max(0, Math.floor(memBytes * 0.55) - estimate.peakMemoryBytes.high) }, wrim1Readiness: 'READY', commanderAuthorization: 'not_requested', trainingStarted: false }
await writeFile(join(manifestDir, 'training-dataset-manifest.json'), JSON.stringify(dataset, null, 2) + '\n')
await writeFile(join(manifestDir, 'held-out-eval-manifest.json'), JSON.stringify(heldOut, null, 2) + '\n')
await writeFile(join(manifestDir, 'wrim0-baseline.json'), JSON.stringify(baseline, null, 2) + '\n')
await writeFile(join(manifestDir, 'real-evidence-closeout.json'), JSON.stringify(closeout, null, 2) + '\n')
console.log(JSON.stringify({ realMissions: tasks.length, eligible: materialized.length, splitCounts: { train: dataset.trainIds.length, validation: dataset.validationIds.length, test: dataset.testIds.length }, datasetId: dataset.datasetId, datasetHash: dataset.datasetManifestHash, heldOutId: heldOut.manifestId, wrim1Readiness: closeout.wrim1Readiness, trainingStarted: false }, null, 2))
