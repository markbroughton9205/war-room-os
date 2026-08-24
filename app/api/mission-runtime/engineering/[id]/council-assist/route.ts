import { NextResponse } from 'next/server'
import { getMissionExecutionStrategy } from '@/lib/mission-runtime'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { COUNCIL_ASSIST_COMPOSITIONS } from '@/lib/native-builder/councilAssist'
import type { NativeCouncilAssistComposition } from '@/lib/native-builder/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Phase E — Council Assist. Advisory-only: never gated by assertAutoOrApproval because nothing
 * here mutates the repository or calls the apply path (same no-gate reasoning as the read-only
 * repo/* routes and the single-agent-opinion call inside create()). The persisted session is
 * durable but inert — it cannot become a patch without a separate, explicit hosted-coder request.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: { composition?: string; workspaceId?: string } = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (!body.composition || !COUNCIL_ASSIST_COMPOSITIONS.includes(body.composition as NativeCouncilAssistComposition)) {
    return NextResponse.json(
      { error: `composition is required and must be one of: ${COUNCIL_ASSIST_COMPOSITIONS.join(', ')}` },
      { status: 400 },
    )
  }
  const composition = body.composition as NativeCouncilAssistComposition

  const result = await runInResolvedWorkspace(body.workspaceId, async () => {
    const strategy = getMissionExecutionStrategy('engineering')
    try {
      if (!strategy.councilAssist) {
        return NextResponse.json({ error: 'Council Assist is not supported by this mission strategy.' }, { status: 400 })
      }
      const mission = await strategy.councilAssist(id, composition)
      return NextResponse.json({ mission })
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
    }
  })
  return result.ok ? result.value : result.response
}
