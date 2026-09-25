/**
 * Worker integration probe.
 * A configured provider may answer. An unavailable worker must leave FRK state intact.
 * This does not grade frontier intelligence and does not change routing policy.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FoundryModelContext } from '../foundryModelTypes'
import {
  createFoundryReasoningSession,
  ingestWorkerOutput,
  markWorkerUnavailable,
  serializeSession,
} from './orchestrator'
import { buildWorkerRequest, dispatchReasoningWorker } from './worker'

function contextFor(missionId: string, goal: string): FoundryModelContext {
  return {
    missionId,
    missionKind: 'fixture',
    userRequest: goal,
    goal,
    successCriteria: ['Worker returns a structured proposal or a blocked state.'],
    constraints: ['Do not commit, push, deploy, or spend.'],
    permissions: {
      filesystem: false,
      terminal: false,
      browser: false,
      computerUse: false,
      tests: false,
      lint: false,
      typecheck: false,
      build: false,
      package: false,
      installProduction: false,
      activateInstall: false,
      installedRuntimeControl: false,
      process: false,
      commit: false,
      push: false,
      liveDeploy: false,
      internetResearch: false,
    },
    phase: 'PLANNING',
    plan: [],
    hypotheses: [],
    changedFiles: [],
    importantFindings: [],
    relevantExcerpts: [],
    visualEvidence: [],
    recentToolResults: [],
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: ['worker integration'], detail: 'FRK worker probe' },
    tools: [],
  }
}

async function main(): Promise<void> {
  const previousContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'frk-model-'))
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  const session = createFoundryReasoningSession({
    missionId: 'frk-model-probe',
    goal: 'State the problem in one sentence.',
    now: '2026-09-22T00:00:00.000Z',
  })
  const before = JSON.stringify({
    graph: session.reasoningGraph,
    hypotheses: session.hypotheses,
    evidence: session.evidence,
    contradictions: session.contradictions,
  })
  const request = buildWorkerRequest({
    requestId: 'worker-1',
    missionId: session.missionId,
    task: 'understand',
    problem: session.problemModel.goal,
    constraints: session.constraints,
    evidenceSummaries: [],
  })
  let outcome = 'BLOCKED_PROVIDER'
  try {
    const routed = await dispatchReasoningWorker({
      request,
      context: contextFor(session.missionId, session.problemModel.goal),
      signal: AbortSignal.timeout(20_000),
    })
    if (!routed.ok) {
      markWorkerUnavailable(session, routed.error)
    } else {
      const ingested = ingestWorkerOutput(session, {
        task: 'understand',
        summary: routed.summary || 'worker returned an empty summary',
        declaredDone: routed.declaredDone,
      }, 'understand')
      outcome = ingested.ok ? `VALIDATED ${routed.provider}/${routed.model}` : `REJECTED ${ingested.reason}`
      if (routed.declaredDone) {
        const claim = session.verificationState.claims.find(item => item.status === 'PROVEN')
        if (claim) {
          console.log('FAIL worker self-declared success became PROVEN')
          process.exit(1)
        }
      }
    }
  } catch (error) {
    markWorkerUnavailable(session, error instanceof Error ? error.message : String(error))
  }
  const after = JSON.stringify({
    graph: session.reasoningGraph,
    hypotheses: session.hypotheses,
    evidence: session.evidence,
    contradictions: session.contradictions,
  })
  if (session.status === 'BLOCKED_PROVIDER' && before !== after) {
    console.log('FAIL BLOCKED_PROVIDER mutated reasoning state')
    console.log(serializeSession(session))
    process.exit(1)
  }
  if (session.status === 'BLOCKED_PROVIDER' && session.stopReason !== 'BLOCKED_PROVIDER') {
    console.log('FAIL blocked worker did not keep BLOCKED_PROVIDER')
    process.exit(1)
  }
  console.log(`PASS worker integration ${outcome}`)
  console.log('FRK model validator PASS')
  if (previousContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
  else process.env.FOUNDRY_CONTRACTS_ROOT = previousContracts
  rmSync(contractsRoot, { recursive: true, force: true })
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
