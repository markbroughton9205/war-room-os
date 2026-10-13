import { handleImport } from '@/lib/native-builder/blueprint/liveApi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Import a supplied package for exact preview. Commander only; the package is untrusted data and gains no authority from its content. */
export async function POST(req: Request) {
  return handleImport(req)
}
