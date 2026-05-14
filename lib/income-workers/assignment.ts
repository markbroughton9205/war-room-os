import { getIncomeWorker } from './registry'
import type {
  IncomeWorkerAssignmentPlan,
  IncomeWorkerAssignmentRequest,
  IncomeWorkerId,
} from './types'

function makeMissionId(seed: string) {
  const normalized = seed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  return `income_mission_${normalized || Date.now().toString(36)}`
}

function pickWorker(request: IncomeWorkerAssignmentRequest): IncomeWorkerId {
  if (request.workerId) return request.workerId
  return request.candidate?.eligibleWorkers?.[0] ?? 'gig_scout'
}

export function createIncomeWorkerAssignmentPlan(request: IncomeWorkerAssignmentRequest): IncomeWorkerAssignmentPlan {
  const workerId = pickWorker(request)
  const worker = getIncomeWorker(workerId)
  if (!worker) throw new Error(`Unknown income worker: ${workerId}`)

  const title = request.candidate?.title ?? request.opportunityId ?? 'Income opportunity assignment'
  const sourceUrl = request.candidate?.url ?? null
  const expectedPayout = request.candidate?.payout ?? null

  return {
    missionId: makeMissionId(`${workerId}-${title}`),
    workerId,
    workerName: worker.name,
    status: 'queued',
    title,
    sourceUrl,
    expectedPayout,
    actualPayout: null,
    payoutProofRequired: true,
    secureApprovalRequiredForPayouts: true,
    actionPlan: [
      'Review source link and confirm legitimacy.',
      'Confirm eligibility, country availability, and expiration.',
      'Prepare next action for Ra’el approval before any external submission.',
      'Track expected payout only as unconfirmed until proof is recorded.',
      'Record actual payout only after confirmed payout proof exists.',
    ],
    approvalRequired: true,
  }
}
