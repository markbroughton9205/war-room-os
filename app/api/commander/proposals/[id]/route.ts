import type { NextRequest } from 'next/server'
import { handleCommanderProposalGet } from '@/lib/workspace-contributor/routes'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  return handleCommanderProposalGet(id)
}
