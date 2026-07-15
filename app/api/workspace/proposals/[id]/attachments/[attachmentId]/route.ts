import type { NextRequest } from 'next/server'
import { handleWorkspaceAttachmentDelete } from '@/lib/workspace-contributor/routes'

type Params = { params: Promise<{ id: string; attachmentId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, attachmentId } = await params
  return handleWorkspaceAttachmentDelete(id, attachmentId)
}
