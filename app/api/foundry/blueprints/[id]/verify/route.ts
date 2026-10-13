import { handleVerify } from '@/lib/native-builder/blueprint/liveApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleVerify(req, (await params).id)
}
