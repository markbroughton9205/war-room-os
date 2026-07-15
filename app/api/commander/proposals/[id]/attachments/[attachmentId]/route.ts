import type { NextRequest } from 'next/server'
import { handleCommanderAttachmentSignedUrl } from '@/lib/workspace-contributor/routes'

type Params = { params: Promise<{ id: string; attachmentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id, attachmentId } = await params
  return handleCommanderAttachmentSignedUrl(id, attachmentId)
}
