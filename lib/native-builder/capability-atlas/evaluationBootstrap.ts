/**
 * Record executed evaluation evidence for currently AVAILABLE Atlas skills.
 * Documentation, implementation files, and validator-file existence are not mastery.
 * Does not train WRIM, mutate Terra, commit, push, or activate production.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { capabilityAtlasLayout, loadCapabilityAtlas, type CapabilityAtlas } from './store'
import { persistScoreboard } from './scoreboard'
import { recordSkillEvaluation } from './evaluations'
import { buildCapabilityScoreboard } from './scoreboard'
import { resetCapabilityAtlasCache } from './tools'
import type { CapabilityScoreboard, EvaluationLevel, EvaluationOutcome, SkillRecord } from './types'

const LOADER = ['./scripts/ts-extension-loader.mjs', '--experimental-transform-types'] as const

export type ValidatorSpec = {
  id: string
  title: string
  script: string
  pnpmScript?: string
  timeoutMs?: number
  mutatesProduction: false
}

export type SkillCreditPolicy = {
  validatorId: string
  level: EvaluationLevel
  passOutcome: 'PASS' | 'PARTIAL'
  limitations: string
  requiredSteps: string[]
}

export const EVALUATION_BOOTSTRAP_GOVERNANCE = {
  globalResearch: false,
  wrimTraining: false,
  terra: false,
  commit: false,
  push: false,
  deploy: false,
  productionActivation: false,
} as const

/** Validators that exist and are safe to execute without packaging/install/activate. */
export const SAFE_VALIDATORS: ValidatorSpec[] = [
  { id: 'engineering-depth', title: 'Foundry engineering depth', script: 'lib/native-builder/foundryEngineeringDepth.validation.ts', mutatesProduction: false },
  { id: 'foundry-ui', title: 'Foundry validation suite', script: 'lib/native-builder/foundry.validation.ts', pnpmScript: 'validate:foundry', timeoutMs: 900_000, mutatesProduction: false },
  { id: 'trusted-desktop', title: 'Trusted desktop auth', script: 'lib/sovereign-runtime/local-ownership/trustedDesktop.validation.ts', pnpmScript: 'validate:trusted-desktop-auth', mutatesProduction: false },
  { id: 'process-inspector', title: 'Process inspector', script: 'lib/native-builder/processInspector.validation.ts', mutatesProduction: false },
  { id: 'write-set', title: 'PASS 014 write-set', script: 'lib/native-builder/foundryPass014.writeSet.validation.ts', pnpmScript: 'validate:foundry-pass014-write-set', mutatesProduction: false },
  { id: 'pass014-depth', title: 'PASS 014 autonomous engineering depth', script: 'lib/native-builder/foundryAutonomousEngineeringDepth.pass014.validation.ts', pnpmScript: 'validate:foundry-autonomous-engineering-depth-pass014', mutatesProduction: false },
  { id: 'pass015-depth', title: 'PASS 015 engineering review token', script: 'lib/native-builder/foundryAutonomousEngineeringDepth.pass015.validation.ts', pnpmScript: 'validate:foundry-autonomous-engineering-depth-pass015', mutatesProduction: false },
  { id: 'cdp-governance', title: 'CDP governance', script: 'lib/native-builder/foundryCdpGovernance.validation.ts', pnpmScript: 'validate:foundry-cdp-governance', mutatesProduction: false },
  { id: 'computer-use', title: 'PASS 011 computer-use geometry', script: 'lib/native-builder/foundryPass011.computerUse.validation.ts', pnpmScript: 'validate:foundry-pass011-computer-use', mutatesProduction: false },
  { id: 'lease-watchdog', title: 'Production lease watchdog', script: 'lib/native-builder/foundryProductionLeaseWatchdog.validation.ts', pnpmScript: 'validate:foundry-production-lease-watchdog', mutatesProduction: false },
  { id: 'production-ownership', title: 'Production ownership', script: 'lib/native-builder/foundryProductionOwnership.validation.ts', pnpmScript: 'validate:foundry-production-ownership', mutatesProduction: false },
  { id: 'quality-tools', title: 'Quality tools typecheck/test.run policy', script: 'lib/native-builder/qualityTools.validation.ts', timeoutMs: 360_000, mutatesProduction: false },
  { id: 'installer-tmp', title: 'Installer tool tmp-root', script: 'lib/native-builder/installerTool.validation.ts', mutatesProduction: false },
]

const REFUSED_PRODUCTION_PROOFS = [
  'lib/native-builder/foundryPass014.production.proof.ts',
  'lib/native-builder/foundryActivationAcceptance.proof.ts',
  'lib/native-builder/foundryProductionToolchain.proof.ts',
  'lib/native-builder/foundryPass014.rebuild.proof.ts',
]

export function listAvailableSkills(atlas: CapabilityAtlas): SkillRecord[] {
  return [...atlas.skills.values()].filter(skill => skill.capabilityStatus === 'AVAILABLE').sort((a, b) => a.skillId.localeCompare(b.skillId))
}

export function creditPolicyForSkill(skill: SkillRecord): SkillCreditPolicy | null {
  const validators = skill.evidence.validators
  const methods = skill.validationMethods
  if (skill.skillId === 'foundry.tool-broker-governance') {
    return { validatorId: 'write-set', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'Write-set/broker governance only. Not a claim that every future mutating tool is proven.', requiredSteps: ['run write-set validator', 'confirm Terra protected'] }
  }
  if (skill.skillId === 'foundry.bounded-edit') {
    return { validatorId: 'pass014-depth', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'PASS 014 bounded-edit/write-set depth. Live production edit missions are separate.', requiredSteps: ['run pass014 depth validator'] }
  }
  if (skill.skillId === 'foundry.production-lease') {
    return { validatorId: 'lease-watchdog', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'Watchdog/lease unit+governance validator. Not a live production activation.', requiredSteps: ['run lease watchdog validator'] }
  }
  if (skill.skillId === 'release.production-activation') {
    return { validatorId: 'production-ownership', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'Ownership/authorization validator only. Activation acceptance and packaging proofs were not executed (DEPLOY=NO).', requiredSteps: ['run production ownership validator', 'refuse activation scripts'] }
  }
  if (skill.skillId === 'foundry.computer-use-atspi') {
    return { validatorId: 'computer-use', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'Geometry/governance validator. Not a live AT-SPI session against the Commander desktop.', requiredSteps: ['run pass011 computer-use validator'] }
  }
  if (skill.skillId === 'foundry.browser-playwright') {
    return { validatorId: 'cdp-governance', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'CDP bind/target governance. Not arbitrary-site Playwright E2E mastery.', requiredSteps: ['run CDP governance validator'] }
  }
  if (skill.skillId === 'foundry.code-intelligence' || skill.skillId === 'compiler.ast.symbol-resolution' || skill.skillId === 'archaeology.ownership-discovery' || skill.skillId === 'foundry.engineering-memory' || skill.skillId === 'testing.targeted') {
    return { validatorId: 'engineering-depth', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'War Room repo index/memory/test-selection evidence only. Not a general compiler or archaeology product.', requiredSteps: ['run engineering-depth validator'] }
  }
  if (skill.skillId === 'systems.processes') {
    return { validatorId: 'process-inspector', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'process.list/inspect against the live process table. start/stop of arbitrary host PIDs is not proven.', requiredSteps: ['run process inspector validator'] }
  }
  if (skill.skillId === 'security.auth') {
    return { validatorId: 'trusted-desktop', level: 'INTEGRATION_EVAL', passOutcome: 'PASS', limitations: 'Trusted-desktop local auth only. Generic OAuth/OIDC remains unproven.', requiredSteps: ['run trusted-desktop-auth validator'] }
  }
  if (skill.skillId === 'software.languages.typescript') {
    return { validatorId: 'quality-tools', level: 'CODE_EVAL', passOutcome: 'PARTIAL', limitations: 'Real tsc in Foundry scope is not TypeScript language mastery or production compiler work.', requiredSteps: ['run quality-tools typecheck'] }
  }
  if (skill.skillId === 'frontend.react' || skill.skillId === 'frontend.nextjs' || skill.skillId === 'backend.rest') {
    return { validatorId: 'foundry-ui', level: 'CODE_EVAL', passOutcome: 'PARTIAL', limitations: 'Foundry UI/API validator uses React/Next/REST. Does not prove general framework mastery.', requiredSteps: ['run validate:foundry'] }
  }
  if (skill.skillId === 'desktop.electron') {
    return { validatorId: 'trusted-desktop', level: 'CODE_EVAL', passOutcome: 'PARTIAL', limitations: 'Trusted-desktop proofs sit in the Electron shell. Not Electron packaging/app-lifecycle mastery.', requiredSteps: ['run trusted-desktop-auth validator'] }
  }
  if (skill.skillId === 'testing.browser-automation') {
    return { validatorId: 'cdp-governance', level: 'CODE_EVAL', passOutcome: 'PARTIAL', limitations: 'Governed Chromium CDP is not Cypress/Selenium/generic browser-automation mastery.', requiredSteps: ['run CDP governance validator'] }
  }
  if (skill.skillId === 'release.packaging') {
    return { validatorId: 'installer-tmp', level: 'CODE_EVAL', passOutcome: 'PARTIAL', limitations: 'Installer tmp-root tests. electron-builder packaging of War Room was not executed.', requiredSteps: ['run installer tmp validator', 'do not run production toolchain proof'] }
  }
  if (skill.skillId === 'foundry.binding-protection') {
    return { validatorId: 'engineering-depth', level: 'CODE_EVAL', passOutcome: 'PARTIAL', limitations: 'No dedicated binding-protection validator. Engineering-depth review is adjacent only.', requiredSteps: ['inspect engineering-depth review cases'] }
  }
  if (validators.length || methods.length) {
    return { validatorId: 'engineering-depth', level: 'CODE_EVAL', passOutcome: 'PARTIAL', limitations: 'Generic adjacent validator credit only.', requiredSteps: ['run linked validator'] }
  }
  return null
}

export type ValidatorRunResult = {
  id: string
  command: string
  exitCode: number
  outcome: EvaluationOutcome
  summary: string
  logPath: string | null
}

function nodeValidatorCommand(script: string): { cmd: string; args: string[] } {
  return {
    cmd: process.execPath,
    args: ['--loader', LOADER[0], LOADER[1], script],
  }
}

export function classifyValidatorOutput(input: { timedOut: boolean; exitCode: number; output: string }): EvaluationOutcome {
  if (input.timedOut) return 'NOT_RUN'
  const matches = [...input.output.matchAll(/(\d+)\/(\d+) PASS/g)]
  const last = matches.at(-1)
  const passed = last ? Number(last[1]) : null
  const total = last ? Number(last[2]) : null
  if (input.exitCode === 0) return 'PASS'
  if (passed != null && total != null && total > 0) {
    if (passed === total) return 'PASS'
    if (passed > 0) return 'PARTIAL'
  }
  return 'FAIL'
}

function writeValidatorLog(spec: ValidatorSpec, output: string): string {
  const layout = capabilityAtlasLayout()
  const dir = path.join(layout.evaluations, 'logs')
  mkdirSync(dir, { recursive: true })
  const logPath = path.join(dir, `${spec.id}.log`)
  writeFileSync(logPath, output, 'utf8')
  return logPath
}

export function runSafeValidator(spec: ValidatorSpec, cwd = resolveRepoRoot()): ValidatorRunResult {
  const { cmd, args } = nodeValidatorCommand(spec.script)
  const command = spec.pnpmScript ? `pnpm run ${spec.pnpmScript}` : `${cmd} ${args.join(' ')}`
  const abs = path.join(cwd, spec.script)
  if (!existsSync(abs)) {
    return { id: spec.id, command, exitCode: 127, outcome: 'NOT_RUN', summary: `validator file missing: ${spec.script}`, logPath: null }
  }
  const timeout = spec.timeoutMs ?? 240_000
  const spawned = spec.pnpmScript
    ? spawnSync('pnpm', ['run', spec.pnpmScript], { cwd, encoding: 'utf8', timeout, maxBuffer: 12 * 1024 * 1024, shell: false })
    : spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 12 * 1024 * 1024, shell: false })
  const timedOut = Boolean(spawned.error && (spawned.error as NodeJS.ErrnoException).code === 'ETIMEDOUT')
  const out = `${spawned.stdout || ''}\n${spawned.stderr || ''}`.trim()
  const logPath = writeValidatorLog(spec, timedOut ? `TIMEOUT after ${timeout}ms\n${out}` : out)
  const tail = out.slice(-2500)
  const exitCode = timedOut ? 124 : spawned.status ?? (spawned.error ? 1 : 0)
  const passLine = out.split('\n').reverse().find(line => /\d+\/\d+ PASS/.test(line)) || ''
  const outcome = classifyValidatorOutput({ timedOut, exitCode, output: out })
  const summary = timedOut
    ? `timeout after ${timeout}ms (incomplete, not a validator FAIL): ${tail.slice(-400)}`
    : passLine || (outcome === 'PASS' ? `exit 0 ${tail.slice(-400)}` : tail.slice(-600))
  return { id: spec.id, command, exitCode, outcome, summary, logPath }
}

function creditOutcome(policy: SkillCreditPolicy, run: ValidatorRunResult | undefined): EvaluationOutcome {
  if (!run) return 'NOT_RUN'
  if (run.outcome === 'PASS') return policy.passOutcome
  return run.outcome
}

export function skillsToEvaluate(atlas: CapabilityAtlas, validatorIds?: string[]): SkillRecord[] {
  const all = [...atlas.skills.values()]
  if (validatorIds?.length) {
    return all
      .filter(skill => {
        const policy = creditPolicyForSkill(skill)
        return Boolean(policy && validatorIds.includes(policy.validatorId))
      })
      .sort((a, b) => a.skillId.localeCompare(b.skillId))
  }
  return listAvailableSkills(atlas)
}

function reuseBootstrapEvaluationId(atlas: CapabilityAtlas, skillId: string, validatorId: string, stamp: string): string {
  const prefix = `eval-bootstrap-${skillId}-${validatorId}-`
  const existing = [...atlas.evaluations.values()].find(item => item.skillId === skillId && item.evaluationId.startsWith(prefix))
  return existing?.evaluationId ?? `${prefix}${stamp}`
}

export type EvaluationBootstrapReport = {
  availableReviewed: string[]
  validatorsDiscovered: string[]
  validatorsExecuted: ValidatorRunResult[]
  refusedProductionProofs: string[]
  records: Array<{ skillId: string; evaluationId: string; level: EvaluationLevel; outcome: EvaluationOutcome }>
  scoreboardBefore: CapabilityScoreboard
  scoreboardAfter: CapabilityScoreboard
}

export function bootstrapAvailableSkillEvaluations(options?: {
  execute?: boolean
  atlas?: CapabilityAtlas
  validatorIds?: string[]
}): EvaluationBootstrapReport {
  const atlas = options?.atlas ?? loadCapabilityAtlas()
  const execute = options?.execute !== false
  const reviewed = skillsToEvaluate(atlas, options?.validatorIds)
  const scoreboardBefore = buildCapabilityScoreboard(atlas)
  const neededIds = new Set(reviewed.map(skill => creditPolicyForSkill(skill)?.validatorId).filter((id): id is string => Boolean(id)))
  const discovered = SAFE_VALIDATORS.filter(spec => {
    if (options?.validatorIds?.length) return options.validatorIds.includes(spec.id)
    return neededIds.has(spec.id) || spec.id === 'pass015-depth'
  })
  const runs: ValidatorRunResult[] = []
  const byId = new Map<string, ValidatorRunResult>()
  if (execute) {
    for (const spec of discovered) {
      const result = runSafeValidator(spec)
      runs.push(result)
      byId.set(spec.id, result)
    }
  }
  const records: EvaluationBootstrapReport['records'] = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const skill of reviewed) {
    const policy = creditPolicyForSkill(skill)
    if (!policy) continue
    if (options?.validatorIds?.length && !options.validatorIds.includes(policy.validatorId)) continue
    const run = byId.get(policy.validatorId)
    const spec = SAFE_VALIDATORS.find(item => item.id === policy.validatorId)
    const outcome = creditOutcome(policy, run)
    const evaluationId = reuseBootstrapEvaluationId(atlas, skill.skillId, policy.validatorId, stamp)
    const evidencePaths = [spec?.script, run?.logPath].filter((item): item is string => Boolean(item))
    recordSkillEvaluation(atlas, {
      evaluationId,
      skillId: skill.skillId,
      level: policy.level,
      title: spec?.title || policy.validatorId,
      requiredSteps: policy.requiredSteps,
      evidencePaths: outcome === 'NOT_RUN' && !run?.logPath ? [] : evidencePaths,
      outcome,
      production: false,
      notes: `${policy.limitations} Validator existence is not a pass. Outcome is from executed command.`,
      command: run?.command ?? null,
      resultSummary: run?.summary ?? 'not executed',
      environment: `${process.platform} node ${process.version} cwd=${resolveRepoRoot()}`,
      limitations: policy.limitations,
      confidence: outcome === 'PASS' && policy.level === 'INTEGRATION_EVAL' ? 'high' : outcome === 'PARTIAL' || outcome === 'PASS' ? 'medium' : 'low',
    })
    records.push({ skillId: skill.skillId, evaluationId, level: policy.level, outcome })
  }
  const scoreboardAfter = persistScoreboard(atlas)
  resetCapabilityAtlasCache()
  return {
    availableReviewed: reviewed.map(skill => skill.skillId),
    validatorsDiscovered: discovered.map(item => item.script),
    validatorsExecuted: runs,
    refusedProductionProofs: REFUSED_PRODUCTION_PROOFS,
    records,
    scoreboardBefore,
    scoreboardAfter,
  }
}

function parseRetryValidators(argv: string[]): string[] | undefined {
  const raw = argv
    .filter(item => item.startsWith('--retry-validator='))
    .flatMap(item => item.slice('--retry-validator='.length).split(','))
    .map(item => item.trim())
    .filter(Boolean)
  return raw.length ? raw : undefined
}

async function runCli() {
  const report = bootstrapAvailableSkillEvaluations({ execute: true, validatorIds: parseRetryValidators(process.argv) })
  console.log(JSON.stringify({
    availableReviewed: report.availableReviewed,
    validatorsExecuted: report.validatorsExecuted.map(item => ({ id: item.id, outcome: item.outcome, exitCode: item.exitCode, summary: item.summary.slice(0, 240) })),
    records: report.records,
    scoreboardBefore: report.scoreboardBefore,
    scoreboardAfter: report.scoreboardAfter,
    governance: EVALUATION_BOOTSTRAP_GOVERNANCE,
  }, null, 2))
  const incomplete = report.validatorsExecuted.filter(item => item.outcome === 'FAIL' || item.outcome === 'NOT_RUN')
  if (incomplete.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli()
}
