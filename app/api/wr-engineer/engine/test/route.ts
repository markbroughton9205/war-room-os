import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerEngineSelectionStore } from '@/lib/wr-engineer/engineSelection'
import { LocalWrEngineerModelAdapter } from '@/lib/wr-engineer/localModelAdapter'

export const dynamic = 'force-dynamic'

const SMOKE_PROMPT = 'Return exactly: WR_ENGINEER_LOCAL_READY'

export async function POST() {
  const session = await requireCommanderSession('WR-Engineer engine test')
  if (!session.ok) return session.response

  const selection = await wrEngineerEngineSelectionStore.load()
  const adapter = new LocalWrEngineerModelAdapter({ model: selection.localModel, timeoutMs: 20_000 })
  const result = await adapter.invoke({
    systemPrompt: 'You are the WR-Engineer local engine smoke test. Reply with the exact requested token and nothing else. Do not propose file changes.',
    userPrompt: SMOKE_PROMPT,
    maxTokens: 32,
    timeoutMs: 20_000,
  })

  return NextResponse.json({
    ok: result.ok,
    adapterId: result.adapterId,
    runtime: result.runtime ?? 'ollama',
    model: result.modelName ?? selection.localModel,
    latencyMs: result.latencyMs ?? null,
    text: result.ok ? result.text.slice(0, 200) : '',
    error: result.error ?? null,
    failureClass: result.failureClass ?? null,
  })
}
