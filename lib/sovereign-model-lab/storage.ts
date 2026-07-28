/**
 * Leaf storage for the Sovereign Model Lab. File-based JSON under .war-room/sovereign-model-lab/,
 * mirroring the pattern already proven in lib/native-builder/storage.ts and
 * lib/repo/checkpoint-store.ts. This module never imports runtime.ts and never calls back into
 * the orchestrator — same direction discipline as the self-repair recursion fix.
 */
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type {
  DatasetManifest,
  EvaluationResult,
  HardwareCapabilityReport,
  ModelManifest,
  SovereignDatasetSource,
  SovereignDocumentRecord,
  SovereignModelLabProgram,
  TokenizerExperiment,
  TokenizerJobStatus,
  TrainingCheckpoint,
  TrainingExperiment,
} from './types'

const PRODUCTION_ROOT_REL = path.join('.war-room', 'sovereign-model-lab')
const VALIDATION_ROOT_REL = path.join('.war-room', 'validation', 'sovereign-model-lab')

export class InvalidValidationStorageRootError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidValidationStorageRootError'
  }
}

let validationRootOverride: string | null = null

/**
 * The single resolution point for the Sovereign Model Lab on-disk storage root. Every function in
 * this module — and every other Sovereign Model Lab module that needs a path under this
 * subsystem's own persisted state (provenanceLedger.ts, tokenizerEnvironment.ts,
 * tokenizerVerifier.ts, runtime.ts's tokenizer plan output dir) — calls this function rather than
 * constructing '.war-room/sovereign-model-lab' independently. Production/default behavior is
 * unchanged unless a validation override is explicitly set (see
 * setSovereignModelLabValidationStorageRoot below), and even then only for the lifetime of the
 * current process — nothing here is persisted across processes.
 */
export function resolveSovereignModelLabStorageRoot(): string {
  if (validationRootOverride !== null) return validationRootOverride
  return path.join(resolveRepoRoot(), PRODUCTION_ROOT_REL)
}

/** Always resolves to the production/default root regardless of any active validation override —
 * exists so validation code can prove properties about the production root (e.g. that a fixture
 * planted there survives an isolated run) without itself constructing the path independently. */
export function sovereignModelLabProductionStorageRootForTesting(): string {
  return path.join(resolveRepoRoot(), PRODUCTION_ROOT_REL)
}

/**
 * Validation-only override. Constrains the requested root to the repository-owned
 * `.war-room/validation/sovereign-model-lab/` area — rejects path traversal and any path (relative
 * or absolute) that resolves outside that area, before ever assigning the override. Never capable
 * of pointing at the production default root or anywhere else on the filesystem. Intended caller: a
 * validation suite's entry point, before any Model Lab storage access happens.
 */
export function setSovereignModelLabValidationStorageRoot(requestedRoot: string): string {
  const validationBase = path.resolve(resolveRepoRoot(), VALIDATION_ROOT_REL)
  const trimmed = requestedRoot.trim()
  if (!trimmed) {
    throw new InvalidValidationStorageRootError('Empty validation storage root requested.')
  }
  const candidate = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(validationBase, trimmed)
  const rel = path.relative(validationBase, candidate)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new InvalidValidationStorageRootError(
      `Requested validation storage root ${JSON.stringify(requestedRoot)} resolves outside the permitted validation area (${validationBase}).`,
    )
  }
  validationRootOverride = candidate
  return candidate
}

/** Restores production/default storage-root resolution. Always call this when a validation run
 * finishes, success or failure (e.g. in a finally block). */
export function clearSovereignModelLabValidationStorageRoot(): void {
  validationRootOverride = null
}

function dirFor(collection: string): string {
  return path.join(resolveSovereignModelLabStorageRoot(), collection)
}

/** Root directory for a corpus's immutable versioned artifact bundles — the actual multi-file
 * write logic (corpus.jsonl/manifest.json/exclusions.json/quality-report.json/checksums.json)
 * lives in corpusBuilder.ts, which needs this path plus a per-version subdirectory it fully owns. */
export function corpusRootDir(corpusId: string): string {
  return path.join(dirFor('corpora'), corpusId)
}
export function corpusVersionDir(corpusId: string, version: string): string {
  return path.join(corpusRootDir(corpusId), version)
}
export async function corpusVersionExists(corpusId: string, version: string): Promise<boolean> {
  try {
    await access(corpusVersionDir(corpusId, version))
    return true
  } catch {
    return false
  }
}
export async function listCorpusVersions(corpusId: string): Promise<string[]> {
  try {
    return (await readdir(corpusRootDir(corpusId))).sort()
  } catch {
    return []
  }
}

/** Atomic-ish write: write to a temp file in the same directory, then rename over the target —
 * avoids a reader ever observing a half-written JSON file. */
async function atomicWriteJson(dir: string, fileName: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true })
  const target = path.join(dir, fileName)
  const tmp = path.join(dir, `.${fileName}.${randomUUID()}.tmp`)
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmp, target)
}

async function readAllJson<T>(dir: string, isValid: (v: unknown) => v is T): Promise<T[]> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter(n => n.endsWith('.json'))
  } catch {
    return []
  }
  const out: T[] = []
  for (const name of names) {
    try {
      const raw = await readFile(path.join(dir, name), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (isValid(parsed)) out.push(parsed)
    } catch {
      /* skip corrupt/partial record */
    }
  }
  return out
}

function hasStringId(v: unknown, key: string): v is Record<string, unknown> {
  return Boolean(v && typeof v === 'object' && typeof (v as Record<string, unknown>)[key] === 'string')
}

// --- Hardware reports ---------------------------------------------------------------------------

export async function saveHardwareReport(id: string, report: HardwareCapabilityReport): Promise<void> {
  await atomicWriteJson(dirFor('hardware'), `${id}.json`, report)
}
export async function getHardwareReport(id: string): Promise<HardwareCapabilityReport | null> {
  try {
    const raw = await readFile(path.join(dirFor('hardware'), `${id}.json`), 'utf8')
    return JSON.parse(raw) as HardwareCapabilityReport
  } catch {
    return null
  }
}

// --- Sources -------------------------------------------------------------------------------------

export async function saveSource(source: SovereignDatasetSource): Promise<void> {
  await atomicWriteJson(dirFor('sources'), `${source.id}.json`, source)
}
export async function listSources(): Promise<SovereignDatasetSource[]> {
  return readAllJson(dirFor('sources'), (v): v is SovereignDatasetSource => hasStringId(v, 'id'))
}
export async function getSource(id: string): Promise<SovereignDatasetSource | null> {
  const all = await listSources()
  return all.find(s => s.id === id) ?? null
}

// --- Documents -----------------------------------------------------------------------------------

export async function saveDocument(doc: SovereignDocumentRecord): Promise<void> {
  await atomicWriteJson(dirFor('documents'), `${doc.id}.json`, doc)
}
export async function listDocuments(): Promise<SovereignDocumentRecord[]> {
  return readAllJson(dirFor('documents'), (v): v is SovereignDocumentRecord => hasStringId(v, 'id'))
}
export async function getDocument(id: string): Promise<SovereignDocumentRecord | null> {
  const all = await listDocuments()
  return all.find(d => d.id === id) ?? null
}
export async function findDocumentByHash(contentHash: string): Promise<SovereignDocumentRecord | null> {
  const all = await listDocuments()
  return all.find(d => d.contentHash === contentHash) ?? null
}

// --- Dataset manifests -----------------------------------------------------------------------------

export async function saveDatasetManifest(manifest: DatasetManifest): Promise<void> {
  await atomicWriteJson(dirFor('datasets'), `${manifest.manifestId}.json`, manifest)
}
export async function listDatasetManifests(): Promise<DatasetManifest[]> {
  return readAllJson(dirFor('datasets'), (v): v is DatasetManifest => hasStringId(v, 'manifestId'))
}
export async function getDatasetManifest(id: string): Promise<DatasetManifest | null> {
  const all = await listDatasetManifests()
  return all.find(m => m.manifestId === id) ?? null
}

// --- Tokenizer experiments -----------------------------------------------------------------------

export async function saveTokenizerExperiment(exp: TokenizerExperiment): Promise<void> {
  await atomicWriteJson(dirFor('tokenizers'), `${exp.experimentId}.json`, exp)
}
export async function listTokenizerExperiments(): Promise<TokenizerExperiment[]> {
  return readAllJson(dirFor('tokenizers'), (v): v is TokenizerExperiment => hasStringId(v, 'experimentId'))
}
export async function getTokenizerExperiment(id: string): Promise<TokenizerExperiment | null> {
  const all = await listTokenizerExperiments()
  return all.find(t => t.experimentId === id) ?? null
}

// --- Tokenizer jobs (bounded local subprocess runs) -----------------------------------------------

/** Path to the exclusive tokenizer-job lock file (Commander fix-packet Defect 2). Acquisition is
 * done by the caller (tokenizerRuntime.ts) via an OS-backed exclusive-create open — this module
 * only owns path resolution, matching the existing leaf-storage discipline. */
export function tokenizerJobLockPath(): string {
  return path.join(dirFor('tokenizer-jobs'), '.lock')
}

export async function saveTokenizerJobStatus(status: TokenizerJobStatus): Promise<void> {
  await atomicWriteJson(dirFor('tokenizer-jobs'), `${status.jobId}.json`, status)
}
export async function listTokenizerJobStatuses(): Promise<TokenizerJobStatus[]> {
  return readAllJson(dirFor('tokenizer-jobs'), (v): v is TokenizerJobStatus => hasStringId(v, 'jobId'))
}
export async function getTokenizerJobStatus(jobId: string): Promise<TokenizerJobStatus | null> {
  const all = await listTokenizerJobStatuses()
  return all.find(j => j.jobId === jobId) ?? null
}
/** At most one tokenizer job may be in flight across the whole lab at any time. */
export async function findRunningTokenizerJob(): Promise<TokenizerJobStatus | null> {
  const all = await listTokenizerJobStatuses()
  return all.find(j => j.status === 'running') ?? null
}

// --- Training experiments (plans only) -------------------------------------------------------------

export async function saveTrainingExperiment(exp: TrainingExperiment): Promise<void> {
  await atomicWriteJson(dirFor('training-plans'), `${exp.experimentId}.json`, exp)
}
export async function listTrainingExperiments(): Promise<TrainingExperiment[]> {
  return readAllJson(dirFor('training-plans'), (v): v is TrainingExperiment => hasStringId(v, 'experimentId'))
}
export async function getTrainingExperiment(id: string): Promise<TrainingExperiment | null> {
  const all = await listTrainingExperiments()
  return all.find(t => t.experimentId === id) ?? null
}

// --- Checkpoints (metadata only — Phase 1 never produces real ones) -------------------------------

export async function saveCheckpoint(cp: TrainingCheckpoint): Promise<void> {
  await atomicWriteJson(dirFor('checkpoints'), `${cp.checkpointId}.json`, cp)
}
export async function listCheckpoints(): Promise<TrainingCheckpoint[]> {
  return readAllJson(dirFor('checkpoints'), (v): v is TrainingCheckpoint => hasStringId(v, 'checkpointId'))
}

// --- Evaluation results ---------------------------------------------------------------------------

export async function saveEvaluationResult(result: EvaluationResult): Promise<void> {
  await atomicWriteJson(dirFor('evaluations'), `${result.resultId}.json`, result)
}
export async function listEvaluationResults(): Promise<EvaluationResult[]> {
  return readAllJson(dirFor('evaluations'), (v): v is EvaluationResult => hasStringId(v, 'resultId'))
}

// --- Model registry --------------------------------------------------------------------------------

export async function saveModelManifest(model: ModelManifest): Promise<void> {
  await atomicWriteJson(dirFor('models'), `${model.modelId}.json`, model)
}
export async function listModelManifests(): Promise<ModelManifest[]> {
  return readAllJson(dirFor('models'), (v): v is ModelManifest => hasStringId(v, 'modelId'))
}

// --- Programs (the Phase 1 state machine record) -----------------------------------------------

export async function saveProgram(program: SovereignModelLabProgram): Promise<void> {
  await atomicWriteJson(dirFor('programs'), `${program.programId}.json`, program)
}
export async function listPrograms(): Promise<SovereignModelLabProgram[]> {
  return readAllJson(dirFor('programs'), (v): v is SovereignModelLabProgram => hasStringId(v, 'programId'))
}
export async function getProgram(id: string): Promise<SovereignModelLabProgram | null> {
  const all = await listPrograms()
  return all.find(p => p.programId === id) ?? null
}
