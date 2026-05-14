/**
 * ## Live Council chat pipeline (canonical)
 *
 * **Duplicate paths found (sweep):**
 * - `app/page.tsx`: two direct `fetch('/api/chat')` — autonomous orchestration + decree family loop.
 * - `components/war-room/phase3/Phase3WarRoomPanels.tsx`: separate Supabase thread composer (`POST /api/conversations/.../messages`) — DB thread only, not council LLM; keep distinct.
 *
 * **Unified:** all council `/api/chat` traffic from `app/page.tsx` goes through `postCouncilChat`.
 *
 * **Remains:** `/api/local-agent/invoke` for local Kimi/Bridge; engine status refresh; `postLiveCouncilMessage` for dual-write.
 *
 * **Throne send:** `sendLiveCouncilThroneMessage` sequences expansion gate → caller-provided append + council round.
 */
import type { CouncilOrchestrationFamily } from '@/components/council/councilSessionTypes'

export type CouncilChatRequestBody = {
  message: string
  profile: string
  threadHistory: { sender: string; content: string }[]
  mode: string
  toneMode: string
  councilSingleFamily: CouncilOrchestrationFamily
  orchestrationAugment: string
  conversationId?: string
}

export type CouncilChatJson = {
  councilSingleResponse?: string
  councilSingleFamily?: CouncilOrchestrationFamily
  error?: string
  message?: string
}

export async function postCouncilChat(
  body: CouncilChatRequestBody,
  signal?: AbortSignal,
): Promise<{ res: Response; data: CouncilChatJson }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  let data: CouncilChatJson = {}
  try {
    data = (await res.json()) as CouncilChatJson
  } catch {
    data = {}
  }
  return { res, data }
}

/** Expansion / cost-guard branch before a council round (matches home `ExpansionPrompt`). */
export type LiveCouncilExpansionPayload = {
  decree: string
  extraCost: number
  reason: string
  urgent: boolean
}

export async function sendLiveCouncilThroneMessage(args: {
  rawInput: string
  isBusy: () => boolean
  clearDraft: () => void
  detectExpansion: (decree: string) => LiveCouncilExpansionPayload | null
  onExpansionQueued: (decree: string, expansion: LiveCouncilExpansionPayload) => void
  sendDecree: (decree: string) => Promise<void>
}): Promise<void> {
  const decree = args.rawInput.trim()
  if (!decree || args.isBusy()) return
  args.clearDraft()
  const expansion = args.detectExpansion(decree)
  if (expansion) {
    args.onExpansionQueued(decree, expansion)
    return
  }
  await args.sendDecree(decree)
}
