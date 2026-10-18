/** Application acceptance belongs to the mission, not to a generator or a test exit code. */
import type { RepoMap } from './repoMap'
import type { Phase6VerificationReceipt } from './foundryPhase6Completion'

export type ApplicationProofKind = 'cli' | 'ui' | 'api' | 'persistence' | 'restart' | 'shutdown'
export type ApplicationMission = {
  missionId: string
  commanderGoal: string
  projectType: 'cli' | 'web' | 'api' | 'application'
  existingOrGreenfield: 'existing' | 'greenfield'
  runtime: string
  packageManager: string
  framework?: string
  language: string
  entrypoints: string[]
  acceptanceCriteria: string[]
  requiredFeatures: string[]
  persistenceRequirements: string[]
  runtimeRequirements: ApplicationProofKind[]
  testRequirements: string[]
  verificationRequirements: string[]
  forbiddenActions: string[]
}
export type ApplicationRuntimeEvidence = {
  kind: ApplicationProofKind
  sourceDigest: string
  /** A reference to an executor-produced observation, not an implementer claim. */
  evidenceRef: string
  passed: boolean
  criteria: string[]
}
export type ApplicationBuildState = {
  contract: ApplicationMission
  generation: number
  sourceDigest?: string
  testedDigest?: string
  completedTurns: number
  observation: string
  runtimeEvidence: ApplicationRuntimeEvidence[]
  cliVerificationPlan?: import('./foundryApplicationCliVerification').CliAcceptancePlan
  webVerificationPlan?: import('./foundryApplicationWebVerification').WebAcceptancePlan
  apiVerificationPlan?: import('./foundryApplicationApiVerification').ApiAcceptancePlan
  /** Per-step observed behavior retained across generations to prevent repair regressions. */
  cliAcceptanceLedger?: {
    sourceDigest: string
    passedSteps: string[]
    failedSteps: string[]
    evidenceRef: string
  }
  webAcceptanceLedger?: {
    sourceDigest: string
    passedSteps: string[]
    failedSteps: string[]
    evidenceRef: string
  }
  apiAcceptanceLedger?: {
    sourceDigest: string
    passedSteps: string[]
    failedSteps: string[]
    evidenceRef: string
  }
  /** Exact pre-edit project snapshot used to reject a behavior-regressing generation. */
  pendingCheckpoint?: {
    sourceDigest: string
    generation: number
    testedDigest?: string
    artifact: string
  }
  phase6?: Phase6VerificationReceipt
  missing: string[]
  /** Destructive-regression signatures already seen; persisted across resumes so a model that reliably repeats one bad mutation cannot get a fresh two-strike allowance every time the mission process restarts. */
  knownDestructiveSignatures?: string[]
}

export function hasApplicationAcceptanceLedger(state: ApplicationBuildState): boolean {
  return Boolean(state.cliAcceptanceLedger || state.webAcceptanceLedger || state.apiAcceptanceLedger)
}

export function applicationAcceptanceLedgerComplete(ledger: { sourceDigest?: string; passedSteps: string[]; failedSteps: string[] } | undefined, sourceDigest?: string): boolean {
  return Boolean(ledger && ledger.passedSteps.length > 0 && ledger.failedSteps.length === 0 && (!sourceDigest || ledger.sourceDigest === sourceDigest))
}

export const APPLICATION_BUILD_RULES = [
  'Create application structure and full source directly; never use scaffold generators, starter repositories, or canned app factories.',
  'Use real HTTP, storage, browser, authentication and processes where required; never replace product behavior with mocks.',
  'Inspect installed/native capabilities before adding a dependency. Record reason, exact version, source and lockfile change.',
  'Run real tests and goal-specific runtime checks. A build, health response, screenshot or test exit alone cannot prove completion.',
  'Persist source and observed evidence. After a source edit, rerun affected verification before completion.',
  'No commit, push, deploy, purchases, public listeners, production-data changes or sandbox weakening.',
] as const

export function isExplicitDirectApplicationRequest(request: string): boolean {
  const product = /\b(?:application|app|api|web|ui|cli|product)\b/i.test(request)
  const explicitBuild = /\b(?:real existing|greenfield|mini[- ]product|application build|direct[- ]build)\b/i.test(request)
  const explicitRecovery = /\b(?:diagnose|repair|recover)\b[\s\S]{0,120}\b(?:genuine|real|failed|broken|existing)\b[\s\S]{0,120}\b(?:application|app|api|web|ui|cli|product)\b/i.test(request)
  return product && (explicitBuild || explicitRecovery)
}

export function deriveApplicationMission(input: {
  missionId: string; goal: string; map: RepoMap; acceptanceCriteria?: string[]; packageManager?: string
}): ApplicationMission {
  const { goal, map } = input
  const cli = /\bcli\b|command[- ]line|terminal tool/i.test(goal)
  const ui = !cli && /\b(ui|web|website|browser|frontend|front-end|dashboard)\b/i.test(goal)
  const api = /\b(api|http|backend|back-end)\b/i.test(goal)
  const persistence = /persist|sqlite|database|storage|save|file[- ]backed/i.test(goal)
  const restart = persistence || /restart|reopen/i.test(goal)
  const projectType = cli ? 'cli' : ui ? 'web' : api ? 'api' : 'application'
  const criteria = [...new Set([goal, ...(input.acceptanceCriteria ?? [])].map(s => s.trim()).filter(Boolean))]
  return {
    missionId: input.missionId, commanderGoal: goal, projectType,
    existingOrGreenfield: map.fileCount === 0 ? 'greenfield' : 'existing',
    runtime: map.runtime, packageManager: input.packageManager ?? 'undetermined',
    framework: map.framework === 'unknown' ? undefined : map.framework,
    language: map.runtime === 'python' ? 'Python' : map.runtime === 'cargo' ? 'Rust' : 'JavaScript',
    entrypoints: [...map.entryPoints], acceptanceCriteria: criteria, requiredFeatures: [...criteria],
    persistenceRequirements: persistence ? ['Create, read and update real local data; verify it after process restart.'] : [],
    runtimeRequirements: [...(cli ? ['cli' as const] : []), ...(ui ? ['ui' as const] : []), ...(api ? ['api' as const] : []), ...(persistence ? ['persistence' as const] : []), ...(restart ? ['restart' as const] : []), 'shutdown'],
    testRequirements: ['Execute nonzero real behavior tests against the current source.'],
    verificationRequirements: ['Self-review', 'Independent verification', 'Goal-specific runtime evidence for each acceptance criterion'],
    forbiddenActions: [...APPLICATION_BUILD_RULES],
  }
}

/** Only the latest observation for each proof kind at this source can contribute. */
export function currentApplicationEvidence(state: ApplicationBuildState): ApplicationRuntimeEvidence[] {
  const latest = new Map<ApplicationProofKind, ApplicationRuntimeEvidence>()
  for (const evidence of state.runtimeEvidence) {
    if (evidence.sourceDigest === state.sourceDigest && evidence.evidenceRef.trim()) latest.set(evidence.kind, evidence)
  }
  return [...latest.values()].filter(e => e.passed)
}

/** This is an evidence gate, not a runtime simulator. Empty or stale evidence fails closed. */
export function applicationCompletionMissing(state: ApplicationBuildState, testsPassed: boolean): string[] {
  const missing: string[] = []
  if (!state.sourceDigest) missing.push('Current source identity is missing.')
  if (!testsPassed || !state.testedDigest || state.testedDigest !== state.sourceDigest) missing.push('Real tests have not passed against the current source.')
  const current = currentApplicationEvidence(state)
  for (const kind of state.contract.runtimeRequirements) {
    if (!current.some(e => e.kind === kind)) missing.push(`Real ${kind} verification is missing at the current source.`)
  }
  for (const criterion of state.contract.acceptanceCriteria) {
    if (!current.some(e => e.criteria.includes(criterion))) missing.push(`Runtime evidence is missing for: ${criterion}`)
  }
  if (!state.phase6?.complete || state.phase6.missionId !== state.contract.missionId || state.phase6.generation !== state.generation) {
    missing.push('Phase 6 self-review and independent verification have not completed at the current generation.')
  }
  return missing
}

export function existingImportBindings(source: string): string[] {
  const names = new Set<string>()
  for (const match of source.matchAll(/import\s+([^;\n]+?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = match[1].trim()
    const braces = clause.match(/\{([^}]*)\}/)?.[1] ?? ''
    for (const part of braces.split(',').map(item => item.trim()).filter(Boolean)) names.add((part.split(/\s+as\s+/)[1] ?? part.split(/\s+as\s+/)[0]).trim())
    const withoutBraces = clause.replace(/\{[^}]*\}/g, '').replace(/^type\s+/, '').replace(/,$/, '').trim()
    if (withoutBraces && !withoutBraces.startsWith('*')) names.add(withoutBraces.split(',')[0].trim())
    const namespace = clause.match(/\*\s+as\s+(\w+)/)?.[1]
    if (namespace) names.add(namespace)
  }
  return [...names].filter(Boolean).sort()
}

export function existingTopLevelBindings(source: string): string[] {
  const names = new Set(existingImportBindings(source))
  for (const match of source.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1])
  return [...names].sort()
}

/** A shared persistent-server test file has one before() hook, so array-literal fixture values (tags, categories, roles, statuses) reused across separate test() blocks accumulate rather than resetting; flag repeats so a new count/length assertion does not collide with an earlier test's data. */
export function duplicatedApplicationFixtureLiterals(source: string): string[] {
  const counts = new Map<string, number>()
  for (const match of source.matchAll(/\[\s*((?:['"][^'"]*['"]\s*,?\s*)+)\]/g)) {
    for (const item of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      counts.set(item[1], (counts.get(item[1]) ?? 0) + 1)
    }
  }
  for (const match of source.matchAll(/\b(?:title|name|email|username|slug)\s*:\s*['"]([^'"]+)['"]/g)) {
    if (!match[1].trim()) continue
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value).sort()
}

export function initialApplicationBuildState(contract: ApplicationMission): ApplicationBuildState {
  return { contract, generation: 0, completedTurns: 0, observation: 'Inspect the project and implement the Commander goal.', runtimeEvidence: [], missing: ['Application verification has not run.'] }
}
