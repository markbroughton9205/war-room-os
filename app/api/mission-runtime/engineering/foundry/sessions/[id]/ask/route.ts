import { NextResponse } from 'next/server'
import { appendFoundryChat, getFoundrySession } from '@/lib/native-builder/foundrySessions'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { readRepoFile } from '@/lib/native-builder/repositoryInspector'
import { scanRepositoryStructure } from '@/lib/native-builder/foundryLargeProject'
import { probeOllama, requestOllamaCompletion } from '@/lib/native-builder/ollamaClient'
import { foundryCoderModelId } from '@/lib/native-builder/localModelArbiter'
import { answerAsk } from '@/lib/native-builder/foundryAsk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Foundry Ask (read-only). Answers a question about the session's project from its files using the
 * local model. No mission is created and no tool is available: the only dependencies are the
 * read-only file reader, a file listing, and a text completion (see lib/native-builder/foundryAsk.ts).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { text?: string; workspaceId?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const text = body.text?.trim() ?? ''
  if (!text) return NextResponse.json({ error: 'text is required.' }, { status: 400 })

  const existing = await getFoundrySession(id)
  const workspaceId = existing?.workspaceId || body.workspaceId
  const scoped = await runInResolvedWorkspace(workspaceId, async () => {
    const session = await getFoundrySession(id)
    if (!session) return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    await appendFoundryChat(id, 'COMMANDER', text)

    const probe = await probeOllama()
    if (!probe.available) {
      await appendFoundryChat(id, 'SYSTEM', 'The local model is unavailable, so Foundry cannot answer right now.')
      return NextResponse.json({ error: probe.detail, code: 'MODEL_UNAVAILABLE' }, { status: 503 })
    }

    const map = await scanRepositoryStructure()
    const model = foundryCoderModelId()
    const outcome = await answerAsk(
      {
        fileNames: map.names,
        readFile: async relPath => {
          const read = await readRepoFile(relPath)
          return read.ok ? { ok: true, content: read.content } : { ok: false, error: read.error }
        },
        complete: async ({ system, prompt }) => {
          const result = await requestOllamaCompletion({ model, system, prompt, timeoutMs: 90_000, options: { temperature: 0.2, num_predict: 700 } })
          return result.ok ? { ok: true, text: result.text, model: result.model } : { ok: false, detail: result.detail }
        },
      },
      text,
    )
    if (!outcome.ok) {
      await appendFoundryChat(id, 'SYSTEM', `Foundry could not answer: ${outcome.detail}`)
      return NextResponse.json({ error: outcome.detail, code: 'ASK_FAILED' }, { status: 502 })
    }
    await appendFoundryChat(id, 'FOUNDRY_MASTER', outcome.answer)
    return NextResponse.json({ answer: outcome.answer, filesUsed: outcome.filesUsed, model: outcome.model })
  })
  return scoped.ok ? scoped.value : scoped.response
}
