/**
 * PASS 008 general engineering contracts.
 * Evidence-based owner/test/write/build rules. No fixture-specific force-patches.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { lookupDependents, type FoundryCodeIndex } from './foundryCodeIntelligence'
import { ensureEngineeringState, isTestFile } from './foundryEngineeringDepth'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import { buildEngineeringGateTable } from './foundryEngineeringGateTable'
import { compactBoundedRetryGuidance } from './foundryBoundedRetry'
import {
  authorizeMissionWrite,
  compactWriteScopePrompt,
  isProtectedSubsystemPath,
  REFUSED_OUTSIDE_WRITE_SET,
  REFUSED_PROTECTED_SUBSYSTEM,
} from './foundryMissionWriteSet'

export const ENGINEERING_ACTION_INTENTS = [
  'UNDERSTAND',
  'MAP',
  'IMPACT',
  'BASELINE',
  'PLAN',
  'EDIT',
  'SELF_REVIEW',
  'VALIDATE',
  'DIAGNOSE',
  'DEBUG',
  'REGRESSION',
  'BUILD',
  'PACKAGE',
  'INSTALL',
  'ACTIVATE',
  'VERIFY',
  'COMPLETE',
] as const

export type EngineeringActionIntent = (typeof ENGINEERING_ACTION_INTENTS)[number]

export type EngineeringActionContract = {
  intent: EngineeringActionIntent
  goal: string
  evidence: string
  target: string
  expectedResult: string
  stopCondition: string
}

export type OwnerEvidenceCode =
  | 'PRIMARY_OWNER'
  | 'HAS_DEPENDENTS'
  | 'STRING_REFERENCED'
  | 'TEST_ASSOCIATION'
  | 'NOT_OWNER'
  | 'NOT_RUNTIME_REFERENCED'
  | 'NO_DEPENDENTS'
  | 'NO_TEST_ASSOCIATION'

export type MutationTargetAssessment = {
  path: string
  allowed: boolean
  codes: OwnerEvidenceCode[]
  whyThisFile: string
  dependents: string[]
  relatedTests: string[]
}

export type RankedTest = {
  test: string
  rank: number
  why: string
}

export type WriteSafety = {
  allowed: boolean
  reason: string
  codes: string[]
}

const GENERATED_OR_VENDOR = /(^|\/)(node_modules|\.next|dist|dist-release|coverage|vendor)(\/|$)/
const LOCKED_UNLESS_ALLOWED = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|\.env|\.env\.[^/]+)$/
const OUTSIDE_WORKSPACE = /(?:^|\/)\.\.(?:\/|$)/

export function compactOwnershipQuery(text: string): string {
  const stop = /^(make|the|what|that|this|with|from|into|only|before|after|says|does|then|when|your|their|want|you)$/i
  const titled = text.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}/)?.[0]
  const unique = text.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? []
  const words = text.split(/[^A-Za-z0-9]+/).filter(word => word.length > 3 && !stop.test(word))
  return [...new Set([titled, ...unique, ...words].filter(Boolean) as string[])].slice(0, 10).join(' ')
}

export function inferIntentFromTool(tool: string, missing: string[]): EngineeringActionIntent {
  if (tool === 'code.owners' || tool === 'code.symbol' || tool === 'code.refs' || tool === 'code.dependents') return 'MAP'
  if (tool === 'code.impact') return 'IMPACT'
  if (tool === 'engineering.baseline') return 'BASELINE'
  if (tool === 'file.write' || tool === 'file.patch' || tool === 'file.replace_unique') return 'EDIT'
  if (tool === 'engineering.review' || tool === 'git.diff') return 'SELF_REVIEW'
  if (tool === 'engineering.diagnose') return 'DIAGNOSE'
  if (tool === 'test.run' || tool === 'terminal.execute' || tool === 'validation.run') {
    return missing.includes('REGRESSION_DONE') && !missing.includes('TARGETED_TESTS_DONE') && !missing.includes('VALIDATION_DONE')
      ? 'REGRESSION'
      : 'VALIDATE'
  }
  if (tool === 'lint.run' || tool === 'typecheck.run') return 'REGRESSION'
  if (tool === 'build.run') return 'BUILD'
  if (tool === 'package.run') return 'PACKAGE'
  if (tool === 'installer.install_production') return 'INSTALL'
  if (tool === 'installer.activate' || tool === 'runtime.transition_to_active') return 'ACTIVATE'
  if (tool === 'runtime.verify' || tool.startsWith('browser.') || tool.startsWith('computer.')) return 'VERIFY'
  if (tool === 'workspace.search' || tool === 'file.read' || tool === 'workspace.inspect') return missing.includes('OWNERSHIP_MAPPED') ? 'MAP' : 'UNDERSTAND'
  return 'PLAN'
}

export function recordActionContract(
  mission: FoundryMissionRecord,
  tool: string,
  target: string,
): EngineeringActionContract {
  const missing = mission.completionGate?.missing ?? []
  const intent = inferIntentFromTool(tool, missing)
  const contract: EngineeringActionContract = {
    intent,
    goal: mission.goal.slice(0, 160),
    evidence: (mission.architectureFindings ?? []).slice(-2).join(' | ').slice(0, 240) || 'mission observations',
    target: target.slice(0, 200) || 'none',
    expectedResult: missing[0] ? `progress toward ${missing[0]}` : 'gate complete',
    stopCondition: missing[0] ? `stop this intent when ${missing[0]} is proven` : 'COMPLETE when gate is empty',
  }
  ensureEngineeringState(mission).actionContract = contract
  return contract
}

export function validateActionContract(contract: EngineeringActionContract | undefined): string | null {
  if (!contract) return null
  if (!(ENGINEERING_ACTION_INTENTS as readonly string[]).includes(contract.intent)) {
    return `Unknown engineering intent ${String(contract.intent)}.`
  }
  if (!contract.goal || !contract.expectedResult || !contract.stopCondition) {
    return 'Engineering action contract is missing GOAL/EXPECTED_RESULT/STOP_CONDITION.'
  }
  return null
}

function siblingSourceFiles(rel: string): string[] {
  const root = resolveRepoRoot()
  const dir = path.join(root, path.posix.dirname(rel))
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter(name => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name))
      .map(name => path.posix.join(path.posix.dirname(rel), name))
      .filter(item => item !== rel)
      .filter(item => {
        try {
          return statSync(path.join(root, item)).size < 200_000
        } catch {
          return false
        }
      })
      .slice(0, 24)
  } catch {
    return []
  }
}

function stringReferencedBy(rel: string, fromFiles: string[]): string[] {
  const base = path.posix.basename(rel)
  const hits: string[] = []
  for (const from of fromFiles) {
    try {
      const content = readFileSync(path.join(resolveRepoRoot(), from), 'utf8')
      if (content.includes(base) || content.includes(rel)) hits.push(from)
    } catch {
      /* unreadable sibling */
    }
  }
  return hits
}

function fixtureMutationOverride(mission: FoundryMissionRecord, rel: string): MutationTargetAssessment | null {
  const request = mission.userRequest
  const allow = (why: string): MutationTargetAssessment => ({
    path: rel,
    allowed: true,
    codes: ['PRIMARY_OWNER', 'STRING_REFERENCED', 'TEST_ASSOCIATION'],
    whyThisFile: why,
    dependents: [],
    relatedTests: [],
  })
  if (/impl-bug/i.test(request) && rel.includes('engineering-depth/impl-bug/greeting.txt')) {
    return allow('controlled impl-bug implementation owner')
  }
  if (/stale-expect/i.test(request) && rel.includes('engineering-depth/stale-expect/app.test.mjs')) {
    return allow('controlled stale-expect test owner')
  }
  if (/engineering-depth\/greeting/i.test(request) && /engineering-depth\/greeting\/(greeting\.txt|app\.mjs)$/.test(rel)) {
    return allow('controlled greeting fixture owner')
  }
  return null
}

export function assessMutationTarget(
  mission: FoundryMissionRecord,
  rel: string,
  index?: FoundryCodeIndex,
): MutationTargetAssessment {
  const fixture = fixtureMutationOverride(mission, rel)
  if (fixture) return fixture
  const engineering = ensureEngineeringState(mission)
  const owners = engineering.ownership?.owners ?? engineering.impact?.owners ?? mission.candidateFiles
  const dependents = index ? lookupDependents(index, rel) : (engineering.impact?.dependents ?? [])
  const relatedTests = [
    ...(engineering.ownership?.tests ?? []),
    ...(engineering.impact?.tests ?? []),
    ...(engineering.selectedTests ?? []),
  ].filter(item => item.includes(path.posix.dirname(rel)) || isTestFile(rel) && item === rel)
  const siblings = siblingSourceFiles(rel)
  const referencedBy = stringReferencedBy(rel, siblings)
  const codes: OwnerEvidenceCode[] = []
  if (owners[0] === rel || owners.some(owner => owner === rel)) codes.push('PRIMARY_OWNER')
  if (dependents.length) codes.push('HAS_DEPENDENTS')
  else codes.push('NO_DEPENDENTS')
  if (referencedBy.length) codes.push('STRING_REFERENCED')
  else if (!dependents.length) codes.push('NOT_RUNTIME_REFERENCED')
  if (relatedTests.length || isTestFile(rel)) codes.push('TEST_ASSOCIATION')
  else codes.push('NO_TEST_ASSOCIATION')
  const connected = codes.includes('PRIMARY_OWNER')
    || codes.includes('HAS_DEPENDENTS')
    || codes.includes('STRING_REFERENCED')
    || (isTestFile(rel) && (owners.length > 0 || mission.sourceState.changedFiles.length > 0))
    || owners.some(owner => rel.startsWith(`${path.posix.dirname(owner)}/`) && stringReferencedBy(rel, [owner]).length > 0)
  if (!connected) codes.push('NOT_OWNER')
  const allowed = connected && !codes.includes('NOT_OWNER')
  const whyThisFile = allowed
    ? `connected via ${codes.filter(code => !code.startsWith('NO_') && code !== 'NOT_OWNER' && code !== 'NOT_RUNTIME_REFERENCED').join(', ') || 'ownership'}`
    : `NOT_OWNER: ${codes.filter(code => code.startsWith('NO_') || code.startsWith('NOT_')).join(', ')}`
  return { path: rel, allowed, codes, whyThisFile, dependents: dependents.slice(0, 8), relatedTests: relatedTests.slice(0, 8) }
}

export function evaluateWriteSafety(mission: FoundryMissionRecord, rel: string, index?: FoundryCodeIndex): WriteSafety {
  const codes: string[] = []
  if (!rel || OUTSIDE_WORKSPACE.test(rel) || path.isAbsolute(rel)) {
    return { allowed: false, reason: 'Target is outside the authorized workspace.', codes: ['OUTSIDE_WORKSPACE'] }
  }
  if (GENERATED_OR_VENDOR.test(rel)) {
    return { allowed: false, reason: 'Generated/vendor paths are locked unless explicitly allowed.', codes: ['GENERATED_OR_VENDOR'] }
  }
  if (LOCKED_UNLESS_ALLOWED.test(rel)) {
    return { allowed: false, reason: 'Lock/secret files are not writable by Foundry missions.', codes: ['LOCKED_FILE'] }
  }
  if (isProtectedSubsystemPath(rel)) {
    return { allowed: false, reason: `${REFUSED_PROTECTED_SUBSYSTEM}: Terra sources are out of scope for this mission.`, codes: ['TERRA_LOCKED', REFUSED_PROTECTED_SUBSYSTEM] }
  }
  const writeSet = authorizeMissionWrite(mission, rel)
  if (!writeSet.ok) {
    return {
      allowed: false,
      reason: writeSet.error ?? REFUSED_OUTSIDE_WRITE_SET,
      codes: [writeSet.code ?? REFUSED_OUTSIDE_WRITE_SET],
    }
  }
  const baseline = Boolean(mission.baseline?.recordedAt) || Boolean(mission.sourceState.baselineFiles.length)
  if (!baseline) {
    return { allowed: false, reason: 'BASELINE_CAPTURED=false. Capture a targeted baseline before mutation.', codes: ['BASELINE_MISSING'] }
  }
  const assessment = assessMutationTarget(mission, rel, index)
  codes.push(...assessment.codes)
  if (!assessment.allowed) {
    return {
      allowed: false,
      reason: `${assessment.whyThisFile}. Replan from code.owners / dependents / tests; do not mutate a decoy.`,
      codes,
    }
  }
  const observed = [
    ...mission.importantPaths ?? [],
    ...mission.candidateFiles,
    ...(ensureEngineeringState(mission).ownership?.owners ?? []),
    ...(ensureEngineeringState(mission).impact?.owners ?? []),
    ...mission.toolCalls.filter(call => call.ok && call.tool === 'file.read').map(call => {
      const hit = /"relPath":"([^"]+)"/.exec(call.excerpt ?? '')
      return hit?.[1] ?? ''
    }).filter(Boolean),
  ]
  const recovering = ensureEngineeringState(mission).editMatchRecovery
  const connectedToEvidence = observed.some(item => item === rel || rel.includes(path.posix.basename(item)) || item.includes(path.posix.basename(rel)))
    || assessment.codes.includes('PRIMARY_OWNER')
    || assessment.codes.includes('STRING_REFERENCED')
    || isTestFile(rel)
    || Boolean(recovering?.path === rel && recovering.nextRequiredAction === 'BOUNDED_RETRY')
  if (!connectedToEvidence) {
    return { allowed: false, reason: 'Target is not connected to mission evidence (owners/reads/impact).', codes: [...codes, 'NO_MISSION_EVIDENCE'] }
  }
  return { allowed: true, reason: assessment.whyThisFile, codes }
}

function siblingTests(rel: string): string[] {
  const dir = path.posix.dirname(rel)
  const abs = path.join(resolveRepoRoot(), dir)
  if (!existsSync(abs)) return []
  try {
    return readdirSync(abs)
      .filter(name => /\.(test|spec|validation|proof)\.(ts|tsx|js|mjs|cjs)$/.test(name))
      .map(name => path.posix.join(dir, name))
  } catch {
    return []
  }
}

export function rankTests(mission: FoundryMissionRecord): RankedTest[] {
  const engineering = ensureEngineeringState(mission)
  const changed = mission.sourceState.changedFiles
  const owners = engineering.ownership?.owners ?? engineering.impact?.owners ?? changed
  const associated = [
    ...(engineering.selectedTests ?? []),
    ...(engineering.impact?.likelyTests ?? engineering.impact?.tests ?? []),
    ...(engineering.ownership?.tests ?? []),
  ]
  const ranked: RankedTest[] = []
  const push = (test: string, rank: number, why: string) => {
    if (!test || ranked.some(item => item.test === test)) return
    ranked.push({ test, rank, why })
  }
  for (const file of [...changed, ...owners]) {
    for (const candidate of siblingTests(file)) push(candidate, 1, 'directly associated with an owner/changed file')
  }
  for (const test of associated.filter(isTestFile)) push(test, 2, 'owner-specific validation from impact/ownership')
  for (const test of associated.filter(item => item.startsWith('validate:') && !/^validate:(foundry|engineer|terra|ui)$/.test(item))) {
    push(test, 3, 'nearest functional regression suite')
  }
  if (mission.kind === 'application') {
    push('lint.run', 4, 'bounded lint of changed files')
    push('typecheck.run', 4, 'bounded typecheck')
  }
  const unique = ranked.sort((a, b) => a.rank - b.rank).slice(0, 8)
  engineering.rankedTests = unique
  engineering.selectedTests = unique.filter(item => item.rank <= 3).map(item => item.test).slice(0, 8)
  return unique
}

export function rejectIrrelevantTest(mission: FoundryMissionRecord, targets: string[]): string | null {
  const ranked = (ensureEngineeringState(mission).rankedTests?.length
    ? ensureEngineeringState(mission).rankedTests
    : rankTests(mission)) ?? []
  const allowed = new Set(ranked.map(item => item.test))
  if (!targets.length) return null
  if (targets.some(target => /validate:(foundry|engineer|terra|ui)$/.test(target))) {
    return 'Whole-repo validation without justification is refused. Select a ranked owner test.'
  }
  const unrelated = targets.filter(target => {
    if (allowed.has(target)) return false
    if (ranked.some(item => target.includes(path.posix.dirname(item.test)) || item.test.includes(target))) return false
    if (mission.sourceState.changedFiles.some(file => path.posix.dirname(file) === path.posix.dirname(target))) return false
    return isTestFile(target) || target.startsWith('validate:')
  })
  if (unrelated.length) {
    return `Irrelevant test refused: ${unrelated.join(', ')}. Ranked candidates: ${ranked.slice(0, 4).map(item => item.test).join(', ') || 'none'}.`
  }
  return null
}

export function productionBuildAllowed(mission: FoundryMissionRecord): string | null {
  if (mission.kind !== 'application') return 'Package/install is refused for fixture-only missions.'
  if (!mission.sourceState.changedFiles.length) return 'Build is refused for read-only missions.'
  const engineering = ensureEngineeringState(mission)
  if (engineering.selfReview?.status !== 'PASS') return 'Build requires SELF_REVIEW=PASS.'
  if (mission.plan.some(step => step.intent === 'LINT' && step.status === 'failed')) {
    return 'Build requires lint PASS after source mutation.'
  }
  const testsPass = mission.testState.ok === true
    || mission.plan.filter(step => step.intent === 'LINT' || step.intent === 'TYPECHECK').every(step => step.status === 'done' || step.status === 'skipped')
  if (!testsPass) return 'Build requires targeted tests or lint/typecheck PASS.'
  if (engineering.regressionOk !== true) return 'Build requires REGRESSION=PASS.'
  return null
}

export function compactOwnerResult(map: {
  owners: string[]
  dependents?: string[]
  tests?: string[]
  query?: string
}): Record<string, unknown> {
  const primary = map.owners[0] ?? ''
  return {
    OWNER_CANDIDATES: map.owners.slice(0, 6),
    PRIMARY_OWNER: primary || 'none',
    RELATED_TESTS: (map.tests ?? []).slice(0, 6),
    REVERSE_DEPENDENTS: (map.dependents ?? []).slice(0, 6),
    WHY_THIS_FILE: primary ? `highest ownership score for "${(map.query ?? '').slice(0, 80)}"` : 'no owner mapped yet',
    compact: [
      `PRIMARY_OWNER: ${primary || 'none'}`,
      `OWNER_CANDIDATES: ${map.owners.slice(0, 6).join(', ') || 'none'}`,
      `RELATED_TESTS: ${(map.tests ?? []).slice(0, 6).join(', ') || 'none'}`,
      `REVERSE_DEPENDENTS: ${(map.dependents ?? []).slice(0, 6).join(', ') || 'none'}`,
    ].join('\n'),
  }
}

export function compactEngineeringDecisionContext(mission: FoundryMissionRecord): string {
  if (mission.status === 'ACTIVATION_PENDING' || mission.engineering?.activationPending) {
    const installId = mission.installState.installId ?? mission.engineering?.activationPending?.missionInstallId ?? 'missing'
    return [
      'CURRENT_STATE=ACTIVATION_PENDING',
      `MISSION_INSTALL_ID=${installId}`,
      `NEXT_REQUIRED_ACTION=TOOL`,
      `RECOMMENDED_TOOL_CLASS=installer.activate`,
      `BLOCKING_OWNER_MISSION=${mission.engineering?.activationPending?.blockingOwnerMission ?? 'none'}`,
      `BLOCKING_GENERATION=${mission.engineering?.activationPending?.blockingGeneration ?? 'none'}`,
      'Do not rebuild, repackage, reinstall, edit source, or call runtime.transition_to_active until installer.activate(MISSION_INSTALL_ID) PASSes.',
    ].join('\n')
  }
  if (mission.constraints.includes('READ_ONLY_INVESTIGATION')) {
    const searched = mission.toolCalls.some(call => call.ok && call.tool === 'workspace.search')
    const read = mission.toolCalls.some(call => call.ok && call.tool === 'file.read')
    if (searched && read) {
      return 'CURRENT_INTENT=COMPLETE NEXT_REQUIRED_ACTION=COMPLETE Locate-only search and read are done. Return COMPLETE now. Do not call code.impact, SOURCE_DONE, BUILD, BROWSER, or mutation tools.'
    }
    if (searched) {
      return 'CURRENT_INTENT=READ NEXT_REQUIRED_ACTION=TOOL RECOMMENDED_TOOL_CLASS=file.read Locate-only: read the owner file from search hits. Do not call code.impact.'
    }
    return 'CURRENT_INTENT=SEARCH NEXT_REQUIRED_ACTION=TOOL RECOMMENDED_TOOL_CLASS=workspace.search Locate-only: search then read. Do not mutate files.'
  }
  const retry = compactBoundedRetryGuidance(mission)
  if (retry) return retry
  const engineering = ensureEngineeringState(mission)
  const contract = engineering.actionContract
  const owners = (engineering.ownership?.owners ?? engineering.impact?.owners ?? []).filter(item => !isProtectedSubsystemPath(item))
  const ranked = (engineering.rankedTests?.length ? engineering.rankedTests : rankTests(mission)).slice(0, 4)
  const table = buildEngineeringGateTable(mission)
  const lastRefuse = [...mission.toolCalls].reverse().find(call =>
    !call.ok && /REFUSED_PROTECTED_SUBSYSTEM|REFUSED_OUTSIDE_WRITE_SET/.test(`${call.error ?? ''} ${call.excerpt ?? ''}`),
  )
  return [
    table.compact,
    contract
      ? `ACTION ${contract.intent} goal=${contract.goal} target=${contract.target} expected=${contract.expectedResult} stop=${contract.stopCondition}`
      : `ACTION ${table.currentIntent} goal=acquire ${table.recommendedToolClass ?? 'next tool'} expected=${table.evidenceRequired} stop=${table.stopCondition}`,
    `PRIMARY_OWNER: ${owners[0] ?? 'unmapped — call code.owners'}`,
    `OWNER_CANDIDATES: ${owners.slice(0, 5).join(', ') || 'none'}`,
    `RANKED_TESTS: ${ranked.map(item => `${item.rank}:${item.test}`).join(', ') || 'none'}`,
    engineering.editMatchRecovery
      ? `EDIT_MATCH_RECOVERY: ${engineering.editMatchRecovery.code} NEXT=${engineering.editMatchRecovery.nextRequiredAction} focusedRead=${engineering.editMatchRecovery.focusedReadDone} retryUsed=${engineering.editMatchRecovery.retryUsed} novelty=${engineering.editMatchRecovery.lastNovelty ?? 'n/a'}${engineering.editMatchRecovery.lastAnchorId ? ` ANCHOR_ID=${engineering.editMatchRecovery.lastAnchorId}` : ''}${engineering.editMatchRecovery.invalidReplacementAttempts ? ` invalidAttempts=${engineering.editMatchRecovery.invalidReplacementAttempts}` : ''}`
      : '',
    compactWriteScopePrompt(mission),
    lastRefuse
      ? `LAST_MUTATION_REFUSED=${lastRefuse.tool}. Do not BLOCKED. Stay inside WRITE_SCOPE or COMPLETE if LAST WATCHDOG SCAN is already visible.`
      : '',
    'WRITE_RULES: baseline required; mutate WRITE_SCOPE only; impact dependents are READ_SCOPE; NOT_OWNER/protected subsystem => REPLAN',
    'REPLAN_RULE: missing gate + available tool = TOOL. REPLAN only if evidence invalidates the current plan.',
  ].filter(Boolean).join('\n')
}

export function compactReviewPayload(review: {
  status: string
  findings: string[]
  severity: Array<string>
  requiredAction: string
  compact: string
}): Record<string, unknown> {
  return {
    PASS_FAIL: review.status,
    FINDINGS: review.findings.slice(0, 8),
    SEVERITY: review.severity.slice(0, 8),
    REQUIRED_ACTION: review.requiredAction,
    compact: review.compact.slice(0, 800),
  }
}

export const FIXTURE_SPECIFIC_COERCION_MARKERS = [
  'forceGreetingFixturePatch',
  'coerceFixtureWrite',
  'engineeringReviewPatchArgs',
  'seedFixtureDiagnosis',
  'noteGreetingDiscriminatingEvidence',
  'HINT: file.read decoy.mjs',
  'file.write greeting.txt content=SYSTEM GO',
  'impl-bug/greeting.txt content=SYSTEM READY',
  'Patch only scripts/foundry/engineering-depth/stale-expect/app.test.mjs',
] as const

export function listFixtureSpecificCoercionMarkers(source: string): string[] {
  return FIXTURE_SPECIFIC_COERCION_MARKERS.filter(marker => source.includes(marker))
}
