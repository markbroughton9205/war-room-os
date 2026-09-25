/**
 * Source + disposable proofs for Foundry contract/verdict Commander UI.
 * Does not package, install, commit, push, deploy, or modify Harbor/Lane & Box/Inventory/Terra/WRIM.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  defaultTicketManagerCriteria,
  draftStandaloneContracts,
  sealAcceptanceContract,
  sealMissionContract,
  supersedeMissionContract,
} from './foundryMissionContract'
import { recordAcceptanceEvidence } from './foundryAcceptanceEvidence'
import { evaluateIndependentReview, evaluateVerdictLayer } from './foundryVerdictLayer'
import {
  buildContractVerdictView,
  compactFoundryHash,
  falseUiSuccessCounts,
  sanitizeCommanderEvidenceText,
} from './foundryContractVerdictView'

type CaseResult = { name: string; pass: boolean; detail: string }
const check = (name: string, pass: boolean, detail: string): CaseResult => ({ name, pass, detail })

function source(rel: string): string {
  return readFileSync(path.join(resolveRepoRoot(), rel), 'utf8')
}

function recordAllPass(missionId: string, missionContract: ReturnType<typeof sealMissionContract>, acceptance: ReturnType<typeof sealAcceptanceContract>) {
  for (const criterion of acceptance.criteria.filter(item => item.required)) {
    recordAcceptanceEvidence({
      criterionId: criterion.criterionId,
      missionId,
      evidenceType: criterion.verificationType,
      producer: 'foundry-verifier',
      artifactReference: `artifact://${criterion.criterionId}`,
      commandReference: 'node --test test.mjs',
      result: `${criterion.expectedOutcome} persist ok`,
      status: 'PASS',
      missionContract,
      acceptanceContract: acceptance,
    })
  }
}

async function run(): Promise<void> {
  const results: CaseResult[] = []
  const contractsRoot = mkdtempSync(path.join(tmpdir(), 'wr-contract-ui-'))
  const previous = process.env.FOUNDRY_CONTRACTS_ROOT
  process.env.FOUNDRY_CONTRACTS_ROOT = contractsRoot
  let readyWithoutPass = 0
  let greenInconclusive = 0
  let staleAsPass = 0
  let legacyFake = 0

  try {
    const panel = source('components/war-room/foundry/FoundryContractVerdictPanel.tsx')
    const center = source('components/war-room/foundry/FoundryAgentCommandCenter.tsx')
    const shell = source('components/war-room/foundry/FoundryShell.tsx')
    const details = source('components/war-room/foundry/FoundryMissionControllerPanel.tsx')
    const api = source('app/api/foundry/command-center/route.ts')

    results.push(check(
      'contract_ui_wired',
      /FoundryContractVerdictPanel/.test(center) && /FoundryContractVerdictPanel/.test(details) && /FoundryContractVerdictPanel/.test(shell) && /aria-label="Mission contract"/.test(panel) && /aria-label="Acceptance criteria"/.test(panel) && /aria-label="Mission verdict"/.test(panel),
      'Command Center, Mission Details, Shell share one panel',
    ))
    results.push(check(
      'hash_compact_and_copy',
      compactFoundryHash('8f23a1c9deadbeef7b42aaaa') === '8f23a1c9…aaaa' && /Copy/.test(panel) && /title=\{full/.test(panel),
      compactFoundryHash('8f23a1c9deadbeef7b42aaaa'),
    ))
    results.push(check(
      'secrets_redacted',
      sanitizeCommanderEvidenceText('Authorization: Bearer super-secret-token') === '[redacted]',
      'bearer token redacted',
    ))
    results.push(check(
      'read_only_api',
      /action === 'contract'/.test(api) && /approve-execution/.test(api) && /approveCommandCenterExecution/.test(api) && /commandCenterSnapshotWithContractViews/.test(api),
      'contract query + existing approve-execution flow',
    ))
    results.push(check(
      'project_ready_ui_gated',
      /seBlockedReady/.test(shell) && /foundry-project-ready-label/.test(shell) && /projectReadyAdmissible/.test(shell),
      'Shell refuses green PROJECT READY without Verdict PASS',
    ))
    results.push(check(
      'planning_approval_copy',
      /APPROVE EXECUTION/.test(panel) && /binds execution to those exact contract hashes/.test(panel),
      'approval copy present',
    ))
    results.push(check(
      'reviewer_not_project_ready',
      /REVIEWER PASS is not PROJECT READY/.test(panel),
      'role clarity',
    ))
    const eventsUi = source('components/war-room/foundry/FoundryLiveAgentEvents.tsx')
    results.push(check(
      'completion_refused_humanized',
      /Completion refused/.test(eventsUi) && /COMPLETION_REFUSED/.test(eventsUi),
      'live events show Commander-readable completion-refused copy',
    ))
    results.push(check(
      'status_not_color_only',
      panel.includes('aria-label={`Criterion ${row.criterionId} ${row.status}`}') && panel.includes('{row.status}'),
      'criterion status has text + aria-label',
    ))

    const missingId = 'ui-missing'
    const missingDraft = draftStandaloneContracts({
      missionId: missingId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-UI-A',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const missingAcceptance = sealAcceptanceContract(missingDraft.acceptanceContract)
    missingDraft.missionContract.acceptanceContractId = missingAcceptance.acceptanceContractId
    const missingMission = sealMissionContract(missingDraft.missionContract)
    evaluateVerdictLayer({
      missionId: missingId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: missingMission,
      acceptanceContract: missingAcceptance,
      executorResult: 'PROPOSED_READY',
    })
    const viewA = buildContractVerdictView({
      missionId: missingId,
      engineeringClass: 'STANDALONE_ENGINEER',
      specApproved: true,
      approvedMissionHash: missingMission.contentHash,
      approvedAcceptanceHash: missingAcceptance.contentHash,
      missionContractId: missingMission.missionContractId,
      acceptanceContractId: missingAcceptance.acceptanceContractId,
      missionContract: missingMission,
      acceptanceContract: missingAcceptance,
    })
    const countsA = falseUiSuccessCounts(viewA)
    readyWithoutPass += countsA.PROJECT_READY_UI_WITHOUT_VERDICT_PASS
    greenInconclusive += countsA.GREEN_SUCCESS_WITH_INCONCLUSIVE_VERDICT
    results.push(check(
      'fixture_a_missing_evidence_ui',
      viewA.verdict === 'INCONCLUSIVE' && viewA.truthfulHeadline === 'NEEDS EVIDENCE' && !viewA.projectReadyAdmissible && /no current evidence/.test(viewA.completionRefusedReason ?? '') && viewA.criteria.some(item => item.status === 'MISSING'),
      `${viewA.verdict} ${viewA.truthfulHeadline} ${viewA.completionRefusedReason}`,
    ))

    const passId = 'ui-pass'
    const passDraft = draftStandaloneContracts({
      missionId: passId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-UI-B',
      specVersion: '1',
      taskIds: ['TASK-001'],
    }, defaultTicketManagerCriteria(['TASK-001']))
    const passAcceptance = sealAcceptanceContract(passDraft.acceptanceContract)
    passDraft.missionContract.acceptanceContractId = passAcceptance.acceptanceContractId
    const passMission = sealMissionContract(passDraft.missionContract)
    recordAllPass(passId, passMission, passAcceptance)
    evaluateVerdictLayer({
      missionId: passId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: passMission,
      acceptanceContract: passAcceptance,
      reviewOutcome: 'PASS',
      executorResult: 'PROPOSED_READY',
    })
    const viewB = buildContractVerdictView({
      missionId: passId,
      engineeringClass: 'STANDALONE_ENGINEER',
      specApproved: true,
      approvedMissionHash: passMission.contentHash,
      approvedAcceptanceHash: passAcceptance.contentHash,
      missionContractId: passMission.missionContractId,
      acceptanceContractId: passAcceptance.acceptanceContractId,
      missionContract: passMission,
      acceptanceContract: passAcceptance,
      reviewOutcome: 'PASS',
    })
    results.push(check(
      'fixture_b_all_pass_ui',
      viewB.verdict === 'PASS' && viewB.projectReadyAdmissible === true && viewB.truthfulHeadline === 'PROJECT READY' && viewB.completionRefusedReason === null && viewB.criteria.every(item => !item.required || item.status === 'PASS'),
      `${viewB.verdict} ${viewB.truthfulHeadline}`,
    ))

    const failId = 'ui-fail'
    const failDraft = draftStandaloneContracts({
      missionId: failId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager',
      specId: 'SPEC-UI-C',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const failAcceptance = sealAcceptanceContract(failDraft.acceptanceContract)
    failDraft.missionContract.acceptanceContractId = failAcceptance.acceptanceContractId
    const failMission = sealMissionContract(failDraft.missionContract)
    for (const criterion of failAcceptance.criteria.filter(item => item.required)) {
      recordAcceptanceEvidence({
        criterionId: criterion.criterionId,
        missionId: failId,
        evidenceType: criterion.verificationType,
        producer: 'foundry-verifier',
        result: criterion.criterionId === 'CR-TEST' ? 'fail=1' : 'ok persist',
        status: criterion.criterionId === 'CR-TEST' ? 'FAIL' : 'PASS',
        missionContract: failMission,
        acceptanceContract: failAcceptance,
      })
    }
    evaluateVerdictLayer({
      missionId: failId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: failMission,
      acceptanceContract: failAcceptance,
      reviewOutcome: 'PASS',
    })
    const viewC = buildContractVerdictView({
      missionId: failId,
      engineeringClass: 'STANDALONE_ENGINEER',
      specApproved: true,
      approvedMissionHash: failMission.contentHash,
      approvedAcceptanceHash: failAcceptance.contentHash,
      missionContractId: failMission.missionContractId,
      acceptanceContractId: failAcceptance.acceptanceContractId,
      missionContract: failMission,
      acceptanceContract: failAcceptance,
    })
    const countsC = falseUiSuccessCounts(viewC)
    readyWithoutPass += countsC.PROJECT_READY_UI_WITHOUT_VERDICT_PASS
    results.push(check(
      'fixture_c_failing_evidence_ui',
      viewC.verdict === 'FAIL' && viewC.truthfulHeadline === 'FAILED' && !viewC.projectReadyAdmissible && viewC.criteria.some(item => item.criterionId === 'CR-TEST' && item.status === 'FAIL'),
      `${viewC.verdict} ${viewC.truthfulHeadline}`,
    ))

    const staleId = 'ui-stale'
    const staleDraft = draftStandaloneContracts({
      missionId: staleId,
      commanderRequest: 'Build a ticket manager',
      goal: 'Ticket manager v1',
      specId: 'SPEC-UI-D',
      specVersion: '1',
      taskIds: ['TASK-001'],
    })
    const staleAcceptance = sealAcceptanceContract(staleDraft.acceptanceContract)
    staleDraft.missionContract.acceptanceContractId = staleAcceptance.acceptanceContractId
    const staleMission = sealMissionContract(staleDraft.missionContract)
    recordAllPass(staleId, staleMission, staleAcceptance)
    const superseded = supersedeMissionContract(staleMission, { goal: 'Ticket manager v2', specVersion: '2' }, true)
    const { loadAcceptanceContract } = await import('./foundryContractStore')
    const nextAcc = loadAcceptanceContract(superseded.next.acceptanceContractId)
    const viewD = buildContractVerdictView({
      missionId: staleId,
      engineeringClass: 'STANDALONE_ENGINEER',
      specApproved: true,
      approvedMissionHash: superseded.next.contentHash,
      approvedAcceptanceHash: nextAcc?.contentHash,
      missionContractId: superseded.next.missionContractId,
      acceptanceContractId: superseded.next.acceptanceContractId,
      missionContract: superseded.next,
      acceptanceContract: nextAcc,
    })
    staleAsPass += falseUiSuccessCounts(viewD).STALE_EVIDENCE_RENDERED_AS_PASS
    results.push(check(
      'fixture_d_stale_evidence_ui',
      viewD.criteria.some(item => item.status === 'STALE') && viewD.truthfulHeadline !== 'PROJECT READY' && !viewD.projectReadyAdmissible && /superseded spec version|Re-run required tests/.test(`${viewD.completionRefusedReason} ${viewD.nextAction}`),
      viewD.criteria.map(item => `${item.criterionId}:${item.status}`).join(','),
    ))

    process.env.FOUNDRY_CC_INJECT_REVIEW_FAILURE = '1'
    const reviewFail = evaluateIndependentReview({
      tasks: [{ role: 'TEST', tests: { ok: true, detail: 'ok' } }],
      workspaces: [{ filesChanged: ['server.mjs'] }],
      preview: { status: 'RUNNING' },
      engineeringClass: 'STANDALONE_ENGINEER',
    } as never)
    delete process.env.FOUNDRY_CC_INJECT_REVIEW_FAILURE
    evaluateVerdictLayer({
      missionId: passId,
      engineeringClass: 'STANDALONE_ENGINEER',
      missionContract: passMission,
      acceptanceContract: passAcceptance,
      reviewOutcome: reviewFail.outcome,
    })
    const viewE = buildContractVerdictView({
      missionId: passId,
      engineeringClass: 'STANDALONE_ENGINEER',
      specApproved: true,
      approvedMissionHash: passMission.contentHash,
      approvedAcceptanceHash: passAcceptance.contentHash,
      missionContractId: passMission.missionContractId,
      acceptanceContractId: passAcceptance.acceptanceContractId,
      missionContract: passMission,
      acceptanceContract: passAcceptance,
      reviewOutcome: reviewFail.outcome,
    })
    results.push(check(
      'fixture_e_reviewer_fail_ui',
      reviewFail.outcome === 'FAIL' && viewE.verdict === 'FAIL' && viewE.truthfulHeadline === 'FAILED' && !viewE.projectReadyAdmissible && /independent review failed/.test(viewE.completionRefusedReason ?? ''),
      `${viewE.verdict} review=${viewE.reviewOutcome}`,
    ))

    const viewF = buildContractVerdictView({
      missionId: 'legacy-history',
      engineeringClass: undefined,
      previewReady: true,
      projectReadyFlag: true,
      missionContract: passMission,
      acceptanceContract: passAcceptance,
    })
    legacyFake += falseUiSuccessCounts(viewF).LEGACY_FAKE_CONTRACT_COUNT
    results.push(check(
      'fixture_f_legacy_ui',
      viewF.legacy === true && viewF.legacyLabel === 'LEGACY MISSION' && viewF.missionContract.hash === null && viewF.criteria.length === 0 && viewF.truthfulHeadline === 'LEGACY MISSION',
      `${viewF.legacyLabel} hash=${viewF.missionContract.hash}`,
    ))

    const viewG = buildContractVerdictView({
      missionId: passId,
      engineeringClass: 'STANDALONE_ENGINEER',
      specVersion: '1',
      specApproved: true,
      approvedMissionHash: 'oldhasholdhasholdhasholdhasholdhasholdhasholdhasholdhash',
      approvedAcceptanceHash: 'oldaccepthasholdaccepthasholdaccepthasholdaccepthashaaaa',
      missionContractId: passMission.missionContractId,
      acceptanceContractId: passAcceptance.acceptanceContractId,
      missionContract: passMission,
      acceptanceContract: passAcceptance,
      reviewOutcome: 'PASS',
    })
    results.push(check(
      'fixture_g_contract_change_ui',
      viewG.reapprovalRequired === true && viewG.truthfulHeadline === 'NEEDS COMMANDER' && /RE-APPROVAL REQUIRED|Approve updated contract/.test(`${viewG.nextAction} ${viewG.verdictReason}`),
      `${viewG.truthfulHeadline} ${viewG.nextAction}`,
    ))

    results.push(check('PROJECT_READY_UI_WITHOUT_VERDICT_PASS', readyWithoutPass === 0, String(readyWithoutPass)))
    results.push(check('GREEN_SUCCESS_WITH_INCONCLUSIVE_VERDICT', greenInconclusive === 0, String(greenInconclusive)))
    results.push(check('STALE_EVIDENCE_RENDERED_AS_PASS', staleAsPass === 0, String(staleAsPass)))
    results.push(check('LEGACY_FAKE_CONTRACT_COUNT', legacyFake === 0, String(legacyFake)))
  } finally {
    if (previous === undefined) delete process.env.FOUNDRY_CONTRACTS_ROOT
    else process.env.FOUNDRY_CONTRACTS_ROOT = previous
    delete process.env.FOUNDRY_CC_INJECT_REVIEW_FAILURE
    rmSync(contractsRoot, { recursive: true, force: true })
  }

  const failed = results.filter(item => !item.pass)
  console.log(JSON.stringify({ ok: failed.length === 0, passed: results.filter(item => item.pass).length, failed: failed.length, results }, null, 2))
  if (failed.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run()
}

export { run as runFoundryContractVerdictUiValidation }
