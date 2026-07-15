import type { NextRequest } from 'next/server'
import { handleCommanderProposalsGet } from '@/lib/workspace-contributor/routes'

export async function GET(req: NextRequest) {
  return handleCommanderProposalsGet(req)
}
