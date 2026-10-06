import { NextResponse } from 'next/server'
import { detectUnrealRuntime } from '@/lib/media-command/unreal/detect'
import { unrealExecutionStatus } from '@/lib/media-command/unreal/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get('projectId')
  try {
    const trace = detectUnrealRuntime()
    return NextResponse.json(unrealExecutionStatus(projectId, trace))
  } catch (error) {
    return NextResponse.json({
      engine: 'ERROR',
      characterBinding: 'NOT_BOUND',
      scenePackage: 'STALE',
      runtime: 'ERROR',
      version: null,
      installPath: null,
      projectId,
      error: error instanceof Error ? error.message : 'Unreal probe failed',
    }, { status: 500 })
  }
}
