import { handleList } from '@/lib/native-builder/blueprint/liveApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Commander-gated list of blueprint executions (read-only). */
export async function GET(req: Request) {
  return handleList(req)
}
