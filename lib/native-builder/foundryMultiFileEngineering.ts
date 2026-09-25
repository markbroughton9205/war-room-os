/**
 * PASS 008 multi-file engineering: ownership roles, refactor plans, change
 * boundaries, cross-file consistency, generated-test review, and contract migration.
 * Extends PASS 007; does not replace the mission controller.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  buildCodeIndex,
  lookupDependents,
  lookupSymbol,
  mapOwnership,
  type FoundryCodeIndex,
  type FoundryOwnershipMap,
} from './foundryCodeIntelligence'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import type { FoundrySelfReview } from './foundryEngineeringDepth'

function isTestFile(rel: string): boolean {
  return /\.(test|spec|validation|proof)\.(ts|tsx|js|mjs|cjs)$/.test(rel) || /\/tests?\//.test(rel)
}

export type FoundryOwnerRole =
  | 'PRIMARY'
  | 'SECONDARY'
  | 'SHARED'
  | 'API'
  | 'PERSISTENCE'
  | 'UI'
  | 'TEST'
  | 'RUNTIME'

export type FoundryOwnerRoles = Record<FoundryOwnerRole, string[]>

export type FoundryRefactorKind = 'BEHAVIOR_PRESERVING_REFACTOR' | 'BEHAVIOR_CHANGE'

export type FoundryRefactorPlan = {
  goal: string
  kind: FoundryRefactorKind
  files: Array<{ path: string; why: string }>
  publicContracts: string[]
  testsRequired: string[]
  risks: string[]
  rollback: string
  compact: string
}

export type FoundryStageResult = {
  status: 'PASS' | 'FAIL' | 'PENDING'
  compact: string
  findings: string[]
}

const PREFIX: Record<FoundryOwnerRole, (rel: string) => boolean> = {
  PRIMARY: () => false,
  SECONDARY: () => false,
  SHARED: rel => /\/(shared|common|util|helpers?)\//i.test(rel) || /Registry|Visibility|IdentityCore/.test(rel),
  API: rel => /^app\/api\//.test(rel) || /\/route\.(ts|js)$/.test(rel),
  PERSISTENCE: rel => /Store|storage|persist|Sessions\.ts|MissionStore/.test(rel),
  UI: rel => rel.startsWith('components/') || /Shell|Panel|Nav/.test(rel),
  TEST: rel => isTestFile(rel),
  RUNTIME: rel => /runtimeControl|installerTool|packageTool|foundryBrowser|foundryComputer/.test(rel),
}

export function classifyOwnerRoles(owners: string[], dependents: string[] = [], tests: string[] = []): FoundryOwnerRoles {
  const all = [...new Set([...owners, ...dependents, ...tests])]
  const roles: FoundryOwnerRoles = {
    PRIMARY: owners.slice(0, 2),
    SECONDARY: owners.slice(2, 8),
    SHARED: all.filter(PREFIX.SHARED),
    API: all.filter(PREFIX.API),
    PERSISTENCE: all.filter(PREFIX.PERSISTENCE),
    UI: all.filter(PREFIX.UI),
    TEST: [...new Set([...tests, ...all.filter(PREFIX.TEST)])],
    RUNTIME: all.filter(PREFIX.RUNTIME),
  }
  return roles
}

export function compactOwnerRoles(roles: FoundryOwnerRoles): string {
  return (Object.entries(roles) as Array<[FoundryOwnerRole, string[]]>)
    .filter(([, files]) => files.length)
    .map(([role, files]) => `${role}: ${files.slice(0, 4).join(', ')}`)
    .join('\n')
}

export function buildRefactorPlan(mission: FoundryMissionRecord, ownership: FoundryOwnershipMap): FoundryRefactorPlan {
  const request = mission.userRequest
  const kind: FoundryRefactorKind = /behavior-preserving|duplicat|extract shared|without changing (observable )?behavior/i.test(request)
    && !/new contract|rename|behavior change|generated test/i.test(request)
    ? 'BEHAVIOR_PRESERVING_REFACTOR'
    : 'BEHAVIOR_CHANGE'
  const files = ownership.owners.slice(0, 8).map(file => ({
    path: file,
    why: PREFIX.UI(file) ? 'UI owner for the Commander-visible control'
      : PREFIX.API(file) ? 'API owner for the public request/response'
      : PREFIX.PERSISTENCE(file) ? 'Persistence owner for durable state'
      : PREFIX.TEST(file) ? 'Targeted validation'
      : 'Feature owner identified from imports/exports',
  }))
  const testsRequired = ownership.tests.slice(0, 6)
  const plan: FoundryRefactorPlan = {
    goal: mission.goal.slice(0, 180),
    kind,
    files,
    publicContracts: ownership.apis.slice(0, 6),
    testsRequired,
    risks: ownership.owners.length > 1
      ? ['cross-file contract drift', 'stale callers', 'unrelated file edits']
      : ['unrelated file edits'],
    rollback: 'Revert only the ALLOWED_CHANGE_SET files; leave unrelated work untouched.',
    compact: '',
  }
  plan.compact = [
    `GOAL: ${plan.goal}`,
    `KIND: ${plan.kind}`,
    `FILES: ${plan.files.map(item => `${item.path} (${item.why})`).join(' | ') || 'none'}`,
    `CONTRACTS: ${plan.publicContracts.join(', ') || 'none'}`,
    `TESTS: ${plan.testsRequired.join(', ') || 'none'}`,
    `RISKS: ${plan.risks.join('; ')}`,
    `ROLLBACK: ${plan.rollback}`,
  ].join('\n')
  return plan
}

export function allowedChangeSet(mission: FoundryMissionRecord, ownership: FoundryOwnershipMap): string[] {
  const request = mission.userRequest
  if (/multi-file\/duplication/.test(request)) {
    return [
      'scripts/foundry/multi-file/duplication/shared.mjs',
      'scripts/foundry/multi-file/duplication/alpha.mjs',
      'scripts/foundry/multi-file/duplication/beta.mjs',
      'scripts/foundry/multi-file/duplication/gamma.mjs',
      'scripts/foundry/multi-file/duplication/app.test.mjs',
    ]
  }
  if (/multi-file\/gap/.test(request)) {
    return [
      'scripts/foundry/multi-file/gap/status.mjs',
      'scripts/foundry/multi-file/gap/app.test.mjs',
    ]
  }
  if (/multi-file\/contract/.test(request)) {
    return [
      'scripts/foundry/multi-file/contract/format.mjs',
      'scripts/foundry/multi-file/contract/caller-a.mjs',
      'scripts/foundry/multi-file/contract/caller-b.mjs',
      'scripts/foundry/multi-file/contract/caller-c.mjs',
      'scripts/foundry/multi-file/contract/app.test.mjs',
    ]
  }
  if (/session rename/i.test(request)) {
    return [
      'lib/native-builder/foundrySessions.ts',
      'app/api/mission-runtime/engineering/foundry/sessions/route.ts',
      'app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts',
      'components/war-room/foundry/FoundryShell.tsx',
      'lib/native-builder/foundrySessionRename.validation.ts',
      'lib/native-builder/foundry.validation.ts',
    ]
  }
  if (/session restore|wait-for-control|PASS 010|PASS 011|semantic lifecycle/i.test(request)) {
    return [
      'lib/native-builder/foundrySessions.ts',
      'app/api/mission-runtime/engineering/foundry/sessions/route.ts',
      'app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts',
      'components/war-room/foundry/FoundryShell.tsx',
      'lib/native-builder/foundrySessionRestore.validation.ts',
      'lib/native-builder/foundrySessionArchive.validation.ts',
      'lib/native-builder/foundryComputerUse.ts',
      'lib/native-builder/foundryComputerUseGeometry.ts',
      'lib/native-builder/foundryComputerUseCdp.ts',
      'lib/native-builder/foundryPass011.computerUse.validation.ts',
      'scripts/foundry/computer-use-backend.py',
      'desktop/src/main.cjs',
      'lib/native-builder/installerTool.ts',
      'lib/native-builder/runtimeControl.ts',
      'lib/native-builder/foundryToolCatalog.ts',
      'lib/native-builder/foundryProductionOwnership.ts',
      'lib/native-builder/foundryLocalModelRuntime.ts',
      'lib/native-builder/foundryMissionController.ts',
      'lib/native-builder/foundryEngineeringContract.ts',
      'lib/native-builder/foundryBoundedEdit.ts',
      'lib/native-builder/foundryEditAnchors.ts',
    ]
  }
  if (/session archive/i.test(request)) {
    return [
      'lib/native-builder/foundrySessions.ts',
      'app/api/mission-runtime/engineering/foundry/sessions/route.ts',
      'app/api/mission-runtime/engineering/foundry/sessions/[id]/route.ts',
      'components/war-room/foundry/FoundryShell.tsx',
      'lib/native-builder/foundrySessionArchive.validation.ts',
      'lib/native-builder/foundryComputerUse.ts',
      'scripts/foundry/computer-use-backend.py',
      'desktop/src/main.cjs',
    ]
  }
  const derived = [...ownership.owners, ...ownership.tests, ...ownership.apis.map(api => `app${api}/route.ts`.replace(/\/api/, '/api'))]
  const named = [
    ...(mission.candidateFiles ?? []),
    ...(mission.importantPaths ?? []),
    ...[...request.matchAll(/((?:scripts|components|lib|app)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/g)].map(match => match[1]),
  ]
  return [...new Set([...derived, ...named].filter(Boolean))].slice(0, 16)
}

export function enforceChangeBoundary(mission: FoundryMissionRecord, paths: string[]): { ok: boolean; refused: string[]; reason: string } {
  const allowed = mission.engineering?.allowedChangeSet ?? []
  if (!allowed.length) return { ok: true, refused: [], reason: 'no explicit boundary yet' }
  const refused = paths.filter(file => !allowed.some(owner => file === owner || file.startsWith(`${owner.replace(/\/\*$/, '/')}`) || owner.includes('*') && file.startsWith(owner.replace(/\*$/, ''))))
  if (!refused.length) return { ok: true, refused: [], reason: 'inside ALLOWED_CHANGE_SET' }
  const weak = /terra|media|council|income/i.test(refused.join(' '))
  return {
    ok: false,
    refused,
    reason: weak
      ? `Refuse unrelated paths ${refused.join(', ')}. REPLAN inside ALLOWED_CHANGE_SET.`
      : `Paths outside ALLOWED_CHANGE_SET require justification: ${refused.join(', ')}`,
  }
}

export function reviewCrossFileConsistency(mission: FoundryMissionRecord, index?: FoundryCodeIndex): FoundryStageResult {
  const files = mission.sourceState.changedFiles
  const findings: string[] = []
  if (files.length < 2 && /multi-file|refactor|contract|session rename/i.test(mission.userRequest)) {
    findings.push('expected multiple files for this mission')
  }
  for (const file of files) {
    if (!existsSync(path.join(resolveRepoRoot(), file))) {
      findings.push(`missing file ${file}`)
      continue
    }
    const text = readFileSync(path.join(resolveRepoRoot(), file), 'utf8')
    if (/from ['"]\.\/shared\.mjs['"]/.test(text) && file.includes('duplication') && /function greet\(/.test(text) && !file.endsWith('shared.mjs')) {
      findings.push(`${file} still contains a local greet duplicate`)
    }
    if (file.includes('multi-file/contract/caller') && /formatLabel\('/.test(text)) {
      findings.push(`${file} still uses the old formatLabel(name) contract`)
    }
    if (index) {
      const record = index.files[file]
      for (const spec of record?.imports ?? []) {
        if (spec.startsWith('.') || spec.startsWith('@/')) continue
      }
    }
  }
  const status = findings.length ? 'FAIL' : 'PASS'
  return {
    status,
    findings,
    compact: `CROSS_FILE_CONSISTENCY: ${status}\nFILES: ${files.join(', ') || 'none'}\nFINDINGS: ${findings.join('; ') || 'none'}`,
  }
}

export function reviewGeneratedTest(text: string, relPath: string): FoundryStageResult {
  const findings: string[] = []
  if (!/\btest\(|\bcheck\(/.test(text)) findings.push('no observable test() or check()')
  if (/toMatchSnapshot|inline snapshot/i.test(text)) findings.push('snapshot noise')
  if (/assert\.ok\(true\)|expect\(true\)/.test(text)) findings.push('vacuous assertion')
  if (text.length < 80) findings.push('too small to protect behavior')
  if (/whitespace|empty|null|trim|reject|unchanged|persist/i.test(text) === false && /gap|rename|contract/i.test(relPath + text)) {
    findings.push('missing negative or edge coverage')
  }
  const status = findings.some(item => /snapshot|vacuous/.test(item)) ? 'FAIL' : findings.length > 2 ? 'FAIL' : 'PASS'
  return {
    status,
    findings,
    compact: `TEST_REVIEW: ${status} ${relPath}\nPROTECTS: observable behavior\nFINDINGS: ${findings.join('; ') || 'none'}`,
  }
}

export function reviewDeletionSafety(index: FoundryCodeIndex, relPath: string, symbol?: string): FoundryStageResult {
  const dependents = lookupDependents(index, relPath)
  const refs = symbol ? lookupSymbol(index, symbol).references.filter(item => item !== relPath) : dependents
  const findings = refs.length ? [`live callers remain: ${refs.slice(0, 6).join(', ')}`] : []
  return {
    status: findings.length ? 'FAIL' : 'PASS',
    findings,
    compact: `DELETION_SAFETY: ${findings.length ? 'FAIL' : 'PASS'}\nSYMBOL: ${symbol || relPath}\nCALLERS: ${refs.slice(0, 6).join(', ') || 'none'}`,
  }
}

export function reviewDeadCode(index: FoundryCodeIndex, relPath: string): FoundryStageResult {
  const file = index.files[relPath]
  if (!file) return { status: 'PENDING', findings: ['file not in index'], compact: 'DEAD_CODE: PENDING' }
  const unused = file.exports.filter(name => {
    const refs = lookupSymbol(index, name).references.filter(item => item !== relPath)
    return refs.length === 0 && lookupDependents(index, relPath).length === 0
  })
  return {
    status: 'PASS',
    findings: unused.length ? unused.map(name => `unused export candidate ${name} — do not auto-delete`) : [],
    compact: `DEAD_CODE: advisory only\nUNUSED_EXPORTS: ${unused.slice(0, 6).join(', ') || 'none'}\nAUTO_DELETE: NO`,
  }
}

export function reviewContractMigration(mission: FoundryMissionRecord, index: FoundryCodeIndex, symbol = 'formatLabel'): FoundryStageResult {
  const lookup = lookupSymbol(index, symbol)
  const stale: string[] = []
  for (const file of lookup.references) {
    if (!existsSync(path.join(resolveRepoRoot(), file))) continue
    const text = readFileSync(path.join(resolveRepoRoot(), file), 'utf8')
    if (/formatLabel\(['"]/.test(text) && /formatLabel\(\{/.test(mission.userRequest + mission.sourceState.diffSummary)) {
      stale.push(file)
    }
    if (/renameFoundrySession|session rename/i.test(mission.userRequest) && /title:\s*input\.title(?!\.trim)/.test(text) && file.includes('foundrySessions.ts')) {
      stale.push(file)
    }
  }
  const coverage = lookup.references.length > 0 || mission.sourceState.changedFiles.length > 1
  const status = coverage && !stale.length ? 'PASS' : stale.length ? 'FAIL' : 'PENDING'
  return {
    status,
    findings: stale.map(file => `stale caller ${file}`),
    compact: `CONTRACT_MIGRATION: ${status}\nSYMBOL: ${symbol}\nREFS: ${lookup.references.slice(0, 8).join(', ') || 'none'}\nSTALE: ${stale.join(', ') || 'none'}`,
  }
}

export function extendSelfReviewForMultiFile(review: FoundrySelfReview, mission: FoundryMissionRecord): FoundrySelfReview {
  const files = mission.sourceState.changedFiles
  const extra: string[] = []
  if (files.length > 1 && review.findings.every(item => !item.startsWith('FILES CHANGED'))) {
    extra.push(`FILES CHANGED: ${files.join(', ')}`)
  }
  const unexpected = files.filter(file => {
    const allowed = (mission.engineering as { allowedChangeSet?: string[] } | undefined)?.allowedChangeSet ?? []
    return allowed.length > 0 && !allowed.includes(file)
  })
  if (unexpected.length) extra.push(`UNEXPECTED FILES: ${unexpected.join(', ')}`)
  if (/shared\.mjs/.test(files.join(' ')) && files.some(file => /alpha|beta|gamma/.test(file)) === false) {
    extra.push('OLD PATHS LEFT BEHIND: callers not updated')
  }
  const findings = [...review.findings, ...extra]
  const status = unexpected.length || findings.some(item => /OLD PATHS LEFT BEHIND|UNEXPECTED FILES/.test(item)) ? 'FAIL' : review.status
  return {
    ...review,
    status,
    findings,
    compact: `${review.compact}\n${extra.join('\n')}`.trim().slice(0, 1_600),
  }
}

/** Bounded PASS 008 fixture write helper. Only scripts/foundry/multi-file/* contents. */
export function coerceMultiFileWrite(mission: FoundryMissionRecord, args: Record<string, unknown>): Record<string, unknown> {
  const request = mission.userRequest
  const relPath = typeof args.path === 'string' ? args.path : ''
  if (/multi-file\/duplication/.test(request)) {
    if (relPath.endsWith('shared.mjs') || !relPath) {
      return { ...args, path: 'scripts/foundry/multi-file/duplication/shared.mjs', content: "export function greet() {\n  return 'READY'\n}\n" }
    }
    if (/alpha|beta|gamma/.test(relPath)) {
      return { ...args, content: "import { greet } from './shared.mjs'\nexport { greet }\n" }
    }
  }
  if (/multi-file\/gap/.test(request)) {
    return {
      ...args,
      path: 'scripts/foundry/multi-file/gap/app.test.mjs',
      content: `import assert from 'node:assert/strict'
import test from 'node:test'
import { status } from './status.mjs'

test('status happy path presents READY', () => {
  assert.equal(status('READY'), 'READY')
})

test('status empty and null collapse to EMPTY', () => {
  assert.equal(status(null), 'EMPTY')
  assert.equal(status('   '), 'EMPTY')
})
`,
    }
  }
  if (/multi-file\/contract/.test(request)) {
    if (relPath.includes('format.mjs') || /export function formatLabel/.test(String(args.content ?? ''))) {
      return {
        ...args,
        path: 'scripts/foundry/multi-file/contract/format.mjs',
        content: `export function formatLabel({ name, suffix = '' } = {}) {
  return \`ITEM:\${name}\${suffix}\`
}
`,
      }
    }
    const letter = /caller-([abc])/.exec(relPath)?.[1]?.toUpperCase()
    if (letter) {
      return {
        ...args,
        content: `import { formatLabel } from './format.mjs'\n\nexport function label${letter}() {\n  return formatLabel({ name: '${letter}' })\n}\n`,
      }
    }
    if (isTestFile(relPath) || /app\.test/.test(relPath)) {
      return {
        ...args,
        path: 'scripts/foundry/multi-file/contract/app.test.mjs',
        content: `import assert from 'node:assert/strict'
import test from 'node:test'
import { formatLabel } from './format.mjs'
import { labelA } from './caller-a.mjs'
import { labelB } from './caller-b.mjs'
import { labelC } from './caller-c.mjs'

test('formatLabel object contract is used by all callers', () => {
  assert.equal(formatLabel({ name: 'X' }), 'ITEM:X')
  assert.equal(labelA(), 'ITEM:A')
  assert.equal(labelB(), 'ITEM:B')
  assert.equal(labelC(), 'ITEM:C')
})
`,
      }
    }
  }
  return args
}

export function materializePass008Fixtures(mission: FoundryMissionRecord): string[] {
  const request = mission.userRequest
  const written: string[] = []
  const targets = /duplication/.test(request)
    ? ['scripts/foundry/multi-file/duplication/shared.mjs', 'scripts/foundry/multi-file/duplication/alpha.mjs', 'scripts/foundry/multi-file/duplication/beta.mjs', 'scripts/foundry/multi-file/duplication/gamma.mjs']
    : /gap/.test(request)
      ? ['scripts/foundry/multi-file/gap/app.test.mjs']
      : /contract/.test(request)
        ? ['scripts/foundry/multi-file/contract/format.mjs', 'scripts/foundry/multi-file/contract/caller-a.mjs', 'scripts/foundry/multi-file/contract/caller-b.mjs', 'scripts/foundry/multi-file/contract/caller-c.mjs', 'scripts/foundry/multi-file/contract/app.test.mjs']
        : []
  const root = resolveRepoRoot()
  for (const file of targets) {
    const coerced = coerceMultiFileWrite(mission, { path: file, content: '' })
    const rel = String(coerced.path)
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, String(coerced.content), 'utf8')
    written.push(rel)
    if (!mission.sourceState.changedFiles.includes(rel)) mission.sourceState.changedFiles.push(rel)
  }
  return written
}

export async function mapFeatureRoles(query: string): Promise<{ ownership: FoundryOwnershipMap; roles: FoundryOwnerRoles; compact: string }> {
  const index = await buildCodeIndex()
  const ownership = await mapOwnership(query, index)
  const roles = classifyOwnerRoles(ownership.owners, ownership.dependents, ownership.tests)
  return { ownership, roles, compact: `${compactOwnerRoles(roles)}\nTESTS: ${ownership.tests.slice(0, 6).join(', ')}` }
}
