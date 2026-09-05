import { NextResponse } from 'next/server'
import { requireCommanderSession } from '@/lib/security/commanderSession'
import { wrEngineerNodeStore } from '@/lib/wr-engineer/node/store'
import { listRepositoriesForNode, RepositoryRegistrationError, registerRepository } from '@/lib/wr-engineer/node/repository'
import { logWrEngineerAudit } from '@/lib/wr-engineer/audit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer repositories')
  if (!session.ok) return session.response

  const { nodeId } = await params
  const repositories = await listRepositoriesForNode(wrEngineerNodeStore, nodeId)
  return NextResponse.json({ repositories })
}

/** Explicit registration only — never crawls the node's filesystem. See repository.ts's header for
 * why this route validates only shape/ownership, not path existence (that's the node's own job). */
export async function POST(req: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  const session = await requireCommanderSession('WR-Engineer repositories')
  if (!session.ok) return session.response

  const { nodeId } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || typeof body.path !== 'string') {
    return NextResponse.json({ error: 'Request body must include "name" and "path" strings.' }, { status: 400 })
  }

  try {
    const repository = await registerRepository(wrEngineerNodeStore, {
      nodeId,
      name: body.name,
      path: body.path,
      defaultBranch: typeof body.defaultBranch === 'string' ? body.defaultBranch : undefined,
    })
    await logWrEngineerAudit('repository registered', { nodeId, repositoryId: repository.repositoryId, name: repository.name })
    return NextResponse.json({ repository })
  } catch (error) {
    if (error instanceof RepositoryRegistrationError) {
      return NextResponse.json({ error: error.message, reason: error.reason }, { status: 409 })
    }
    throw error
  }
}
