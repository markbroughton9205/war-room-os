import type { NextRequest } from 'next/server'
import { handleWorkspaceAttachmentPost } from '@/lib/workspace-contributor/routes'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  return handleWorkspaceAttachmentPost(req, id)
}
