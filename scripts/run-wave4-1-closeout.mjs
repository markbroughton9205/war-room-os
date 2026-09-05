import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { classifyCodeOperatorLifecycles, materializeVerifiedCodeOperatorRepair, verifySegmentedAudit } from '../lib/evidence-remediation/engine.ts'
import { buildDatasetManifest, estimateM1TrainingPlan } from '../lib/training-checkpoint/engine.ts'

const root = process.cwd()
const auditPath = path.join(root, '.war-room/audit/code-operator.jsonl')
const events = (await readFile(auditPath, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)
const audit = verifySegmentedAudit(events)
const lifecycles = classifyCodeOperatorLifecycles(events)
const repairsDir = path.join(root, '.war-room/native-builder/repairs')
let repairs = []
try {
  repairs = await Promise.all((await readdir(repairsDir)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(path.join(repairsDir, name), 'utf8'))))
} catch { /* no durable repair payloads exist */ }
const byLifecycle = new Map(lifecycles.map(lifecycle => [lifecycle.repairId, lifecycle]))
const materialized = repairs.flatMap(repair => {
  const lifecycle = byLifecycle.get(repair.id)
  if (!lifecycle) return []
  const record = materializeVerifiedCodeOperatorRepair(repair, lifecycle, audit.originalLedgerHash)
  return record ? [record] : []
})
const dataset = buildDatasetManifest(materialized.map(record => record.datasetRecord), materialized.length ? ['wave3-code-operator-real-v1'] : [], new Date('2026-08-30T00:00:00.000Z'))
const classCounts = Object.fromEntries(['commander_resolved', 'verification_failed', 'awaiting_review', 'planning_blocked', 'patch_application_failed', 'no_terminal_outcome'].map(key => [key, lifecycles.filter(item => item.class === key).length]))
const m1Estimate = estimateM1TrainingPlan({ chip: 'Apple M1', unifiedMemoryBytes: 8 * 1024 ** 3, availableMemoryBytes: 0, freeDiskBytes: 0, parameterCount: 19_217_152, datasetTokens: 0, epochs: 3, sequenceLength: 512, effectiveBatchSize: 8 })
const result = {
  policyVersion: 'wave4.1-v1', generatedAt: new Date().toISOString(), audit, lifecyclePopulation: lifecycles.length, lifecycleClassCounts: classCounts,
  durableRepairPayloads: repairs.length, materializedEvidenceCount: materialized.length, eligibleRealRecords: dataset.records.length,
  datasetAdmitted: dataset.records.length > 0 && Object.values(dataset.splitCounts).every(count => count > 0),
  dataset, m1Estimate, trainingStarted: false, productionTouched: false,
}
const outputDir = path.join(root, 'model-lab/manifests/wave4_1')
await mkdir(outputDir, { recursive: true })
await writeFile(path.join(outputDir, 'evidence-remediation-closeout.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputDir, 'audit-segment-boundaries.json'), `${JSON.stringify({ originalLedgerHash: audit.originalLedgerHash, segmentManifestHash: audit.segmentManifestHash, boundaries: audit.boundaries }, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputDir, 'code-operator-lifecycle-classification.json'), `${JSON.stringify({ total: lifecycles.length, classCounts, lifecycles }, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ events: audit.eventCount, boundaries: audit.boundaries.length, corruptEvents: audit.corruptEvents, lifecycles: lifecycles.length, classCounts, materialized: materialized.length, eligible: dataset.records.length, datasetAdmitted: result.datasetAdmitted }, null, 2))
