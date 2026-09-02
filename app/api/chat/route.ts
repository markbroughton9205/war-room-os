import { executeCouncilChatRequest } from './execute'
import { captureExperienceFromChatJson } from '@/lib/agi-experience/captureFromChatResponse'

export async function POST(req: Request) {
  const response = await executeCouncilChatRequest(req)

  // AGI Wave 1 — fire-and-forget experience capture for this response, without altering it.
  // Failures here are swallowed inside captureExperienceFromChatJson and must never affect the
  // Commander-facing response already computed above.
  void response
    .clone()
    .json()
    .then(data => (data && typeof data === 'object' ? captureExperienceFromChatJson(data as Record<string, unknown>) : null))
    .catch(() => null)

  return response
}
