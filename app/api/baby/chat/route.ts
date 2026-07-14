import { handleBabyChatRequest } from '@/lib/baby-ai/privateChatRoute'
import { assertLiveActionsAllowed } from '@/lib/security/actionRoutePolicy'

export async function POST(req: Request) {
  const environmentBlocked = assertLiveActionsAllowed()
  if (environmentBlocked) return environmentBlocked

  return handleBabyChatRequest(req)
}
