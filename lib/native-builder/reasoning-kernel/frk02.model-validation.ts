/**
 * FRK-02 live worker probe.
 * One configured provider may propose candidates. FRK stores and judges the branches.
 * A model sentence is not proof.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { FoundryModelContext } from '../foundryModelTypes'
import { addSessionEvidence, createFoundryReasoningSession, selectSessionStrategy } from './orchestrator'
import { branchIsProven, openBranch, propagateBranchEvidence, selectBestBranch } from './search'
import { buildWorkerRequest, dispatchReasoningWorker } from './worker'

function contextFor(missionId: string, goal: string): FoundryModelContext {
  return {
    missionId,
    missionKind: 'fixture',
    userRequest: goal,
    goal,
    successCriteria: ['decision is REPLAN', 'planChanges.hypotheses has two OPEN statements'],
    constraints: ['Return REPLAN.', 'Do not call a tool.', 'Do not declare the work proven.'],
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
    importantFindings: ['Return decision REPLAN. Put two different OPEN hypotheses in planChanges.hypotheses. Do not select TOOL.'],
    relevantExcerpts: [],
    visualEvidence: [],
    recentToolResults: [],
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: ['two hypotheses'], detail: 'FRK-02 search probe' },
    tools: [],
  }
}

function candidateClaims(text: string, structured: string[] = []): string[] {
  const found = new Set<string>()
  for (const claim of structured) {
    const trimmed = claim.trim()
    if (trimmed) found.add(trimmed)
  }
  for (const line of text.split(/\n/)) {
    const match = line.trim().match(/^(?:HYPOTHESIS|PLAN)\s*\d*\s*[:.)-]\s*(.+)$/i)
    if (match?.[1]) found.add(match[1].trim())
  }
  return [...found]
}

async function main(): Promise<void> {
  const previousContracts = process.env.FOUNDRY_CONTRACTS_ROOT
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'frk02-model-'))
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  const goal = [
    'A running total is wrong.',
    'Return decision REPLAN.',
    'Do not return TOOL.',
    'reasoningSummary must contain two lines, each starting with HYPOTHESIS:.',
    'planChanges.hypotheses must contain two objects with status OPEN and different statement values.',
    'Do not say the bug is fixed.',
  ].join(' ')
  const session = createFoundryReasoningSession({
    missionId: 'frk02-model-probe',
    goal,
    signals: { ambiguity: 'high', uncertaintyCount: 2 },
    now: '2026-09-22T00:00:00.000Z',
  })
  selectSessionStrategy(session)
  const request = buildWorkerRequest({
    requestId: 'worker-search-1',
    missionId: session.missionId,
    task: 'hypotheses',
    problem: goal,
    constraints: ['Return REPLAN.', 'Do not call a tool.', 'Do not declare the work proven.'],
    evidenceSummaries: [],
  })
  try {
    const routed = await dispatchReasoningWorker({
      request,
      kind: 'replan',
      context: contextFor(session.missionId, goal),
      signal: AbortSignal.timeout(45_000),
    })
    if (!routed.ok) {
      console.log(`FAIL worker unavailable: ${routed.error}`)
      process.exit(1)
    }
    const claims = candidateClaims(`${routed.summary}\n${routed.rawText}`, routed.hypotheses)
    if (claims.length < 2) {
      console.log('FAIL model did not propose two candidate hypotheses or plans')
      console.log(routed.summary)
      process.exit(1)
    }
    const opened = claims.slice(0, 2).map(claim => openBranch(session, {
      label: claim,
      kind: 'hypothesis',
      reason: 'alternative',
      proposedBy: { provider: routed.provider, model: routed.model },
    }))
    if (opened.some(item => !item.ok || !item.branch)) {
      console.log('FAIL branches were not stored')
      process.exit(1)
    }
    const first = opened[0].branch!
    const second = opened[1].branch!
    selectBestBranch(session)
    if (branchIsProven(session, first.branchId) || branchIsProven(session, second.branchId)) {
      console.log('FAIL model proposal became PROVEN without tool evidence')
      process.exit(1)
    }
    const evidence = addSessionEvidence(session, {
      source: 'SOURCE_CODE',
      statement: 'the second explanation matches the source and the first does not',
      actor: 'file.read',
      ref: 'source',
    })
    if (!evidence.evidenceId) {
      console.log('FAIL evidence was not recorded')
      process.exit(1)
    }
    propagateBranchEvidence(session, first.branchId, { evidenceId: evidence.evidenceId, contradicts: true })
    propagateBranchEvidence(session, second.branchId, { evidenceId: evidence.evidenceId, supports: true })
    const selected = selectBestBranch(session)
    const pass = first.status === 'REJECTED'
      && selected?.branchId === second.branchId
      && branchIsProven(session, second.branchId)
      && first.proposedBy?.provider === routed.provider
      && second.proposedBy?.provider === routed.provider
    console.log(`${pass ? 'PASS' : 'FAIL'} live search ${routed.provider}/${routed.model} selected=${selected?.status ?? 'none'}`)
    if (!pass) process.exit(1)
    console.log('FRK-02 model validator PASS')
  } catch (error) {
    console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  } finally {
    if (previousContracts === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previousContracts
    rmSync(contractsRoot, { recursive: true, force: true })
  }
}

void main()
