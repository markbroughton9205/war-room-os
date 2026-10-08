import { handlePreview } from '@/lib/native-builder/blueprint/liveApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePreview(req, (await params).id)
}
