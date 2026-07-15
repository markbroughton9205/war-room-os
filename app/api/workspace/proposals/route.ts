import type { NextRequest } from 'next/server'
import { handleWorkspaceProposalsGet, handleWorkspaceProposalsPost } from '@/lib/workspace-contributor/routes'

export async function GET() {
  return handleWorkspaceProposalsGet()
}

export async function POST(req: NextRequest) {
  return handleWorkspaceProposalsPost(req)
}
