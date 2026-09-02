import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { aggregateCapabilities, buildIncrementalDatasetManifest, evaluateContinuousEvidence, evidenceHash, prioritizeCurriculum } from '../lib/continuous-evidence/engine.ts'
import { admitNativeBuilderProjections, loadCanonicalAdmittedRecords } from '../lib/continuous-evidence/canonicalStore.ts'
import { containsHiddenCot, containsSecret, materializeEngineeringMission, sha256 } from '../lib/real-evidence/engine.ts'
import { estimateM1TrainingPlan } from '../lib/training-checkpoint/engine.ts'

const repo = process.cwd(); const outputDir = join(repo, 'model-lab', 'manifests', 'wave5'); await mkdir(outputDir, { recursive: true })
const wave42Dir = join(repo, 'model-lab', 'manifests', 'wave4_2')
const wave42 = JSON.parse(await readFile(join(wave42Dir, 'training-dataset-manifest.json'), 'utf8'))
const held42 = JSON.parse(await readFile(join(wave42Dir, 'held-out-eval-manifest.json'), 'utf8'))
const close42 = JSON.parse(await readFile(join(wave42Dir, 'real-evidence-closeout.json'), 'utf8'))
const manifestFileHashBefore = sha256(await readFile(join(wave42Dir, 'training-dataset-manifest.json'), 'utf8'))
const heldoutFileHashBefore = sha256(await readFile(join(wave42Dir, 'held-out-eval-manifest.json'), 'utf8'))
const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

const oldRecords = []
for (const name of (await readdir(wave42Dir)).filter(name => /^w42mission_.*\.json$/.test(name)).sort()) {
  const bundle = JSON.parse(await readFile(join(wave42Dir, name), 'utf8')); const item = materializeEngineeringMission({ ...bundle, auditValid: true }); if (!item) continue
  oldRecords.push({ evidence: item.evidence, source: 'code_operator', sourceLineageIds: item.datasetRecord.sourceLineageIds, capabilityTags: item.mission.capabilityTags, curriculumTags: item.mission.curriculumTags, validatorTypes: bundle.validators.map(validator => validator.validatorType), quality: { objectiveValidatorCount: bundle.validators.length, provenanceCount: item.evidence.provenanceRefs.length, distinctLineageCount: item.datasetRecord.sourceLineageIds.length, sourceDiversity: new Set(item.evidence.provenanceRefs.map(ref => ref.split(':', 1)[0])).size, temporalBoundedness: true, qualityScore: Math.min(1, .25 + bundle.validators.length * .1 + item.evidence.provenanceRefs.length * .05 + item.datasetRecord.sourceLineageIds.length * .1) }, contentHash: sha256(item.evidence), retryOfEvidenceId: null })
}
const oldById = Object.fromEntries(oldRecords.map(record => [record.evidence.id, record.sourceLineageIds]))
const prior = { datasetId: wave42.datasetId, manifestHash: wave42.datasetManifestHash, sourceEvidenceIds: wave42.sourceEvidenceIds, trainIds: wave42.trainIds, validationIds: wave42.validationIds, testIds: wave42.testIds, evidenceLineages: oldById }

const tasks = [
  { key: 'wave5-evidence-gates', objective: 'Validate continuous cross-path evidence admission, temporal truth, and lineage isolation.', capability: ['evidence-admission', 'temporal-reasoning', 'lineage-isolation'], curriculum: ['durable-evidence'], command: ['node', ['--loader','./scripts/ts-extension-loader.mjs','--experimental-transform-types','lib/continuous-evidence/engine.validation.ts']] },
  { key: 'wave1-4.2-regression', objective: 'Prove the full deterministic AGI Wave 1 through 4.2 baseline remains intact.', capability: ['regression-verification', 'tool-use-correctness'], curriculum: ['regression-prevention'], command: ['pnpm', ['run','validate:agi-wave4.2']] },
  { key: 'wave5-typescript', objective: 'Verify repository-wide TypeScript correctness after the Wave 5 expansion.', capability: ['typescript', 'cross-module-integration'], curriculum: ['type-safety'], command: ['pnpm', ['exec','tsc','--noEmit','--pretty','false']] },
  { key: 'wave5-eslint', objective: 'Verify Wave 5 evidence and bridge code satisfies repository lint rules.', capability: ['lint', 'code-quality'], curriculum: ['code-quality'], command: ['pnpm', ['exec','eslint','lib/continuous-evidence/*.ts','lib/real-evidence/nativeBuilderBridge.ts']] },
  { key: 'wave5-build', objective: 'Verify the complete production build compiles with the Wave 5 evidence capture integration.', capability: ['build-verification', 'cross-module-integration'], curriculum: ['release-integrity'], command: ['pnpm', ['run','build']] },
]
const additions = []; const rejected = []; const missionResults = []
const scanObservable = (value) => ({ secret: containsSecret(value), hiddenCot: containsHiddenCot(value) })
for (const task of tasks) {
  let existing = null
  try { existing = JSON.parse(await readFile(join(outputDir, `mission-${task.key}.json`), 'utf8')) } catch { existing = null }
  const falsePositiveRejection = Array.isArray(existing?.rejection?.reasons) && existing.rejection.reasons.includes('hidden_cot_detected')
  const reusable = existing && existing.exitCode === 0 && existing.evidenceId && !falsePositiveRejection
  let startedAt = existing?.startedAt ?? new Date().toISOString()
  let completedAt = existing?.completedAt ?? startedAt
  let exitCode = existing?.exitCode ?? 1
  let stdout = ''
  let stderr = ''
  let stdoutHash = existing?.stdoutHash ?? null
  let stderrHash = existing?.stderrHash ?? null
  if (!reusable) {
    startedAt = new Date().toISOString()
    const result = spawnSync(task.command[0], task.command[1], { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    completedAt = new Date().toISOString()
    stdout = result.stdout ?? ''
    stderr = result.stderr ?? ''
    exitCode = result.status ?? 1
    stdoutHash = sha256(stdout)
    stderrHash = sha256(stderr)
  }
  const observable = reusable ? `${task.objective}\n${stdoutHash}\n${stderrHash}` : `${stdout}\n${stderr}`
  const scans = scanObservable(observable)
  const input = { source: 'code_operator', subjectRef: `wave5-mission:${task.key}`, outcome: exitCode === 0 ? 'pass' : 'fail', observedAt: completedAt, validUntil: null, provenanceRefs: [`repo:${baseCommit}`, `command:${task.command[0]} ${task.command[1].join(' ')}`, `stdout-sha256:${stdoutHash}`, `stderr-sha256:${stderrHash}`], sourceLineageIds: [`task:wave5:${task.key}`, `implementation:wave5-continuous-evidence:${baseCommit}`], capabilityTags: task.capability, curriculumTags: task.curriculum, validatorTypes: [task.key], verifierId: `objective-process-exit:${task.key}`, evaluatorId: 'wave5-admission-evaluator', objectiveVerified: true, containsSecret: scans.secret, containsHiddenCot: scans.hiddenCot, metadata: { objective: task.objective, command: `${task.command[0]} ${task.command[1].join(' ')}`, exitCode, startedAt, completedAt, stdoutHash, stderrHash, reused: Boolean(reusable) } }
  const evaluated = evaluateContinuousEvidence(input, new Date(completedAt)); if (evaluated.record) additions.push(evaluated.record); else rejected.push(evaluated.rejection)
  const mission = { key: task.key, objective: task.objective, startedAt, completedAt, exitCode, stdoutHash, stderrHash, evidenceId: evaluated.record?.evidence.id ?? null, rejection: evaluated.rejection, reused: Boolean(reusable) }
  missionResults.push(mission); await writeFile(join(outputDir, `mission-${task.key}.json`), `${JSON.stringify(mission, null, 2)}\n`)
}
const canonical = await loadCanonicalAdmittedRecords()
const nativeProjections = await admitNativeBuilderProjections()
for (const record of [...canonical, ...nativeProjections.records]) {
  if (!additions.some(item => item.evidence.id === record.evidence.id) && !oldRecords.some(item => item.evidence.id === record.evidence.id)) additions.push(record)
}

const manifest = buildIncrementalDatasetManifest({ version: 'wave5-v1', prior, priorRecords: oldRecords, additions, rejected: rejected.filter(Boolean), lineage: { parentCheckpointHash: wave42.parentCheckpointHash, tokenizerHash: wave42.tokenizerHash }, now: new Date() })
if (!manifest.heldOutIsolationProof.passed) throw new Error(`held-out leakage: ${manifest.heldOutIsolationProof.collisions.join(',')}`)
const allRecords = [...oldRecords, ...additions.filter(record => manifest.sourceEvidenceIds.includes(record.evidence.id))]
const capabilities = aggregateCapabilities(allRecords, new Set([...manifest.validationIds, ...manifest.testIds]))
const signals = allRecords.filter(record => record.evidence.outcome === 'fail').flatMap(record => record.capabilityTags.map(capabilityKey => ({ id: `failure:${record.evidence.id}:${capabilityKey}`, kind: 'observed_failure', capabilityKey, severity: 8, observedAt: record.evidence.observedAt, sourceRef: record.evidence.id })))
for (const metric of capabilities.filter(metric => metric.confidence < .5)) signals.push({ id: `low:${metric.capabilityKey}`, kind: 'low_confidence', capabilityKey: metric.capabilityKey, severity: Math.ceil((1 - metric.confidence) * 10), observedAt: new Date().toISOString(), sourceRef: `capability:${metric.capabilityKey}` })
const curriculum = prioritizeCurriculum(capabilities, signals)
const heldOut = { manifestId: `w5heldout_${evidenceHash({ validation: manifest.validationIds, test: manifest.testIds, predecessor: held42.manifestId }).slice(0, 24)}`, datasetId: manifest.datasetId, predecessorManifestId: held42.manifestId, inheritedValidationIds: wave42.validationIds, inheritedTestIds: wave42.testIds, validationIds: manifest.validationIds, testIds: manifest.testIds, trainingIds: manifest.trainIds, lineageIsolationProof: manifest.heldOutIsolationProof, contentHash: evidenceHash({ validation: manifest.validationIds, test: manifest.testIds, lineageGroups: manifest.lineageGroups }) }
const baseline = { parentCheckpoint: 'WRIM-0:checkpoint-final', parentCheckpointHash: wave42.parentCheckpointHash, observedAt: new Date().toISOString(), results: [...heldOut.validationIds, ...heldOut.testIds].map(evidenceId => ({ evidenceId, status: 'unsupported_by_current_wrim0_tool_runtime', score: null, objective: true })), fabricatedScores: false }
const checkpoint = JSON.parse(await readFile(join(repo, 'model-lab/manifests/wrim0_checkpoints/checkpoint-final.json'), 'utf8')); const datasetTokens = allRecords.reduce((sum, record) => sum + JSON.stringify(record.evidence).split(/\s+/).length, 0); const memoryBytes = totalmem(); let freeDiskBytes = 0; try { freeDiskBytes = Number(execFileSync('df', ['-k', repo], { encoding: 'utf8' }).trim().split('\n').at(-1).trim().split(/\s+/)[3]) * 1024 } catch { freeDiskBytes = 0 }
const resourceEstimate = estimateM1TrainingPlan({ chip: 'Apple M1', unifiedMemoryBytes: memoryBytes, availableMemoryBytes: Math.floor(memoryBytes * .55), freeDiskBytes, parameterCount: checkpoint.parameterCount, datasetTokens, epochs: 3, sequenceLength: 512, effectiveBatchSize: 8 })
const immutableRoots = { manifestFileHashBefore, manifestFileHashAfter: sha256(await readFile(join(wave42Dir, 'training-dataset-manifest.json'), 'utf8')), heldoutFileHashBefore, heldoutFileHashAfter: sha256(await readFile(join(wave42Dir, 'held-out-eval-manifest.json'), 'utf8')) }
const readinessCriteria = { realDatasetExists: manifest.sourceEvidenceIds.length > 0, nonEmptyTrainingSplit: manifest.trainIds.length > 0, nonEmptyValidationSplit: manifest.validationIds.length > 0, nonEmptyTestSplit: manifest.testIds.length > 0, heldOutIsolation: manifest.heldOutIsolationProof.passed, immutablePredecessor: immutableRoots.manifestFileHashBefore === immutableRoots.manifestFileHashAfter && immutableRoots.heldoutFileHashBefore === immutableRoots.heldoutFileHashAfter, checkpointLineageValid: manifest.parentCheckpointHash === close42.dataset.parentCheckpointHash, tokenizerLineageValid: manifest.tokenizerHash === close42.tokenizer.hash, trainingNotStarted: manifest.trainingStarted === false }
const readiness = Object.values(readinessCriteria).every(Boolean) ? 'READY' : 'NOT READY'
const closeout = { policyVersion: 'wave5-real-v1', generatedAt: new Date().toISOString(), beforeEvidenceCount: wave42.sourceEvidenceIds.length, attemptedNewMissions: tasks.length, admittedNewEvidenceCount: manifest.addedEvidenceIds.length, rejectedNewEvidenceCount: manifest.rejectedEvidence.length, afterEvidenceCount: manifest.sourceEvidenceIds.length, missionResults, manifest, heldOut, baseline, capabilities, curriculum, resourceEstimate, immutableRoots, readinessCriteria, wrim1Readiness: readiness, commanderAuthorization: 'not_requested', promotionAuthorization: 'not_requested', trainingStarted: false }
await writeFile(join(outputDir, 'training-dataset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`); await writeFile(join(outputDir, 'held-out-eval-manifest.json'), `${JSON.stringify(heldOut, null, 2)}\n`); await writeFile(join(outputDir, 'wrim0-baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`); await writeFile(join(outputDir, 'capability-evidence.json'), `${JSON.stringify(capabilities, null, 2)}\n`); await writeFile(join(outputDir, 'curriculum-priorities.json'), `${JSON.stringify(curriculum, null, 2)}\n`); await writeFile(join(outputDir, 'wrim1-readiness.json'), `${JSON.stringify({ readiness, criteria: readinessCriteria, trainingStarted: false }, null, 2)}\n`); await writeFile(join(outputDir, 'wave5-closeout.json'), `${JSON.stringify(closeout, null, 2)}\n`)
console.log(JSON.stringify({ before: closeout.beforeEvidenceCount, admitted: closeout.admittedNewEvidenceCount, rejected: closeout.rejectedNewEvidenceCount, after: closeout.afterEvidenceCount, datasetId: manifest.datasetId, datasetHash: manifest.contentHash, readiness, trainingStarted: false }, null, 2))
