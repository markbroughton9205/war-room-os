import { NextResponse } from 'next/server'
import { buildDatasetCandidateForProgram } from '@/lib/sovereign-model-lab/runtime'
import { getDatasetManifest, getProgram } from '@/lib/sovereign-model-lab/storage'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const program = await getProgram(id)
  if (!program) return NextResponse.json({ error: 'Program not found.' }, { status: 404 })
  const manifest = program.datasetManifestId ? await getDatasetManifest(program.datasetManifestId) : null
  return NextResponse.json({ manifest })
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const program = await buildDatasetCandidateForProgram(id)
    return NextResponse.json({ program })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 })
  }
}
