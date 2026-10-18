import { handleDependencies } from '@/lib/native-builder/blueprint/liveApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET: dependency plan + verification. POST: Commander approval (or revocation) of a declared dependency NEED. Never installs. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleDependencies(req, (await params).id)
}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleDependencies(req, (await params).id)
}
