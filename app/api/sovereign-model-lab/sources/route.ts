import { NextResponse } from 'next/server'
import { listSources } from '@/lib/sovereign-model-lab/storage'
import { registerSourceForProgram } from '@/lib/sovereign-model-lab/runtime'
import type { RegisterSourceInput } from '@/lib/sovereign-model-lab/publicSourceRegistry'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sources = await listSources()
  return NextResponse.json({ sources })
}

/** Registering a source declares an intended acquisition contract — it never implies the source
 * is reachable or training-eligible; see publicSourceRegistry.ts. */
export async function POST(req: Request) {
  let body: (RegisterSourceInput & { programId?: string }) | Record<string, never> = {}
  try {
    const raw = await req.json()
    if (raw !== null && typeof raw === 'object') body = raw
  } catch {
    body = {}
  }
  if (!('programId' in body) || typeof body.programId !== 'string' || !body.family || !body.label) {
    return NextResponse.json({ error: 'programId, family, and label are required.' }, { status: 400 })
  }
  const { programId, ...input } = body as RegisterSourceInput & { programId: string }
  try {
    const program = await registerSourceForProgram(programId, input)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
