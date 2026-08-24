import { NextResponse } from 'next/server'
import { getEngineeringRepositoryContext } from '@/lib/mission-runtime/engineeringReadSurface'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Read-only Engineering Core repository status/diff (Standalone Builder Phase A). Delegates
 * entirely to lib/mission-runtime/engineeringReadSurface.ts — no filesystem or git access happens
 * in this route file. Never gated by assertAutoOrApproval: nothing here can mutate the repository,
 * same no-gate reasoning as native-builder's own read-only routes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const pathsParam = url.searchParams.get('paths')
  const paths = pathsParam ? pathsParam.split(',').map(p => p.trim()).filter(Boolean) : undefined
  try {
    const context = await getEngineeringRepositoryContext(paths)
    return NextResponse.json(context)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
