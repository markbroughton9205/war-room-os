/**
 * Regression coverage for the loadSelfRepairSnapshot <-> normalizeSelfRepairGapIds circular
 * recursion (RangeError: Maximum call stack size exceeded). The bug: loadSelfRepairSnapshot
 * unconditionally called normalizeSelfRepairGapIds before reading storage, and
 * normalizeSelfRepairGapIds called loadSelfRepairSnapshot to get data to normalize -- every
 * single call to either function recursed forever, regardless of stored data.
 *
 * Fix: normalizeSelfRepairGapIds is now a pure function (snapshot in, {snapshot, changed} out,
 * no storage access). loadSelfRepairSnapshot is the only place that reads raw storage, calls the
 * pure normalizer, and persists the result if it changed.
 */
import { normalizeSelfRepairGapIds } from '../canonicalIssues'
import { loadSelfRepairSnapshot } from './storage'
import { SELF_REPAIR_STORAGE_KEY, type RepairPlan, type SelfRepairRecord, type SelfRepairSnapshot } from './types'
import { pathToFileURL } from 'node:url'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

// Minimal in-memory browser-storage shim so this file can exercise the real isBrowser()-gated
// code path under plain `node`, without a DOM. Installed once at module load.
type FakeSessionStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
  clear: () => void
  raw: Map<string, string>
}

function installFakeBrowserStorage(): FakeSessionStorage {
  const raw = new Map<string, string>()
  const fake: FakeSessionStorage = {
    getItem: key => (raw.has(key) ? raw.get(key)! : null),
    setItem: (key, value) => {
      raw.set(key, value)
    },
    removeItem: key => {
      raw.delete(key)
    },
    clear: () => raw.clear(),
    raw,
  }
  ;(globalThis as unknown as { window: unknown }).window = (globalThis as unknown as { window?: unknown }).window ?? {}
  ;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = fake
  return fake
}

const fakeStorage = installFakeBrowserStorage()

const BASE_PLAN: RepairPlan = {
  id: 'plan-1',
  sourceId: 'gap-1',
  sourceType: 'gap',
  title: 'Test repair',
  files: [],
  expectedBehavior: 'n/a',
  validationCommands: [],
  rollback: 'n/a',
  risk: 'low',
  cursorCommand: 'echo test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function makeRecord(
  overrides: Partial<Omit<SelfRepairRecord, 'plan'>> & { id: string; gapId: string; plan?: Partial<RepairPlan> },
): SelfRepairRecord {
  return {
    id: overrides.id,
    gapId: overrides.gapId,
    state: overrides.state ?? 'DETECTED',
    history: overrides.history ?? [{ state: overrides.state ?? 'DETECTED', at: BASE_PLAN.createdAt }],
    plan: { ...BASE_PLAN, sourceId: overrides.gapId, ...overrides.plan },
    ...(overrides.validation ? { validation: overrides.validation } : {}),
    ...(overrides.lessonCandidateId ? { lessonCandidateId: overrides.lessonCandidateId } : {}),
  }
}

function seedStorage(snapshot: SelfRepairSnapshot): void {
  fakeStorage.setItem(SELF_REPAIR_STORAGE_KEY, JSON.stringify(snapshot))
}

// --- Case 1: loadSelfRepairSnapshot completes without recursion (empty storage) -------------
fakeStorage.clear()
let case01Result: SelfRepairSnapshot | Error
try {
  case01Result = loadSelfRepairSnapshot()
} catch (err) {
  case01Result = err instanceof Error ? err : new Error(String(err))
}

// --- Case 2: normalizeSelfRepairGapIds runs independently, with no storage installed at all --
const originalWindow = (globalThis as unknown as { window?: unknown }).window
const originalSessionStorage = (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage
delete (globalThis as unknown as { window?: unknown }).window
delete (globalThis as unknown as { sessionStorage?: unknown }).sessionStorage
let case02Result: SelfRepairNormResult | Error
type SelfRepairNormResult = ReturnType<typeof normalizeSelfRepairGapIds>
try {
  case02Result = normalizeSelfRepairGapIds({
    version: 1,
    records: [makeRecord({ id: 'r1', gapId: 'operator-inbox-archive-recall' })],
  })
} catch (err) {
  case02Result = err instanceof Error ? err : new Error(String(err))
}
;(globalThis as unknown as { window: unknown }).window = originalWindow
;(globalThis as unknown as { sessionStorage: unknown }).sessionStorage = originalSessionStorage

// --- Case 3: legacy snapshot preserves valid progress (state, history) on canonicalization ---
fakeStorage.clear()
seedStorage({
  version: 1,
  records: [
    makeRecord({
      id: 'self-repair-legacy',
      gapId: 'operator-inbox-archive-recall', // legacy -> canonicalizes to archive-recall-not-wired
      state: 'APPROVED',
      history: [
        { state: 'DETECTED', at: '2026-01-01T00:00:00.000Z' },
        { state: 'PROPOSED', at: '2026-01-02T00:00:00.000Z' },
        { state: 'APPROVED', at: '2026-01-03T00:00:00.000Z' },
      ],
    }),
  ],
})
const case03 = loadSelfRepairSnapshot()

// --- Case 4: duplicated legacy + canonical IDs reconcile into one issue ----------------------
fakeStorage.clear()
seedStorage({
  version: 1,
  records: [
    makeRecord({
      id: 'self-repair-legacy',
      gapId: 'operator-inbox-archive-recall',
      state: 'DETECTED',
      plan: { updatedAt: '2026-01-01T00:00:00.000Z' },
    }),
    makeRecord({
      id: 'self-repair-canonical',
      gapId: 'archive-recall-not-wired',
      state: 'VALIDATED',
      plan: { updatedAt: '2026-02-01T00:00:00.000Z' },
    }),
  ],
})
const case04 = loadSelfRepairSnapshot()

// --- Case 5: malformed storage fails safely without crashing ---------------------------------
fakeStorage.clear()
fakeStorage.setItem(SELF_REPAIR_STORAGE_KEY, '{not valid json')
let case05Result: SelfRepairSnapshot | Error
try {
  case05Result = loadSelfRepairSnapshot()
} catch (err) {
  case05Result = err instanceof Error ? err : new Error(String(err))
}

// --- Case 6: repeated loads are stable and normalizeSelfRepairGapIds never mutates its input --
fakeStorage.clear()
seedStorage({
  version: 1,
  records: [makeRecord({ id: 'self-repair-canonical', gapId: 'archive-recall-not-wired', state: 'PROPOSED' })],
})
const case06First = loadSelfRepairSnapshot()
const case06Second = loadSelfRepairSnapshot()

const pureInput: SelfRepairSnapshot = {
  version: 1,
  records: [makeRecord({ id: 'r1', gapId: 'archive-recall-not-wired' })], // already canonical
}
const pureInputSnapshotBefore = JSON.stringify(pureInput)
const pureResult = normalizeSelfRepairGapIds(pureInput)
const pureInputSnapshotAfter = JSON.stringify(pureInput)

// --- Case 7: unknown gap IDs pass through unchanged, empty snapshot stays empty --------------
fakeStorage.clear()
seedStorage({ version: 1, records: [makeRecord({ id: 'r1', gapId: 'totally-unknown-gap-id' })] })
const case07Unknown = loadSelfRepairSnapshot()
fakeStorage.clear()
const case07Empty = loadSelfRepairSnapshot()

export function runSelfRepairStorageValidation(): CaseResult[] {
  return [
    check(
      'self_repair_storage_01_load_completes_without_recursion',
      !(case01Result instanceof Error) && (case01Result as SelfRepairSnapshot).version === 1,
      case01Result instanceof Error ? case01Result.message : JSON.stringify(case01Result),
    ),
    check(
      'self_repair_storage_02_normalizer_runs_independently_of_storage',
      !(case02Result instanceof Error) && (case02Result as SelfRepairNormResult).snapshot.records[0]?.gapId === 'archive-recall-not-wired',
      case02Result instanceof Error ? case02Result.message : JSON.stringify(case02Result),
    ),
    check(
      'self_repair_storage_02b_normalizer_signature_is_pure_one_arg',
      normalizeSelfRepairGapIds.length === 1,
      `arity=${normalizeSelfRepairGapIds.length}`,
    ),
    check(
      'self_repair_storage_03_legacy_snapshot_preserves_progress',
      case03.records.length === 1
        && case03.records[0]?.gapId === 'archive-recall-not-wired'
        && case03.records[0]?.state === 'APPROVED'
        && case03.records[0]?.history.length === 3,
      JSON.stringify(case03.records[0]),
    ),
    check(
      'self_repair_storage_04_duplicate_legacy_and_canonical_reconcile_to_one',
      case04.records.length === 1
        && case04.records[0]?.id === 'self-repair-canonical'
        && case04.records[0]?.gapId === 'archive-recall-not-wired'
        && case04.records[0]?.state === 'VALIDATED',
      JSON.stringify(case04.records),
    ),
    check(
      'self_repair_storage_05_malformed_storage_fails_safely',
      !(case05Result instanceof Error) && (case05Result as SelfRepairSnapshot).records.length === 0,
      case05Result instanceof Error ? case05Result.message : JSON.stringify(case05Result),
    ),
    check(
      'self_repair_storage_06_repeated_loads_are_stable',
      JSON.stringify(case06First) === JSON.stringify(case06Second),
      `${JSON.stringify(case06First)} vs ${JSON.stringify(case06Second)}`,
    ),
    check(
      'self_repair_storage_06b_pure_normalizer_never_mutates_input',
      pureInputSnapshotBefore === pureInputSnapshotAfter && pureResult.changed === false,
      `mutated=${pureInputSnapshotBefore !== pureInputSnapshotAfter} changed=${pureResult.changed}`,
    ),
    check(
      'self_repair_storage_07_unknown_gap_id_passes_through',
      case07Unknown.records.length === 1 && case07Unknown.records[0]?.gapId === 'totally-unknown-gap-id',
      JSON.stringify(case07Unknown.records),
    ),
    check(
      'self_repair_storage_07b_empty_snapshot_stays_empty',
      case07Empty.records.length === 0 && case07Empty.version === 1,
      JSON.stringify(case07Empty),
    ),
  ]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = runSelfRepairStorageValidation()
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.name} ${result.detail}`)
  }
  const failed = results.filter(result => !result.pass)
  console.log(`Self-repair storage recursion validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
