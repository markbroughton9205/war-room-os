import { NextResponse } from 'next/server'
import { runInResolvedWorkspace } from '@/lib/mission-runtime/withWorkspace'
import { readProjectMemory } from '@/lib/native-builder/projectMemory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const workspaceId = new URL(req.url).searchParams.get('workspaceId')
  const result = await runInResolvedWorkspace(workspaceId, async () => {
    const memory = await readProjectMemory()
    return NextResponse.json({ memory })
  })
  return result.ok ? result.value : result.response
}
