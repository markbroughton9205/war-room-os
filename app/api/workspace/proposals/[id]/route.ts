import type { NextRequest } from 'next/server'
import { handleWorkspaceProposalGet, handleWorkspaceProposalPatch } from '@/lib/workspace-contributor/routes'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  return handleWorkspaceProposalGet(id)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  return handleWorkspaceProposalPatch(req, id)
}
