/**
 * PASS 014 mission-scoped WRITE SET.
 * READ/IMPACT_SCOPE may include dependents. WRITE_SCOPE does not, unless
 * explicitly expanded with evidence. Terra is a protected subsystem.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { foundryDataHierarchy } from './foundryPaths'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundryOwnershipMap } from './foundryCodeIntelligence'

function looksLikeTest(rel: string): boolean {
  return /\.(test|spec|validation|proof)\.(ts|tsx|js|mjs|cjs)$/.test(rel) || /\/tests?\//.test(rel) || /validation|proof/.test(rel)
}

function isFixtureNoise(rel: string, request: string): boolean {
  if (/scripts\/foundry\/(multi-file|engineering-depth|ops-write-conflict|model-)/.test(rel) && !/multi-file|engineering-depth|ops-write-conflict|fixture/i.test(request)) {
    return true
  }
  return false
}

function isUnrelatedSubsystemForMission(rel: string, request: string): boolean {
  if (isProtectedSubsystemPath(rel)) return true
  if (!/session/i.test(request) && /foundrySessions|sessions\/\[id\]|sessions\/route/.test(rel)) return true
  if (!/computer use|at-spi|hidpi|click_and_wait/i.test(request) && /foundryComputerUse|computer-use-backend/.test(rel)) return true
  if (!/desktop|electron|trusted desktop/i.test(request) && /desktop\/src\//.test(rel)) return true
  if (/operations|watchdog|advanced/i.test(request) && /FoundryHomeNav|FoundryShell|FoundryContextMenu/.test(rel) && !/homepage|home nav|shell chrome/i.test(request)) {
    return true
  }
  return false
}

function prefersMissionOwner(rel: string, request: string): boolean {
  if (/engineering review/i.test(request)) return false
  if (/operations|watchdog|advanced/i.test(request)) {
    return /FoundryOperationsPanel|LeaseWatchdog|operations\/route|ProductionOwnership|ProductionLease|foundryMissionWriteSet/.test(rel)
  }
  return false
}

export const REFUSED_OUTSIDE_WRITE_SET = 'REFUSED_OUTSIDE_WRITE_SET'
export const REFUSED_PROTECTED_SUBSYSTEM = 'REFUSED_PROTECTED_SUBSYSTEM'
export const REFUSED_WRITE_SET_EXPANSION = 'REFUSED_WRITE_SET_EXPANSION'
export const WRITE_SET_REQUIRED = 'WRITE_SET_REQUIRED'

export const MUTATING_BROKER_TOOLS = [
  'file.write',
  'file.patch',
  'file.replace_unique',
  'file.delete',
  'file.move',
] as const

export type MutatingBrokerTool = (typeof MUTATING_BROKER_TOOLS)[number]

export type FoundryWriteSetEntry = {
  path: string
  reason: string
  ownerEvidence: string
  addedAt: string
  sourceStep: string
  approvedByPolicy: boolean
  commanderAuthorized?: boolean
}

export type FoundryMissionWriteSet = {
  missionId: string
  established: boolean
  establishedAt: string | null
  paths: string[]
  entries: FoundryWriteSetEntry[]
  readScope: string[]
  protectedSubsystems: string[]
}

export type WriteSetVerdict = {
  ok: boolean
  code?: string
  error?: string
  path?: string
}

const TERRA_PATH = /(^|\/)(components\/war-room\/terra|lib\/terra|public\/terra)(\/|$)/i
const TERRA_FILE = /FoundryTerraBackground\.tsx$|cesium|gibs|imageryLifecycle|loadCesiumRuntime/i
const VENDOR_PATH = /(^|\/)(node_modules|\.next|dist|dist-release|coverage|vendor)(\/|$)/
const TRAVERSAL = /(?:^|\/)\.\.(?:\/|$)/

export function posixRel(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

export function isMutatingBrokerTool(tool: string): tool is MutatingBrokerTool {
  return (MUTATING_BROKER_TOOLS as readonly string[]).includes(tool)
}

export function isExplicitTerraMission(mission: Pick<FoundryMissionRecord, 'userRequest' | 'goal' | 'constraints'>): boolean {
  const blob = `${mission.userRequest}\n${mission.goal}\n${(mission.constraints ?? []).join('\n')}`
  if (/do not (touch|change|modify) terra/i.test(blob)) return false
  return /\bexplicit terra mission\b|\bterra mission:\b|\bscope:\s*terra\b/i.test(blob)
}

export function isProtectedSubsystemPath(rel: string): boolean {
  const normalized = posixRel(rel)
  if (TERRA_PATH.test(normalized) || TERRA_FILE.test(normalized)) return true
  if (/\/cesium\//i.test(normalized) && /terra|imagery|globe/i.test(normalized)) return true
  if (/(^|\/)(lib\/wrim-environment|wrim-environment)(\/|$)/i.test(normalized)) return true
  return false
}

export function emptyWriteSet(missionId: string): FoundryMissionWriteSet {
  return {
    missionId,
    established: false,
    establishedAt: null,
    paths: [],
    entries: [],
    readScope: [],
    protectedSubsystems: ['Terra', 'auth boundary', 'production ownership files unless mission-scoped'],
  }
}

export function missionWriteSet(mission: FoundryMissionRecord): FoundryMissionWriteSet {
  return mission.writeSet ?? emptyWriteSet(mission.missionId)
}

export function writeSetHas(mission: FoundryMissionRecord, rel: string): boolean {
  const normalized = posixRel(rel)
  return missionWriteSet(mission).paths.some(item => posixRel(item) === normalized)
}

export function classifyWriteRefusal(rel: string, mission?: FoundryMissionRecord | null): WriteSetVerdict {
  const normalized = posixRel(rel)
  if (!normalized || TRAVERSAL.test(normalized) || path.isAbsolute(rel)) {
    return { ok: false, code: REFUSED_OUTSIDE_WRITE_SET, error: `${REFUSED_OUTSIDE_WRITE_SET}: path traversal or absolute path refused.`, path: normalized }
  }
  if (VENDOR_PATH.test(normalized)) {
    return { ok: false, code: REFUSED_OUTSIDE_WRITE_SET, error: `${REFUSED_OUTSIDE_WRITE_SET}: vendor/generated path refused.`, path: normalized }
  }
  if (isProtectedSubsystemPath(normalized) && !(mission && isExplicitTerraMission(mission))) {
    return {
      ok: false,
      code: REFUSED_PROTECTED_SUBSYSTEM,
      error: `${REFUSED_PROTECTED_SUBSYSTEM}: ${normalized} is Terra/protected and this mission is not an explicit Terra mission.`,
      path: normalized,
    }
  }
  return { ok: true, path: normalized }
}

export function deriveWriteSetPaths(
  mission: FoundryMissionRecord,
  ownership?: FoundryOwnershipMap | null,
): { write: string[]; read: string[] } {
  const request = `${mission.userRequest}\n${mission.goal}`
  const owners = [
    ...(ownership?.owners ?? mission.engineering?.ownership?.owners ?? []),
    ...(mission.engineering?.impact?.owners ?? []),
    ...(mission.engineering?.impact?.targetFiles ?? []),
  ]
  const ownerTests = [
    ...(ownership?.tests ?? mission.engineering?.ownership?.tests ?? []),
    ...(mission.engineering?.selectedTests ?? []),
    ...(mission.engineering?.impact?.likelyTests ?? mission.engineering?.impact?.tests ?? []),
  ].filter(item => looksLikeTest(item))
  const declared = [...`${request}`.matchAll(/((?:scripts|components|lib|app)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g)]
    .map(match => match[1])
    .filter(item => !isProtectedSubsystemPath(item))
  const ranked = [...new Set([...owners, ...ownerTests, ...declared].map(posixRel).filter(Boolean))]
    .filter(item => classifyWriteRefusal(item, mission).ok)
    .filter(item => !isFixtureNoise(item, request))
    .filter(item => !isUnrelatedSubsystemForMission(item, request))
  const preferred = ranked.filter(item => prefersMissionOwner(item, request))
  const sources = ranked.filter(item => !looksLikeTest(item))
  const rankedTests = ranked.filter(item => looksLikeTest(item))
  const declaredOk = declared.filter(item => classifyWriteRefusal(item, mission).ok && !isProtectedSubsystemPath(item))
  const write = [...new Set([
    ...declaredOk,
    ...(preferred.length ? preferred : sources),
    ...rankedTests,
  ])]
    .filter(item => classifyWriteRefusal(item, mission).ok)
    .slice(0, 12)
  const read = [...new Set([
    ...write,
    ...(mission.engineering?.impact?.dependencies ?? []),
    ...(mission.engineering?.impact?.dependents ?? []),
    ...(mission.engineering?.impact?.reverseDependents ?? []),
    ...(ownership?.dependents ?? []),
  ].map(posixRel).filter(Boolean))].slice(0, 48)
  return { write, read }
}

export function establishMissionWriteSet(
  mission: FoundryMissionRecord,
  input: {
    paths?: string[]
    readScope?: string[]
    reason?: string
    ownerEvidence?: string
    sourceStep?: string
  } = {},
): FoundryMissionWriteSet {
  const derived = deriveWriteSetPaths(mission)
  const paths = [...new Set((input.paths?.length ? input.paths : derived.write).map(posixRel))]
    .filter(item => classifyWriteRefusal(item, mission).ok)
  if (!paths.length) {
    const empty = emptyWriteSet(mission.missionId)
    empty.readScope = [...new Set([...(input.readScope ?? derived.read)])]
    mission.writeSet = empty
    return empty
  }
  const now = new Date().toISOString()
  const entries: FoundryWriteSetEntry[] = paths.map(item => ({
    path: item,
    reason: input.reason ?? 'Derived from owners, impact WRITE_SCOPE, and declared tests before mutation.',
    ownerEvidence: input.ownerEvidence ?? (paths[0] ?? 'code.owners'),
    addedAt: now,
    sourceStep: input.sourceStep ?? 'BASELINE',
    approvedByPolicy: true,
  }))
  const writeSet: FoundryMissionWriteSet = {
    missionId: mission.missionId,
    established: true,
    establishedAt: now,
    paths,
    entries,
    readScope: [...new Set([...(input.readScope ?? derived.read), ...paths])],
    protectedSubsystems: ['Terra', 'auth boundary', 'production ownership files unless mission-scoped'],
  }
  mission.writeSet = writeSet
  return writeSet
}

export function requestWriteSetExpansion(
  mission: FoundryMissionRecord,
  input: {
    path: string
    reason?: string
    ownerEvidence?: string
    commanderAuthorized?: boolean
    sourceStep?: string
  },
): WriteSetVerdict {
  const normalized = posixRel(input.path)
  const protectedHit = classifyWriteRefusal(normalized, mission)
  if (!protectedHit.ok && protectedHit.code === REFUSED_PROTECTED_SUBSYSTEM) {
    if (!input.commanderAuthorized) {
      return {
        ok: false,
        code: REFUSED_PROTECTED_SUBSYSTEM,
        error: `${REFUSED_PROTECTED_SUBSYSTEM}: Terra expansion requires Commander authorization. PASS 014 does not authorize it.`,
        path: normalized,
      }
    }
    return {
      ok: false,
      code: REFUSED_PROTECTED_SUBSYSTEM,
      error: `${REFUSED_PROTECTED_SUBSYSTEM}: PASS 014 does not authorize Terra expansion even with Commander flag.`,
      path: normalized,
    }
  }
  if (!protectedHit.ok) return protectedHit
  if (!input.reason || !input.ownerEvidence) {
    return {
      ok: false,
      code: REFUSED_WRITE_SET_EXPANSION,
      error: `${REFUSED_WRITE_SET_EXPANSION}: expansion of ${normalized} requires reason and ownership/impact evidence.`,
      path: normalized,
    }
  }
  const writeSet = mission.writeSet ?? establishMissionWriteSet(mission)
  if (writeSetHas(mission, normalized)) return { ok: true, path: normalized }
  const entry: FoundryWriteSetEntry = {
    path: normalized,
    reason: input.reason,
    ownerEvidence: input.ownerEvidence,
    addedAt: new Date().toISOString(),
    sourceStep: input.sourceStep ?? 'REPLAN',
    approvedByPolicy: true,
    commanderAuthorized: input.commanderAuthorized === true,
  }
  writeSet.paths = [...new Set([...writeSet.paths, normalized])]
  writeSet.entries = [...writeSet.entries, entry]
  writeSet.readScope = [...new Set([...writeSet.readScope, normalized])]
  mission.writeSet = writeSet
  return { ok: true, path: normalized }
}

export function authorizeMissionWrite(mission: FoundryMissionRecord | null | undefined, rel: string): WriteSetVerdict {
  const classified = classifyWriteRefusal(rel, mission ?? undefined)
  if (!classified.ok) return classified
  const normalized = classified.path ?? posixRel(rel)
  if (mission && (mission.kind === 'app_builder' || mission.capabilityLane === 'APPLICATION_BUILDER')) {
    if (/^(lib|app|components|desktop|supabase|scripts|public)\//i.test(normalized) || isProtectedSubsystemPath(normalized)) {
      return {
        ok: false,
        code: REFUSED_PROTECTED_SUBSYSTEM,
        error: `${REFUSED_PROTECTED_SUBSYSTEM}: Application Builder cannot write War Room, Terra, WRIM, or other control-plane paths.`,
        path: normalized,
      }
    }
  }
  if (!mission) {
    return { ok: true, path: normalized }
  }
  const writeSet = mission.writeSet
  if (!writeSet?.established) {
    return { ok: true, path: normalized }
  }
  if (writeSetHas(mission, normalized)) return { ok: true, path: normalized }
  return {
    ok: false,
    code: REFUSED_OUTSIDE_WRITE_SET,
    error: `${REFUSED_OUTSIDE_WRITE_SET}: ${normalized} is outside ALLOWED_WRITE_SET.`,
    path: normalized,
  }
}

export function mutationPathsFromTool(tool: string, input: Record<string, unknown>): string[] {
  if (tool === 'file.move') {
    return [input.from, input.to].filter((item): item is string => typeof item === 'string' && item.length > 0)
  }
  if (typeof input.path === 'string' && input.path) return [input.path]
  const proposal = input.proposal as { plannedChanges?: Array<{ file?: string }> } | undefined
  if (Array.isArray(proposal?.plannedChanges)) {
    return proposal.plannedChanges.map(change => change.file).filter((item): item is string => typeof item === 'string')
  }
  return []
}

export function compactWriteScopePrompt(mission: FoundryMissionRecord): string {
  const writeSet = missionWriteSet(mission)
  const paths = writeSet.established ? writeSet.paths : (mission.engineering?.ownership?.owners ?? []).slice(0, 8)
  return [
    'WRITE_SCOPE:',
    ...(paths.length ? paths.map(item => `- ${item}`) : ['- (not established — call owners, impact, baseline first)']),
    'PROTECTED:',
    '- Terra',
    '- auth boundary',
    '- production ownership files unless mission-scoped',
    '- WRIM',
    '- other Foundry project roots',
    'Do not attempt mutation outside WRITE_SCOPE.',
    'If another file is required, request REPLAN with evidence. Impact dependents are READ_SCOPE only.',
    'If a write is REFUSED_PROTECTED_SUBSYSTEM or REFUSED_OUTSIDE_WRITE_SET, do not BLOCKED. Stay in WRITE_SCOPE or COMPLETE if the change is already present.',
  ].join('\n')
}

export async function persistMissionWriteSet(mission: FoundryMissionRecord): Promise<void> {
  if (!mission.writeSet) return
  const dir = path.join(foundryDataHierarchy().operations, 'write-sets')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${mission.missionId}.json`), JSON.stringify(mission.writeSet, null, 2), 'utf8')
}

export async function auditWriteSetRefusal(input: {
  missionId?: string | null
  tool: string
  path?: string
  code: string
  error: string
}): Promise<void> {
  await logWarRoomRepoAudit(`foundry-write-set: ${input.code}`, {
    missionId: input.missionId ?? null,
    tool: input.tool,
    path: input.path ?? null,
    code: input.code,
    error: input.error,
  })
}

export async function assertBrokerWriteAuthorized(
  mission: FoundryMissionRecord | null | undefined,
  tool: string,
  input: Record<string, unknown>,
): Promise<WriteSetVerdict> {
  if (!isMutatingBrokerTool(tool)) return { ok: true }
  if (mission && !mission.writeSet?.established) {
    const derived = deriveWriteSetPaths(mission)
    if (derived.write.length) {
      establishMissionWriteSet(mission, { paths: derived.write, readScope: derived.read, sourceStep: 'MUTATION_GATE' })
      await persistMissionWriteSet(mission)
    }
  }
  const paths = mutationPathsFromTool(tool, input)
  if (!paths.length) {
    const verdict: WriteSetVerdict = {
      ok: false,
      code: WRITE_SET_REQUIRED,
      error: `${WRITE_SET_REQUIRED}: mutating tool ${tool} did not name a path.`,
    }
    await auditWriteSetRefusal({
      missionId: mission?.missionId,
      tool,
      code: WRITE_SET_REQUIRED,
      error: verdict.error ?? WRITE_SET_REQUIRED,
    })
    return verdict
  }
  for (const rel of paths) {
    const verdict = authorizeMissionWrite(mission, rel)
    if (!verdict.ok) {
      await auditWriteSetRefusal({
        missionId: mission?.missionId,
        tool,
        path: verdict.path ?? posixRel(rel),
        code: verdict.code ?? REFUSED_OUTSIDE_WRITE_SET,
        error: verdict.error ?? REFUSED_OUTSIDE_WRITE_SET,
      })
      return verdict
    }
  }
  return { ok: true }
}
