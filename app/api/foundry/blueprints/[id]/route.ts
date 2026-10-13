import { handleGet } from '@/lib/native-builder/blueprint/liveApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Full Commander view of one blueprint: projection, exact preview, approval binding, authority, dependencies, lineage. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleGet(req, (await params).id)
}
