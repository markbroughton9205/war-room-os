import { handleApprovalIssueRequest } from '@/lib/council/approval-issuance'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'

export async function POST(request: Request) {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return environmentBlocked

  return handleApprovalIssueRequest(request)
}
